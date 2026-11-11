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


def _c_seguro(valor) -> int:
    try:
        return _c(valor)
    except (TypeError, ValueError):
        return 0


def repartir(recebido: int, rec, quitada) -> list:
    """Reparte o recebido do ERP (centavos, pode ter juros) pelas datas dos recebimentos, na proporção de cada um
    (11/11/2026, análise do condomínio). A sobra do arredondamento vai no último: a soma é exatamente a do ERP.
    Sem recebimento com valor: uma linha na data da quitação, ou sem data."""
    if recebido <= 0:
        return []
    pesos = []
    for item in rec or []:
        try:
            d, v = item[0], item[1]
        except (TypeError, IndexError, KeyError):
            continue
        c = _c_seguro(v)
        if c > 0:
            pesos.append((str(d or "")[:10], c))
    if not pesos:
        return [[str(quitada or "")[:10], _r(recebido)]]
    total, out, usado = sum(c for _, c in pesos), [], 0
    for i, (d, c) in enumerate(pesos):
        parte = recebido - usado if i == len(pesos) - 1 else recebido * c // total
        usado += parte
        out.append([d, _r(parte)])
    return out


def parcela_para_tela(p: dict, unidade: str) -> dict:
    """Uma parcela na lista que a tela usa para filtrar e somar (chaves curtas: o arquivo vai inteiro para a tela)."""
    recebido, aberto = _partes(p)
    return {"u": unidade, "t": p.get("tipo") or "", "s": p.get("sub") or "", "d": str(p.get("data") or ""),
            "o": _r(_c_seguro(p.get("raw")) or _c(p.get("valor"))), "v": _r(_c(p.get("valor"))), "a": _r(aberto),
            "m": 1 if p.get("permuta") else 0, "q": str(p.get("pagoEm") or ""),
            "r": repartir(recebido, p.get("rec"), p.get("pagoEm"))}


def resumo_da_venda(parcelas: list[dict], hoje: str) -> dict:
    """Os cinco números de uma venda, os dias de atraso da parcela vencida mais antiga e a próxima parcela a vencer."""
    c = dict.fromkeys(CAMPOS, 0)
    mais_antiga, proxima = "", None
    titulos = []

    def titulo(coluna, centavos, p, data):
        titulos.append({"coluna": coluna, "tipo": p.get("tipo") or "", "sub": p.get("sub") or "", "data": data, "valor": _r(centavos),
                        "pago_em": str(p.get("pagoEm") or "") if coluna == "recebido" else "",
                        "dias_atraso": _dias(data, hoje) if coluna == "vencido" else 0})
    for p in parcelas:
        recebido, aberto = _partes(p)
        data = str(p.get("data") or "")
        c["recebido"] += recebido
        if recebido > 0:
            titulo("recebido", recebido, p, data)
        if aberto <= 0:
            continue
        if p.get("permuta"):
            coluna = "permuta"
        elif p.get("tipo") == "terceiros":
            coluna = "caixa"
        elif data < hoje:
            coluna = "vencido"
            mais_antiga = min(mais_antiga or data, data)
        else:
            coluna = "a_vencer"
            if proxima is None or data < proxima["data"]:
                proxima = {"data": data, "valor": _r(aberto)}
        c[coluna] += aberto
        titulo(coluna, aberto, p, data)
    titulos.sort(key=lambda t: t["data"])
    out = {k: _r(v) for k, v in c.items()}
    out["centavos"] = c
    out["dias_atraso"] = _dias(mais_antiga, hoje) if mais_antiga else 0
    out["proxima"] = proxima
    out["titulos"] = titulos
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
    unidades, nao_lancadas, sem_leitura, titulos, na_tela = [], [], [], [], []
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
            linhas_tela = [parcela_para_tela(p, unidade) for p in parcelas]
        except (ValueError, KeyError, TypeError, AttributeError):
            sem_leitura.append(unidade)
            continue
        for k in CAMPOS:
            total[k] += r["centavos"][k]
        del r["centavos"]
        titulos += [dict(t, unidade=unidade, comprador=comprador) for t in r.pop("titulos")]
        na_tela += linhas_tela
        r.update(unidade=unidade, comprador=comprador, lido=lido_aqui, erro_leitura="| ERRO" in em)
        unidades.append(r)
        lido = max(lido, lido_aqui)
    unidades.sort(key=lambda u: _ordem(u["unidade"]))
    nao_lancadas.sort(key=_ordem)
    sem_leitura.sort(key=_ordem)
    titulos.sort(key=lambda t: _ordem(t["unidade"]))   # ordem estável: dentro da unidade segue o vencimento
    return {"hoje": hoje, "lido": lido, "totais": {k: _r(v) for k, v in total.items()}, "unidades": unidades, "titulos": titulos,
            "nao_lancadas": nao_lancadas, "sem_leitura": sem_leitura,
            "parcelas": sorted(na_tela, key=lambda x: (_ordem(x["u"]), x["d"]))}
