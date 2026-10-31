# -*- coding: utf-8 -*-
"""Retrato da venda do condomínio para a antecipação (spec v2, 31/10/2026).
`normalizar` é PURA (sem rede). `main`, `gravar_pagina` e `atualizar_todas` falam com o Notion e o ERP
(só LEEM o ERP); os imports de rede ficam dentro delas. O portal faz a conta em cima deste retrato
(venda/Antecipacao.js)."""
from . import regras as R
from . import distrato as D

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
        raise ForaDoCondominio("venda de outra obra: %s" % (obra or "sem obra"))
    parcelas = []
    for p in (venda.get("tradeReceivable") or {}).get("installments") or []:
        rd = p.get("readjustmentDetail") or {}
        raw = float(rd.get("rawValue") or 0)
        valor = float(p.get("plannedValue") or 0)
        parcelas.append({"id": p.get("id"), "data": str(p.get("plannedDate") or "")[:10], "tipo": _tipo(p),
                         "tabela": ((rd.get("table") or {}).get("name") or None),
                         "raw": round(raw, 2), "valor": round(valor, 2),
                         "fator": 1 + float(rd.get("accumulatedReadjustmentValue") or 0) / 100 if rd.get("table") else 1.0,
                         "pagoEm": "",   # abaixo, só quando paga por inteiro
                         "pago": D.tem_recebimento(p) and not D.recebida_em_parte(p),
                         "parcial": D.recebida_em_parte(p)})
    for q, p in zip(parcelas, (venda.get("tradeReceivable") or {}).get("installments") or []):
        if q["pago"]:
            q["pagoEm"] = str(p.get("dateOfReceipt") or "")[:10]
    parcelas.sort(key=lambda x: (x["data"], x["id"] or ""))
    return {"v": 1, "venda": venda.get("id"), "obra": obra, "lido": lido_em[:10], "parcelas": parcelas}


COL_VENDA_ID, COL_RETRATO, COL_RETRATO_EM = "MC - VENDA ID", "MC - RETRATO", "MC - RETRATO EM"


def _id_do_erp(valor) -> str:
    """O id da venda no ERP é um UUID COM hífens (o GET /sales/{id} usa assim). Vem da coluna como texto."""
    if not str(valor or "").strip():
        raise ValueError("venda sem MC - VENDA ID")
    h = R.so_hex(valor)
    if not h:
        raise ValueError("MC - VENDA ID inválido")
    return "%s-%s-%s-%s-%s" % (h[:8], h[8:12], h[12:16], h[16:20], h[20:])


def _valor_da_coluna(props: dict, nome: str):
    return R._valor({R.chave(k): v for k, v in (props or {}).items()}.get(R.chave(nome)))


def _json_valido(texto) -> bool:
    import json
    t = str(texto or "").strip()
    if not t.startswith("{"):
        return False
    try:
        return isinstance(json.loads(t), dict)
    except ValueError:
        return False


def gravar_pagina(notion, obter_erp, page_id: str, props: dict, agora: str) -> str:
    """Lê a venda da página e grava o retrato. Só LÊ o ERP.
    `obter_erp` é chamado só se houver id (falta de senha vira erro da página, não queda do robô).
    Nunca joga fora um retrato bom: se a leitura falha e MC - RETRATO já tem um JSON válido, ele fica como está
    e só MC - RETRATO EM ganha '<hora do último bom> | ERRO <agora>: <motivo>'. Sem JSON válido, grava
    'ERRO: motivo' em MC - RETRATO e ' | ERRO <agora>: <motivo>' (sem hora na frente) em MC - RETRATO EM: a hora da falha
    nunca ocupa o lugar da hora de uma leitura boa, então a tela não diz 'Lido do ERP em <hora da falha>'.
    Devolve 'ok', 'erro' (o motivo foi gravado) ou 'sem_coluna' (a página não tem MC - RETRATO)."""
    import json, re
    em = agora   # MC - RETRATO EM: a hora de uma leitura BOA (só muda no erro)
    try:
        vid = _id_do_erp(_valor_da_coluna(props, COL_VENDA_ID))
        r = normalizar(D.ler_venda(obter_erp(), vid), agora)
        texto = json.dumps(r, ensure_ascii=False, separators=(",", ":"))
    except Exception as e:   # o portal mostra o motivo; o log do servidor fica curto
        motivo = (str(e) or type(e).__name__)[:180]
        if _json_valido(_valor_da_coluna(props, COL_RETRATO)):
            ultimo_bom = str(_valor_da_coluna(props, COL_RETRATO_EM) or "")[:16]
            if not re.match(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}", ultimo_bom):   # texto solto na coluna não vira "último bom"
                ultimo_bom = ""
            notion.gravar_textos(page_id, props, {COL_RETRATO_EM: "%s | ERRO %s: %s" % (ultimo_bom, agora, motivo)})
            return "erro"
        texto = "ERRO: " + motivo
        em = " | ERRO %s: %s" % (agora, motivo)   # sem leitura boa não há hora de leitura: a coluna só diz que falhou
    # Limite de leitura: o Notion devolve, ao ler a página, no máximo 25 itens de rich_text por coluna. Cada item grava até 1900
    # caracteres, então cabem cerca de 47 mil caracteres. Hoje o retrato tem cerca de 190 caracteres por parcela (56 parcelas
    # = 10,6 mil), o que dá folga para umas 250 parcelas. Venda com bem mais que isso seria lida cortada pelo portal.
    if not notion.gravar_texto_longo(page_id, props, COL_RETRATO, texto):
        return "sem_coluna"
    notion.gravar_textos(page_id, props, {COL_RETRATO_EM: em})
    return "erro" if texto.startswith("ERRO") else "ok"


def atualizar_todas(notion, erp, db_id: str, agora: str) -> tuple[int, int]:
    """`erp`: o cliente do ERP ou uma função que o cria (chamada só quando há venda para ler).
    Leitura diária: um retrato por linha da base de vendas do condomínio que já tem MC - VENDA ID.
    Linha sem id é pulada sem gravar nada; erro numa venda não para as outras. Devolve (ok, erro)."""
    cache = []

    def obter():   # aceita o cliente do ERP ou quem o cria; cria uma vez só, e só se houver venda para ler
        if not cache:
            cache.append(erp() if callable(erp) else erp)
        return cache[0]
    ok = erro = 0
    for linha in notion.linhas(db_id):
        props = linha.get("properties") or {}
        if not str(_valor_da_coluna(props, COL_VENDA_ID) or "").strip():
            continue
        try:
            res = gravar_pagina(notion, obter, linha["id"], props, agora)
        except Exception:   # falha ao gravar no Notion: conta e segue para a próxima
            res = "erro"
        if res == "ok":
            ok += 1
        else:
            erro += 1
    return ok, erro


def main(argv=None) -> int:
    """python -m venda.mc.retrato --page <pageId da VENDAS CONDOMÍNIO>   (uma venda)
       python -m venda.mc.retrato --todas                                (todas; lê DB_VENDAS_COND)
    Só LÊ o ERP; grava no Notion MC - RETRATO (JSON, ou 'ERRO: motivo') e MC - RETRATO EM (a hora, ou ' | ERRO <hora>: motivo').
    Ambiente: NOTION_TOKEN (+ ERP como o lancar.py). O stdout não leva nome nem valor."""
    import argparse, datetime as dt, os
    from . import erp as E
    from .notion import Notion
    a = argparse.ArgumentParser()
    g = a.add_mutually_exclusive_group(required=True)
    g.add_argument("--page")
    g.add_argument("--todas", action="store_true")
    args = a.parse_args(argv)
    agora = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
    if args.todas:
        db_id = os.environ.get("DB_VENDAS_COND", "").strip()
        if not db_id:
            print("falta a variável DB_VENDAS_COND (base BANCO DE DADOS VENDAS CONDOMÍNIO)")
            return 2
        ok, erro = atualizar_todas(Notion(os.environ["NOTION_TOKEN"]), E.do_ambiente, db_id, agora)
        print("retratos: %d ok, %d erro" % (ok, erro))
        return 0 if erro == 0 else 1
    n = Notion(os.environ["NOTION_TOKEN"])
    props = (n.pagina(args.page) or {}).get("properties") or {}
    res = gravar_pagina(n, E.do_ambiente, args.page, props, agora)
    if res == "sem_coluna":
        print("coluna MC - RETRATO não existe na página")
        return 2
    print("retrato:", "gravado" if res == "ok" else "ERRO")
    return 0 if res == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
