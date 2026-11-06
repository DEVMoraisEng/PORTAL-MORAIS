"""Anota no servidor a aba que este robô abriu no Chrome do porteiro (06/11/2026).

Robô MORTO (passou do prazo da fila, "Finalizar tarefa") não chega no `finally` e a aba
dele fica no Chrome central para sempre — com CDP a aba não morre com o processo. Em
06/11/2026 eram 7 abas sem dono e o Chrome central travou sem memória.

Cada robô grava `<pasta central>/abas-robos/<pid>-<aba>.json` ao abrir e apaga ao fechar.
A faxina do porteiro (`erp/faxina.py`, no comprovantes-mais-controle) fecha a aba de quem
morreu. MESMO FORMATO de lá: {"pid", "aba", "porta"}. Mudou um, mude o outro.

Nada aqui pode impedir o robô de trabalhar: todo erro é engolido.
"""
from __future__ import annotations

import contextlib
import json
import os
from pathlib import Path

PASTA_PADRAO = Path(r"C:\AUTOMAÇÕES MAIS CONTROLE\_central")


def _pasta() -> Path | None:
    valor = (os.environ.get("MC_CENTRAL") or "").strip()
    if valor.lower() == "off":
        return None
    return (Path(valor) if valor else PASTA_PADRAO) / "abas-robos"


def id_da_aba(page) -> str | None:
    """O targetId da aba (pelo CDP dela; não roda JS)."""
    with contextlib.suppress(Exception):
        s = page.context.new_cdp_session(page)
        try:
            return s.send("Target.getTargetInfo")["targetInfo"]["targetId"]
        finally:
            with contextlib.suppress(Exception):
                s.detach()
    return None


def registrar(page, porta: int, pasta: Path | None = None) -> Path | None:
    reg = pasta if pasta is not None else _pasta()
    aba = id_da_aba(page)
    if reg is None or not aba:
        return None
    with contextlib.suppress(Exception):
        reg.mkdir(parents=True, exist_ok=True)
        arq = reg / f"{os.getpid()}-{aba}.json"
        arq.write_text(json.dumps({"pid": os.getpid(), "aba": aba, "porta": int(porta)}), encoding="utf-8")
        return arq
    return None


def desregistrar(arq: Path | None) -> None:
    if arq is not None:
        with contextlib.suppress(OSError):
            arq.unlink()
