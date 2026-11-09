# -*- coding: utf-8 -*-
"""Financeiro por unidade do Reserva dos Ipês (página Boletos e Financeiro, 09/11/2026).
Tudo aqui é PURO: recebe as linhas da base BANCO DE DADOS VENDAS CONDOMÍNIO e devolve os números.
As contas são em centavos inteiros para a soma das unidades bater com o total, centavo por centavo.
Recebido é o dinheiro que o ERP registra, com juros; os outros números são o saldo em aberto das parcelas."""
import json
import re

from . import retrato as RT

CAMPOS = ("recebido", "a_vencer", "vencido", "caixa", "permuta")


def _c(valor) -> int:
    return int(round(float(valor or 0) * 100))


def _r(centavos: int) -> float:
    return round(centavos / 100, 2)


def _partes(p: dict) -> tuple[int, int]:
    """(recebido, aberto) em centavos. Retrato antigo, sem os campos novos, usa pago/parcial: a parcial conta como
    inteira em aberto até a próxima leitura, sem inventar quanto entrou."""
    valor = _c(p.get("valor"))
    if "aberto" in p:
        return _c(p.get("recebido")), _c(p.get("aberto"))
    if p.get("pago") and not p.get("parcial"):
        return valor, 0
    return 0, valor


def resumo_da_venda(parcelas: list[dict], hoje: str) -> dict:
    """Os cinco números de uma venda, os dias de atraso da parcela vencida mais antiga e a próxima parcela a vencer."""
    c = dict.fromkeys(CAMPOS, 0)
    mais_antiga, proxima = "", None
    for p in parcelas:
        recebido, aberto = _partes(p)
        c["recebido"] += recebido
        if aberto <= 0:
            continue
        data = str(p.get("data") or "")
        if p.get("permuta"):
            c["permuta"] += aberto
        elif p.get("tipo") == "terceiros":
            c["caixa"] += aberto
        elif data < hoje:
            c["vencido"] += aberto
            mais_antiga = min(mais_antiga or data, data)
        else:
            c["a_vencer"] += aberto
            if proxima is None or data < proxima["data"]:
                proxima = {"data": data, "valor": _r(aberto)}
    out = {k: _r(v) for k, v in c.items()}
    out["centavos"] = c
    out["dias_atraso"] = _dias(mais_antiga, hoje) if mais_antiga else 0
    out["proxima"] = proxima
    return out


def _dias(de: str, ate: str) -> int:
    import datetime as dt
    return (dt.date.fromisoformat(ate) - dt.date.fromisoformat(de)).days


def _campo(props: dict, nome: str):
    return RT._valor_da_coluna(props, nome)


def _ordem(unidade: str):
    m = re.match(r"\s*(\d+)", unidade or "")
    return (0, int(m.group(1)), unidade) if m else (1, 0, unidade or "")


def montar(linhas: list[dict], hoje: str) -> dict:
    """Linhas do Notion -> totais, unidades, vendas ainda não lançadas e vendas lançadas sem leitura.
    Só entram nos totais as vendas com retrato legível. Linha sem UNIDADE é ignorada."""
    unidades, nao_lancadas, sem_leitura = [], [], []
    total = dict.fromkeys(CAMPOS, 0)
    lido = ""
    for linha in linhas:
        props = linha.get("properties") or {}
        unidade = str(_campo(props, "UNIDADE") or "").strip()
        if not unidade:
            continue
        comprador = str(_campo(props, "PROPONENTE") or "").strip()
        if not str(_campo(props, RT.COL_VENDA_ID) or "").strip():
            nao_lancadas.append(unidade)
            continue
        em = str(_campo(props, RT.COL_RETRATO_EM) or "")
        lido_aqui = em[:16] if re.match(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}", em) else ""
        try:
            retrato = json.loads(str(_campo(props, RT.COL_RETRATO) or ""))
            parcelas = retrato["parcelas"]
            r = resumo_da_venda(parcelas, hoje)
        except (ValueError, KeyError, TypeError, AttributeError):
            sem_leitura.append(unidade)
            continue
        for k in CAMPOS:
            total[k] += r["centavos"][k]
        del r["centavos"]
        r.update(unidade=unidade, comprador=comprador, lido=lido_aqui, erro_leitura="| ERRO" in em)
        unidades.append(r)
        lido = max(lido, lido_aqui)
    unidades.sort(key=lambda u: _ordem(u["unidade"]))
    nao_lancadas.sort(key=_ordem)
    sem_leitura.sort(key=_ordem)
    return {"hoje": hoje, "lido": lido, "totais": {k: _r(v) for k, v in total.items()}, "unidades": unidades,
            "nao_lancadas": nao_lancadas, "sem_leitura": sem_leitura}
