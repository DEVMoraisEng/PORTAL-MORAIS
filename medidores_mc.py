#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
medidores_mc.py — PORTAL-MORAIS · 04/11/2026

Publica dist/medidores_mc.json: quantos MEDIDORES cada obra já comprou no
Mais Controle. É o que alimenta o alerta "MEDIDOR … COMPRADO" na aba
"Verificar se a obra está apta para a solicitação" (ligacoes.html).

  PADRÃO DE ENERGIA …  -> medidor de ENERGIA (EQUATORIAL)
  HIDROMETRO …         -> medidor de ÁGUA (SANEAGO / SANESC)
  (CAIXA DE HIDROMETRO e KIT CAVALETE P/ HIDROMETRO NÃO contam: não começam
   com "HIDROMETRO")

DE ONDE VEM: dist/analise/analise_detalhe.json, o Orçado x Realizado de todas
as obras que o OR-ADO-REALIZADO coleta do MC todo dia e grava neste
repositório. "Comprado" = quantidade REALIZADA do insumo (pedido de compra já
lançado no MC para o centro de custo da obra). Nenhuma chamada nova ao MC.

Sem o arquivo de análise (ou com ele quebrado) grava um JSON vazio com ok=false
e sai com código 0 — nunca derruba a publicação do site.
"""

import json
import os
import re
import unicodedata
from datetime import datetime, timezone

ORIGEM = os.path.join("dist", "analise", "analise_detalhe.json")
SAIDA = os.path.join("dist", "medidores_mc.json")


def N(s):
    s = unicodedata.normalize("NFD", str(s or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.upper()).strip()


def tipo_do_insumo(desc):
    d = N(desc)
    if d.startswith("PADRAO DE ENERGIA"):
        return "energia"
    if d.startswith("HIDROMETRO"):
        return "agua"
    return None


def gravar(obj):
    os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
    with open(SAIDA, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def main():
    agora = datetime.now(timezone.utc).isoformat()
    try:
        with open(ORIGEM, encoding="utf-8") as f:
            d = json.load(f)
        cols = d.get("cols") or []
        ix = {c: i for i, c in enumerate(cols)}
        obras = d.get("obras") or []
        linhas = d.get("linhas") or []
    except Exception as e:  # noqa: BLE001
        print(f"medidores_mc: sem {ORIGEM} ({e}) — grava vazio.")
        gravar({"ok": False, "erro": "SEM_ANALISE", "updated_at": agora, "obras": {}})
        return

    saida = {}
    for l in linhas:
        try:
            tp = tipo_do_insumo(l[ix["insumo"]])
            if not tp:
                continue
            ob = obras[int(l[ix["obra"]])]
            nome = ob[1] if isinstance(ob, (list, tuple)) else (ob.get("obra_nome") or "")
            o = saida.setdefault(nome, {"obra": nome})
            t = o.setdefault(tp, {"orcado": 0, "comprado": 0, "insumos": []})
            t["orcado"] += float(l[ix["qtd_orcada"]] or 0)
            t["comprado"] += float(l[ix["qtd_realizada"]] or 0)
            t["insumos"].append(str(l[ix["codigo"]]) + " - " + str(l[ix["insumo"]]))
        except Exception:  # noqa: BLE001 — linha estranha não para o resto
            continue

    for o in saida.values():
        for tp in ("energia", "agua"):
            if tp in o:
                o[tp]["orcado"] = int(round(o[tp]["orcado"]))
                o[tp]["comprado"] = int(round(o[tp]["comprado"]))
                o[tp]["insumos"] = sorted(set(o[tp]["insumos"]))

    gravar({
        "ok": True,
        "updated_at": agora,
        "data_extracao": d.get("data_extracao") or d.get("updated_at"),
        "fonte": "Mais Controle · Orçado x Realizado (qtd. realizada)",
        "obras": saida,
    })
    com = sum(1 for o in saida.values() if (o.get("energia") or {}).get("comprado") or (o.get("agua") or {}).get("comprado"))
    print(f"medidores_mc: {len(saida)} obras com medidor no orçamento, {com} com compra lançada.")


if __name__ == "__main__":
    main()
