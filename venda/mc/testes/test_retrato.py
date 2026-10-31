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


def _cli(monkeypatch, sem_venda_id=False, venda=None, valor_id=None):
    visto = {}
    monkeypatch.setenv("NOTION_TOKEN", "t")
    from venda.mc import erp as erpmod
    monkeypatch.setattr(N, "Notion", NotionFalso)
    monkeypatch.setattr(erpmod, "do_ambiente", lambda: "erp-falso")

    def ler_venda(erp, vid):
        visto["erp"], visto["vid"] = erp, vid
        return venda if venda is not None else carregar("base")
    monkeypatch.setattr(RT.D, "ler_venda", ler_venda)
    if sem_venda_id or valor_id is not None:
        orig = NotionFalso.__init__

        def init(self, *a, **k):
            orig(self, *a, **k)
            self.props["MC - VENDA ID"]["rich_text"] = [{"plain_text": valor_id}] if valor_id else []
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
