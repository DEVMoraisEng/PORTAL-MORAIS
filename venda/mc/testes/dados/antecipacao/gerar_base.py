# -*- coding: utf-8 -*-
"""Venda SINTÉTICA da unidade 13 no formato do GET /sales/{id} (formato medido numa venda real em 31/10/2026).
Números da prova de 21/10 (saldo corrigido 37.446,74 com INCC acumulado 12,30%). Nenhum dado de cliente."""
import json, sys, uuid, datetime as dt
from decimal import Decimal, ROUND_HALF_UP
SINAL, ENTRADA, FIN, FGTS = "00e30a7a-7a49-422e-b8b1-3ba4f927e250", "bc569ea7-63ae-401b-b3d1-faf65a6b4465", "994f6f20-cebf-4499-839c-f61afda9b174", "88da2643-8f30-4a17-9946-9039a9f1e1ce"
INTER, PARC, CHAVES = "3a1c631a-e0db-4962-b4b5-32beee649806", "aff8eac2-40c6-4b59-a837-f09eb4c5b60b", "aa7ff517-46d6-4b46-8856-129448181fec"
n = [0]
def pid():
    n[0] += 1; return str(uuid.UUID(int=n[0]))
def r2(x): return float(Decimal(str(x)).quantize(Decimal("0.01"), ROUND_HALF_UP))
def parcela(data, tipo, raw, tabela=None, acc=0.0, pago=False):
    pv = r2(Decimal(str(raw)) * (1 + Decimal(str(acc)) / 100)) if tabela else raw
    return {"id": pid(), "plannedDate": data + "T00:00:00", "plannedValue": pv, "received": pago,
            "sumOfReceivedValues": pv if pago else 0.0, "pendingValue": 0.0 if pago else pv,
            "receipts": [{"value": pv, "interestValue": 0.0, "discountValue": 0.0}] if pago else [],
            "readjustmentDetail": {"type": {"id": tipo}, "table": {"name": tabela} if tabela else None, "rawValue": raw,
                                   "reference": 2 if tabela else 0, "accumulatedReadjustmentValue": acc if tabela else 0.0}}
def mes(a, m): return "%04d-%02d-10" % (a + (m - 1) // 12, (m - 1) % 12 + 1)
P = [parcela("2025-02-10", SINAL, 1000.0, pago=True), parcela("2025-03-12", SINAL, 3000.0, pago=True),
     parcela("2025-04-11", SINAL, 3000.0, pago=True), parcela("2025-05-11", SINAL, 3000.0, pago=True),
     parcela("2025-03-12", FGTS, 15000.0, pago=True), parcela("2025-03-12", FIN, 214000.0, pago=True)]
for k in range(24):   # pré-chaves mar/2025 .. fev/2027; pagas até out/2026
    data = mes(2025, 3 + k); paga = data < "2026-10-21"
    P.append(parcela(data, PARC, 295.49, "INCC-M", round(0.5 * (k + 1), 6) if paga else 12.30, paga))
P.append(parcela("2026-12-10", INTER, 8954.18, "INCC-M", 12.30))
P.append(parcela("2027-02-10", CHAVES, 6267.85, "INCC-M", 12.30))
for k in range(24):
    P.append(parcela(mes(2027, 3 + k), PARC, 705.89, "IPCA + 1% a.m.", 12.30))
venda = {"id": "00000000-0000-0000-0000-0000000000a1", "work": {"name": "CONDOMÍNIO RESERVA DOS IPÊS"},
         "tradeReceivable": {"referenceDate": "2025-02-10", "installments": P}}
abertas = [p for p in P if p["readjustmentDetail"]["table"] and not p["received"]]
print("saldo corrigido em aberto:", round(sum(p["plannedValue"] for p in abertas), 2), "| parcelas:", len(P))
open(sys.argv[1], "w", encoding="utf-8").write(json.dumps(venda, ensure_ascii=False, indent=1))
