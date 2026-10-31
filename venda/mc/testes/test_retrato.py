# -*- coding: utf-8 -*-
import json, pathlib
from venda.mc import retrato as RT

DADOS = pathlib.Path(__file__).parent / "dados" / "antecipacao"


def carregar(nome):
    return json.loads((DADOS / (nome + ".json")).read_text(encoding="utf-8"))


def test_tipos_e_obra():
    r = RT.normalizar(carregar("base"), "2026-11-03")
    tipos = {p["tipo"] for p in r["parcelas"]}
    assert {"pre", "balao", "pos"} <= tipos
    assert r["obra"] == "CONDOMÍNIO RESERVA DOS IPÊS"
    assert all(p["raw"] > 0 for p in r["parcelas"] if p["tipo"] in ("pre", "balao", "pos"))


def test_fator_vem_do_acumulado_do_erp_e_reproduz_o_valor():
    from decimal import Decimal, ROUND_HALF_UP
    r = RT.normalizar(carregar("base"), "2026-11-03")
    for p in r["parcelas"]:
        if p["tipo"] in ("pre", "balao", "pos"):
            esperado = float((Decimal(str(p["raw"])) * Decimal(str(p["fator"]))).quantize(Decimal("0.01"), ROUND_HALF_UP))
            assert esperado == p["valor"], p["id"]
    abertas = [p for p in r["parcelas"] if p["tipo"] in ("pre", "balao", "pos") and not p["pago"]]
    assert round(sum(p["valor"] for p in abertas), 2) == 37446.74
    assert all(abs(p["fator"] - 1.123) < 1e-12 for p in abertas)


def test_paga_e_parcial_pelo_recebimento():
    v = carregar("base")
    inst = v["tradeReceivable"]["installments"]
    inst[0]["receipts"] = [{"value": inst[0]["plannedValue"], "interestValue": 0, "discountValue": 0}]; inst[0]["received"] = True
    inst[1]["receipts"] = [{"value": 1.0, "interestValue": 0, "discountValue": 0}]; inst[1]["received"] = False
    inst[1]["pendingValue"] = inst[1]["plannedValue"] - 1
    r = {p["id"]: p for p in RT.normalizar(v, "2026-11-03")["parcelas"]}
    assert r[inst[0]["id"]]["pago"] is True and r[inst[0]["id"]]["parcial"] is False
    assert r[inst[1]["id"]]["pago"] is False and r[inst[1]["id"]]["parcial"] is True


def test_venda_de_outra_obra_recusa():
    v = carregar("base"); v["work"]["name"] = "OUTRA OBRA"
    try:
        RT.normalizar(v, "2026-11-03")
    except RT.ForaDoCondominio:
        return
    raise AssertionError("devia recusar")


# ---------------------------------------------------------------- Notion: texto longo
from venda.mc import notion as N


class SessaoFalsa:
    def __init__(self): self.patches = []
    def patch(self, url, json=None, headers=None, timeout=None):
        self.patches.append(json)
        class R: status_code = 200; text = ""
        return R()


def test_texto_longo_em_pedacos():
    s = SessaoFalsa(); n = N.Notion("x", sessao=s)
    ok = n.gravar_texto_longo("p", {"MC - RETRATO": {"type": "rich_text"}}, "MC - RETRATO", "a" * 4500)
    assert ok is True
    pedacos = s.patches[0]["properties"]["MC - RETRATO"]["rich_text"]
    assert [len(p["text"]["content"]) for p in pedacos] == [1900, 1900, 700]


def test_texto_longo_coluna_que_nao_existe():
    s = SessaoFalsa(); n = N.Notion("x", sessao=s)
    assert n.gravar_texto_longo("p", {}, "MC - RETRATO", "a") is False and s.patches == []


# ---------------------------------------------------------------- CLI
VENDA_ID = "00000000-0000-0000-0000-0000000000a1"


class NotionFalso:
    """Dublê do Notion: uma página, guarda o que o robô gravou."""
    ultimo = None

    def __init__(self, token, sessao=None):
        self.props = {
            "MC - VENDA ID": {"type": "rich_text", "rich_text": [{"plain_text": " %s " % VENDA_ID}]},
            "MC - RETRATO": {"type": "rich_text", "rich_text": []},
            "MC - RETRATO EM": {"type": "rich_text", "rich_text": []},
        }
        self.gravado = {}
        NotionFalso.ultimo = self

    def pagina(self, page_id):
        return {"properties": self.props}

    def gravar_texto_longo(self, page_id, props, nome, texto):
        self.gravado[nome] = texto
        return True

    def gravar_textos(self, page_id, props, valores):
        self.gravado.update(valores)
        return []


def _cli(monkeypatch, sem_venda_id=False, venda=None, valor_id=None, anteriores=None):
    visto = {}
    monkeypatch.setenv("NOTION_TOKEN", "t")
    from venda.mc import erp as erpmod
    monkeypatch.setattr(N, "Notion", NotionFalso)
    monkeypatch.setattr(erpmod, "do_ambiente", lambda: "erp-falso")

    def ler_venda(erp, vid):
        visto["erp"], visto["vid"] = erp, vid
        if isinstance(venda, Exception):
            raise venda
        return venda if venda is not None else carregar("base")
    monkeypatch.setattr(RT.D, "ler_venda", ler_venda)
    if sem_venda_id or valor_id is not None or anteriores:
        orig = NotionFalso.__init__

        def init(self, *a, **k):
            orig(self, *a, **k)
            if sem_venda_id or valor_id is not None:
                self.props["MC - VENDA ID"]["rich_text"] = [{"plain_text": valor_id}] if valor_id else []
            for col, txt in (anteriores or {}).items():
                self.props[col]["rich_text"] = [{"plain_text": txt}]
        monkeypatch.setattr(NotionFalso, "__init__", init)
    codigo = RT.main(["--page", "a" * 32])
    return codigo, NotionFalso.ultimo.gravado, visto


def test_cli_grava_retrato_e_hora(monkeypatch):
    codigo, g, visto = _cli(monkeypatch)
    assert codigo == 0
    assert visto == {"erp": "erp-falso", "vid": VENDA_ID}   # o id do ERP segue com hífens, sem espaços
    r = json.loads(g["MC - RETRATO"])
    assert r["v"] == 1 and r["obra"] == "CONDOMÍNIO RESERVA DOS IPÊS" and r["parcelas"]
    import re
    assert re.match(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$", g["MC - RETRATO EM"])
    assert r["lido"] == g["MC - RETRATO EM"][:10]


def test_cli_pagina_sem_venda_id_grava_erro(monkeypatch):
    codigo, g, visto = _cli(monkeypatch, sem_venda_id=True)
    assert codigo == 1 and g["MC - RETRATO"] == "ERRO: venda sem MC - VENDA ID" and visto == {}


def test_cli_id_que_nao_e_uuid_grava_erro_proprio(monkeypatch):
    codigo, g, visto = _cli(monkeypatch, valor_id="isto nao e id")
    assert codigo == 1 and g["MC - RETRATO"] == "ERRO: MC - VENDA ID inválido" and visto == {}


def test_cli_venda_de_outra_obra_grava_erro(monkeypatch):
    v = carregar("base"); v["work"]["name"] = "OUTRA OBRA"
    codigo, g, _ = _cli(monkeypatch, venda=v)
    assert codigo == 1 and g["MC - RETRATO"].startswith("ERRO: ")


def test_outra_obra_diz_qual_e():
    v = carregar("base"); v["work"]["name"] = "OUTRA OBRA"
    try:
        RT.normalizar(v, "2026-11-03")
    except RT.ForaDoCondominio as e:
        assert str(e) == "venda de outra obra: OUTRA OBRA"
        return
    raise AssertionError("devia recusar")


def test_texto_longo_grande_demais_levanta():
    import pytest
    s = SessaoFalsa(); n = N.Notion("x", sessao=s)
    props = {"MC - RETRATO": {"type": "rich_text"}}
    assert n.gravar_texto_longo("p", props, "MC - RETRATO", "a" * (100 * 1900)) is True
    with pytest.raises(ValueError, match="texto grande demais para o Notion"):
        n.gravar_texto_longo("p", props, "MC - RETRATO", "a" * (100 * 1900 + 1))
    assert len(s.patches) == 1


def test_pago_em_so_quando_pago():
    v = carregar("base")
    inst = v["tradeReceivable"]["installments"]
    ab = [i for i in inst if not i["received"]][0]
    ab["dateOfReceipt"] = "2026-10-30T00:00:00"; ab["receipts"] = [{"value": 1.0, "interestValue": 0, "discountValue": 0}]
    r = {p["id"]: p for p in RT.normalizar(v, "2026-11-03")["parcelas"]}
    assert r[ab["id"]]["parcial"] is True and r[ab["id"]]["pagoEm"] == ""


def test_pago_em_vem_do_dateOfReceipt():
    r = RT.normalizar(carregar("base"), "2026-11-03")
    pagas = [p for p in r["parcelas"] if p["pago"]]
    abertas = [p for p in r["parcelas"] if not p["pago"]]
    assert pagas and abertas
    assert all(p["pagoEm"] == p["data"] for p in pagas)
    assert all(p["pagoEm"] == "" for p in abertas)


# ---------------------------------------------------------------- todas as vendas (leitura diária)
def _linha(idp, venda_id):
    rt = [{"plain_text": venda_id}] if venda_id else []
    return {"id": idp, "properties": {
        "MC - VENDA ID": {"type": "rich_text", "rich_text": rt},
        "MC - RETRATO": {"type": "rich_text", "rich_text": []},
        "MC - RETRATO EM": {"type": "rich_text", "rich_text": []}}}


class NotionDeTres:
    def __init__(self):
        self.gravado = {}
        self.consultas = []

    def linhas(self, db_id):
        self.consultas.append(db_id)
        return [_linha("p-sem-id", None), _linha("p-ok", VENDA_ID),
                _linha("p-erp-cai", "00000000-0000-0000-0000-0000000000b2")]

    def gravar_texto_longo(self, page_id, props, nome, texto):
        self.gravado.setdefault(page_id, {})[nome] = texto
        return True

    def gravar_textos(self, page_id, props, valores):
        self.gravado.setdefault(page_id, {}).update(valores)
        return []


class ErpFalso:
    pass


def test_atualizar_todas_pula_sem_id_e_nao_para_no_erro(monkeypatch):
    chamadas = []

    def ler_venda(erp, vid):
        chamadas.append(vid)
        if vid.endswith("b2"):
            raise RuntimeError("o ERP caiu")
        return carregar("base")
    monkeypatch.setattr(RT.D, "ler_venda", ler_venda)
    n = NotionDeTres()
    assert RT.atualizar_todas(n, ErpFalso(), "db1", "2026-11-03 08:00") == (1, 1)
    assert n.consultas == ["db1"]
    assert "p-sem-id" not in n.gravado and len(n.gravado) == 2
    assert json.loads(n.gravado["p-ok"]["MC - RETRATO"])["v"] == 1
    assert n.gravado["p-ok"]["MC - RETRATO EM"] == "2026-11-03 08:00"
    assert n.gravado["p-erp-cai"]["MC - RETRATO"] == "ERRO: o ERP caiu"
    assert chamadas == [VENDA_ID, "00000000-0000-0000-0000-0000000000b2"]


def test_cli_todas_sem_variavel_sai_com_2(monkeypatch, capsys):
    monkeypatch.setenv("NOTION_TOKEN", "t")
    monkeypatch.delenv("DB_VENDAS_COND", raising=False)
    assert RT.main(["--todas"]) == 2
    assert "DB_VENDAS_COND" in capsys.readouterr().out


def test_cli_todas_resume_sem_dados(monkeypatch, capsys):
    from venda.mc import erp as erpmod
    monkeypatch.setenv("NOTION_TOKEN", "t"); monkeypatch.setenv("DB_VENDAS_COND", "db1")
    monkeypatch.setattr(N, "Notion", lambda token, sessao=None: NotionDeTres())
    monkeypatch.setattr(erpmod, "do_ambiente", lambda: ErpFalso())
    monkeypatch.setattr(RT.D, "ler_venda", lambda erp, vid: (_ for _ in ()).throw(RuntimeError("x")) if vid.endswith("b2") else carregar("base"))
    assert RT.main(["--todas"]) == 1
    assert capsys.readouterr().out.strip().splitlines()[-1] == "retratos: 1 ok, 1 erro"


def test_robo_retratos_existe_na_fila():
    import sys as _s
    _s.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3] / "servidor"))
    import robo_fila
    scripts = robo_fila.ROBOS["retratos"]
    assert scripts == ["robo_mc_retratos.py"]
    assert (pathlib.Path(__file__).resolve().parents[3] / scripts[0]).is_file()


# ---------------------------------------------------------------- nunca jogar fora um retrato bom
BOM = json.dumps({"v": 1, "venda": VENDA_ID, "parcelas": []})


def test_erro_com_retrato_bom_nao_mexe_no_retrato(monkeypatch):
    codigo, g, _ = _cli(monkeypatch, venda=RuntimeError("o ERP caiu"),
                        anteriores={"MC - RETRATO": BOM, "MC - RETRATO EM": "2026-11-02 05:00"})
    assert codigo == 1
    assert "MC - RETRATO" not in g
    import re
    assert re.match(r"^2026-11-02 05:00 \| ERRO \d{4}-\d{2}-\d{2} \d{2}:\d{2}: o ERP caiu$", g["MC - RETRATO EM"])


def test_erro_repetido_guarda_so_a_hora_do_ultimo_bom(monkeypatch):
    antigo = "2026-11-02 05:00 | ERRO 2026-11-03 05:00: o ERP caiu"
    _, g, _ = _cli(monkeypatch, venda=RuntimeError("de novo"), anteriores={"MC - RETRATO": BOM, "MC - RETRATO EM": antigo})
    assert g["MC - RETRATO EM"].startswith("2026-11-02 05:00 | ERRO ") and g["MC - RETRATO EM"].endswith(": de novo")
    assert "o ERP caiu" not in g["MC - RETRATO EM"] and "MC - RETRATO" not in g


def test_erro_com_retrato_que_nao_e_json_grava_erro_como_antes(monkeypatch):
    for ruim in ("ERRO: antigo", "{quebrado"):
        _, g, _ = _cli(monkeypatch, venda=RuntimeError("o ERP caiu"),
                       anteriores={"MC - RETRATO": ruim, "MC - RETRATO EM": "2026-11-02 05:00"})
        assert g["MC - RETRATO"] == "ERRO: o ERP caiu"
        import re
        assert re.match(r"^ \| ERRO \d{4}-\d{2}-\d{2} \d{2}:\d{2}: o ERP caiu$", g["MC - RETRATO EM"]), g["MC - RETRATO EM"]


def test_sucesso_troca_o_retrato_bom_pelo_novo(monkeypatch):
    _, g, _ = _cli(monkeypatch, anteriores={"MC - RETRATO": BOM, "MC - RETRATO EM": "2026-11-02 05:00"})
    assert json.loads(g["MC - RETRATO"])["parcelas"] and "|" not in g["MC - RETRATO EM"]


# ---------------------------------------------------------------- falhas no meio da leitura diária
class NotionQueCai(NotionDeTres):
    def linhas(self, db_id):
        return [_linha("p-sem-id", None), _linha("p-cai", VENDA_ID), _linha("p-segue", VENDA_ID)]

    def gravar_texto_longo(self, page_id, props, nome, texto):
        if page_id == "p-cai":
            raise RuntimeError("Notion PATCH -> HTTP 502")
        return super().gravar_texto_longo(page_id, props, nome, texto)


def test_notion_cai_ao_gravar_uma_linha_e_as_outras_seguem(monkeypatch):
    monkeypatch.setattr(RT.D, "ler_venda", lambda erp, vid: carregar("base"))
    n = NotionQueCai()
    assert RT.atualizar_todas(n, ErpFalso(), "db1", "2026-11-03 08:00") == (1, 1)
    assert "p-cai" not in n.gravado and json.loads(n.gravado["p-segue"]["MC - RETRATO"])["v"] == 1


def test_todas_sem_senha_do_erp_vira_erro_contado(monkeypatch, capsys):
    from venda.mc import erp as erpmod
    monkeypatch.setenv("NOTION_TOKEN", "t"); monkeypatch.setenv("DB_VENDAS_COND", "db1")
    n = NotionDeTres()
    monkeypatch.setattr(N, "Notion", lambda token, sessao=None: n)

    def sem_senha():
        raise KeyError("MC_ROBO_EMAIL")
    monkeypatch.setattr(erpmod, "do_ambiente", sem_senha)
    assert RT.main(["--todas"]) == 1
    assert capsys.readouterr().out.strip().splitlines()[-1] == "retratos: 0 ok, 2 erro"
    assert n.gravado["p-ok"]["MC - RETRATO"].startswith("ERRO: ")


def test_ultimo_bom_so_vale_se_for_uma_data_e_hora(monkeypatch):
    import re
    for estranho in ("ERRO: antigo", "PROCESSANDO [t=1]", "sem data nenhuma", "2026-11-02", ""):
        _, g, _ = _cli(monkeypatch, venda=RuntimeError("o ERP caiu"),
                       anteriores={"MC - RETRATO": BOM, "MC - RETRATO EM": estranho})
        assert "MC - RETRATO" not in g, estranho
        assert re.match(r"^ \| ERRO \d{4}-\d{2}-\d{2} \d{2}:\d{2}: o ERP caiu$", g["MC - RETRATO EM"]), (estranho, g["MC - RETRATO EM"])
    _, g, _ = _cli(monkeypatch, venda=RuntimeError("o ERP caiu"),
                   anteriores={"MC - RETRATO": BOM, "MC - RETRATO EM": "2026-11-02 05:00 | PROCESSANDO [t=1]"})
    assert g["MC - RETRATO EM"].startswith("2026-11-02 05:00 | ERRO ")


def test_nunca_leu_e_falhou_nao_grava_hora_de_leitura(monkeypatch):
    """Sem retrato bom, MC - RETRATO EM não começa com data: a tela nunca diz 'Lido do ERP em <hora da falha>'."""
    for anteriores in (None, {"MC - RETRATO": "", "MC - RETRATO EM": ""}):
        codigo, g, _ = _cli(monkeypatch, venda=RuntimeError("o ERP caiu"), anteriores=anteriores)
        assert codigo == 1 and g["MC - RETRATO"] == "ERRO: o ERP caiu"
        assert g["MC - RETRATO EM"].startswith(" | ERRO 20") and g["MC - RETRATO EM"].endswith(": o ERP caiu")
        assert not g["MC - RETRATO EM"][:4].isdigit()
    # uma leitura boa depois grava a hora de volta
    _, g, _ = _cli(monkeypatch, anteriores={"MC - RETRATO": "ERRO: o ERP caiu", "MC - RETRATO EM": " | ERRO 2026-11-02 05:00: o ERP caiu"})
    assert g["MC - RETRATO EM"][:2] == "20" and "|" not in g["MC - RETRATO EM"]


# ---------------------------------------------------------------- amarra o Python ao JS
GABARITO_JS = pathlib.Path(__file__).resolve().parents[2] / "testes" / "dados" / "antecipacao-retratos.json"


def test_gabarito_dos_testes_js_e_o_que_o_python_gera():
    """Os testes do JS (Antecipacao.js, o dossiê e o AntecipacaoVenda.gs) leem venda/testes/dados/antecipacao-retratos.json.
    Se `normalizar` mudar e esse arquivo não, a conta do JS passa a ser provada contra um retrato que o robô não gera mais."""
    gerado = {"base": RT.normalizar(carregar("base"), "2026-10-21")}
    atual = json.loads(GABARITO_JS.read_text(encoding="utf-8"))
    comando = ('python -c "import json,pathlib; from venda.mc import retrato as RT; '
               "b=json.loads(pathlib.Path('venda/mc/testes/dados/antecipacao/base.json').read_text(encoding='utf-8')); "
               "pathlib.Path('venda/testes/dados/antecipacao-retratos.json').write_text("
               "json.dumps({'base': RT.normalizar(b, '2026-10-21')}, ensure_ascii=False), encoding='utf-8')\"")
    assert atual == gerado, (
        "venda/testes/dados/antecipacao-retratos.json divergiu do retrato que o robô gera (normalizar do retrato.py com base.json, "
        "lido em 2026-10-21). Regenere na raiz do repositório e rode as suítes de novo:\n" + comando)
