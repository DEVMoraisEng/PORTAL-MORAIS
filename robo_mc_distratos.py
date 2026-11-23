#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
robo_mc_distratos.py — PORTAL-MORAIS · distrato de venda lançada À MÃO no Mais Controle (23/11/2026)

Para cada arquivo da base DISTRATOS com "SEM VENDA NO MAIS CONTROLE", procura a venda pela casa no ERP. Uma venda
manual com sinal retido e nada em aberto ganha " (Distrato)" na descrição; o resto vira "ATENÇÃO" no arquivo para
fazer à mão (venda/mc/distrato_manual.py). Roda junto do robô de contas (06:23).

No servidor:  python servidor\robo_fila.py --robo contas   (MC_VIA=porteiro; grava só com ROBOS_APLICAR.txt)
"""
import os
import sys

from venda.mc import distrato_manual

if __name__ == "__main__":
    sys.exit(distrato_manual.main(["--aplicar"] if os.environ.get("APLICAR") == "1" else []))
