# -*- coding: utf-8 -*-
"""Põe a raiz do repositório no sys.path — os robôs (robo_mc_*.py,
fetch_*.py) vivem na raiz, não em pacote instalado."""
import sys
from pathlib import Path

RAIZ = str(Path(__file__).resolve().parent.parent)
if RAIZ not in sys.path:
    sys.path.insert(0, RAIZ)
