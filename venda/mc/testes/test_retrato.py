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
