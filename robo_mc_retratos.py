#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
robo_mc_retratos.py — PORTAL-MORAIS · SÓ LEITURA no Mais Controle (31/10/26)

Retrato diário das vendas do condomínio: para cada linha da base BANCO DE DADOS VENDAS CONDOMÍNIO
(DB_VENDAS_COND) com "MC - VENDA ID", lê a venda no ERP e grava o retrato em "MC - RETRATO" e a hora em
"MC - RETRATO EM" (aba Financeiro e simulação da antecipação). Nada é gravado no ERP.

Ambiente: NOTION_TOKEN, DB_VENDAS_COND e MC_VIA=porteiro (no servidor; o robo_fila.py --robo retratos monta tudo).
Log curto: "retratos: N ok, M erro" — nunca nome nem valor.
"""
import sys

from venda.mc import retrato

if __name__ == "__main__":
    sys.exit(retrato.main(["--todas"]))
