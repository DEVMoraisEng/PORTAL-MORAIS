# -*- coding: utf-8 -*-
"""Retrato da venda do condomínio para a antecipação (spec v2, 31/10/2026). Puro: sem rede.
O portal faz a conta em cima deste retrato (venda/Antecipacao.js)."""
from . import regras as R
from . import distrato as D
from . import erp as E
from .notion import Notion

OBRA = "CONDOMÍNIO RESERVA DOS IPÊS"
TABELA_PRE, TABELA_POS = "INCC-M", "IPCA + 1% a.m."


class ForaDoCondominio(ValueError):
    pass


def _tipo(p: dict) -> str:
    rd = p.get("readjustmentDetail") or {}
    t = (rd.get("type") or {}).get("id")
    tab = ((rd.get("table") or {}).get("name") or "").strip()
    if t == R.TIPO_SINAL:
        return "sinal"
    if t == R.TIPO_ENTRADA:
        return "entrada"
    if t in (R.TIPO_FGTS, R.TIPO_FINANCIAMENTO):
        return "terceiros"
    if t in (R.TIPO_INTERMEDIARIA, R.TIPO_CHAVES):
        return "balao"
    if t == R.TIPO_PARCELA:
        return "pos" if tab == TABELA_POS else "pre" if tab == TABELA_PRE else "outro"
    return "outro"


def normalizar(venda: dict, lido_em: str) -> dict:
    obra = ((venda.get("work") or {}).get("name") or "").strip()
    if obra != OBRA:
        raise ForaDoCondominio(obra or "sem obra")
    parcelas = []
    for p in (venda.get("tradeReceivable") or {}).get("installments") or []:
        rd = p.get("readjustmentDetail") or {}
        raw = float(rd.get("rawValue") or 0)
        valor = float(p.get("plannedValue") or 0)
        parcelas.append({"id": p.get("id"), "data": str(p.get("plannedDate") or "")[:10], "tipo": _tipo(p),
                         "tabela": ((rd.get("table") or {}).get("name") or None),
                         "raw": round(raw, 2), "valor": round(valor, 2),
                         "fator": 1 + float(rd.get("accumulatedReadjustmentValue") or 0) / 100 if rd.get("table") else 1.0,
                         "pago": D.tem_recebimento(p) and not D.recebida_em_parte(p),
                         "parcial": D.recebida_em_parte(p)})
    parcelas.sort(key=lambda x: (x["data"], x["id"] or ""))
    return {"v": 1, "venda": venda.get("id"), "obra": obra, "lido": lido_em[:10], "parcelas": parcelas}


def _id_do_erp(valor) -> str:
    """O id da venda no ERP é um UUID COM hífens (o GET /sales/{id} usa assim). Vem da coluna como texto."""
    h = R.so_hex(valor)
    return "%s-%s-%s-%s-%s" % (h[:8], h[8:12], h[12:16], h[16:20], h[20:]) if h else ""


def main(argv=None) -> int:
    """python -m venda.mc.retrato --page <pageId da VENDAS CONDOMÍNIO>. Só LÊ o ERP; grava no Notion
    MC - RETRATO (JSON, ou 'ERRO: motivo') e MC - RETRATO EM. Ambiente: NOTION_TOKEN (+ ERP como o lancar.py)."""
    import argparse, datetime as dt, json, os
    a = argparse.ArgumentParser()
    a.add_argument("--page", required=True)
    args = a.parse_args(argv)
    n = Notion(os.environ["NOTION_TOKEN"])
    props = (n.pagina(args.page) or {}).get("properties") or {}
    agora = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
    try:
        vid = _id_do_erp(R._valor({R.chave(k): v for k, v in props.items()}.get(R.chave("MC - VENDA ID"))))
        if not vid:
            raise ValueError("venda sem MC - VENDA ID")
        r = normalizar(D.ler_venda(E.do_ambiente(), vid), agora)
        texto = json.dumps(r, ensure_ascii=False, separators=(",", ":"))
    except Exception as e:   # o portal mostra o motivo; o log do servidor fica curto
        texto = "ERRO: " + (str(e) or type(e).__name__)[:180]
    if not n.gravar_texto_longo(args.page, props, "MC - RETRATO", texto):
        print("coluna MC - RETRATO não existe na página")
        return 2
    n.gravar_textos(args.page, props, {"MC - RETRATO EM": agora})
    print("retrato:", "ERRO" if texto.startswith("ERRO") else "gravado")
    return 1 if texto.startswith("ERRO") else 0


if __name__ == "__main__":
    raise SystemExit(main())
