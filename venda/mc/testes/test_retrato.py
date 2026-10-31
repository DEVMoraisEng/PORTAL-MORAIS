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


def _cli(monkeypatch, sem_venda_id=False, venda=None):
    visto = {}
    monkeypatch.setenv("NOTION_TOKEN", "t")
    monkeypatch.setattr(RT, "Notion", NotionFalso)
    monkeypatch.setattr(RT.E, "do_ambiente", lambda: "erp-falso")

    def ler_venda(erp, vid):
        visto["erp"], visto["vid"] = erp, vid
        return venda if venda is not None else carregar("base")
    monkeypatch.setattr(RT.D, "ler_venda", ler_venda)
    if sem_venda_id:
        orig = NotionFalso.__init__

        def init(self, *a, **k):
            orig(self, *a, **k); self.props["MC - VENDA ID"]["rich_text"] = []
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
    assert codigo == 1 and g["MC - RETRATO"].startswith("ERRO: ") and visto == {}


def test_cli_venda_de_outra_obra_grava_erro(monkeypatch):
    v = carregar("base"); v["work"]["name"] = "OUTRA OBRA"
    codigo, g, _ = _cli(monkeypatch, venda=v)
    assert codigo == 1 and g["MC - RETRATO"].startswith("ERRO: ")
