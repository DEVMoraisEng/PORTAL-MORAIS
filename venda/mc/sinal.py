# -*- coding: utf-8 -*-
"""Sinal confirmado no portal -> venda no Mais Controle só com o sinal (pedido do dono, 23/11/2026).

Quando alguém confirma o recebimento do SINAL na aba Recebimentos de uma casa de rua e a casa ainda não tem
"MC - VENDA ID", o portal põe na fila do servidor o pedido "mc-venda" com acao "sinal". Este robô:
 1. não faz nada se a casa já tem venda: "MC - VENDA ID" preenchida OU venda da mesma CASA desta obra no Mais
    Controle (a busca é pela casa, não pelo cliente: a mesma pessoa pode comprar duas casas). Venda da obra sem o
    número da casa na descrição = recusa e pede conferência (como o lancar.py, para não duplicar);
 2. cadastra o cliente se faltar (pelo CPF; nome igual a outro cadastro = recusa, o ERP não aceita);
 3. cria a venda com UMA parcela: o sinal. A baixa fica para alguém fazer no Mais Controle.

Valor do sinal, nesta ordem (regra combinada com o dono em 23/11/2026):
 - CONTRATO - SINAL VALOR, quando preenchido;
 - a soma dos pagamentos do sinal registrados no portal (cada pagamento tem valor);
 - o valor lido no comprovante do sinal (PDF com texto; um único valor claro);
 - senão R$ 1,00 MARCADO: a descrição da venda e a da parcela levam "VALOR A CONFIRMAR", para ninguém confundir
   com um sinal de verdade. Nunca zero, nunca chute.

Gravar exige as mesmas travas do lançamento (servidor/robo_fila.py): o pedido pediu "aplicar" E a fila tem
"pode_gravar" E existe _central/VENDA_APLICAR.txt. Sem isso roda a PRÉVIA: escreve em MC - SITUAÇÃO o que faria.

Uso:
    python -m venda.mc.sinal --page <id>              # prévia
    python -m venda.mc.sinal --page <id> --aplicar    # grava
    python -m venda.mc.sinal --page <id> --bloqueado  # pediram gravar, a trava está desligada
O stdout (log do servidor) leva só situação e códigos. Repositório público: nenhum dado real aqui nem nos testes."""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import sys

from . import recebimentos as REC
from . import regras as R
from .erp import ErpErro, do_ambiente, faltam_segredos

VALOR_A_CONFIRMAR = 1.00
MARCA = "VALOR A CONFIRMAR"
ORIGENS = {"CONTRATO": "valor do contrato (CONTRATO - SINAL VALOR)",
           "PORTAL": "soma dos pagamentos do sinal registrados no portal",
           "COMPROVANTE": "valor lido no comprovante do sinal",
           "A_CONFIRMAR": "R$ 1,00 marcado \"%s\" (sem valor no contrato, no portal e no comprovante)" % MARCA}

_RE_VALOR = re.compile(r"(?<![\d,.])(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})(?![\d,])")
_LINHA_RUIM = re.compile(r"TARIFA|JUROS|MULTA|DESCONTO|SALDO|LIMITE|IOF|ENCARGO", re.I)


class FalhaNotion(Exception):
    pass


def _num_br(s: str) -> float:
    return round(float(s.replace(".", "").replace(",", ".")), 2)


def valor_do_texto(texto: str) -> float | None:
    """Um único valor claro no texto do comprovante; senão None.
    Primeiro as linhas que falam de "valor" (sem tarifa/juros/saldo...); se não decidirem, todos os R$ do texto."""
    linhas = [ln for ln in str(texto or "").splitlines() if ln.strip()]
    if not linhas:
        return None

    def distintos(lns, so_com_rs):
        out = set()
        for ln in lns:
            if _LINHA_RUIM.search(ln):
                continue
            for m in _RE_VALOR.finditer(ln):
                antes = ln[:m.start()]
                if so_com_rs and not re.search(r"R\$\s*$", antes):
                    continue
                v = _num_br(m.group(1))
                if v > 0:
                    out.add(v)
        return out

    com_valor = [ln for ln in linhas if re.search(r"\bVALOR\b", R.chave(ln))]
    for grupo, so_rs in ((com_valor, False), (linhas, True)):
        vs = distintos(grupo, so_rs)
        if len(vs) == 1:
            return vs.pop()
        if len(vs) > 1:
            return None   # mais de um valor: não dá para afirmar qual é o sinal
    return None


def _comprovantes_do_sinal(props: dict) -> list:
    return REC._arquivos(REC._por_chave(props), REC.col_comprovante("SINAL"))


def valor_do_sinal(d: dict, props: dict, notion) -> tuple[float, str, str]:
    """(valor, origem, aviso). origem ∈ ORIGENS."""
    v = d["sinal"]["valor"]
    if v is not None and v > 0:
        return round(float(v), 2), "CONTRATO", ""
    pags = [p for p in REC.pagamentos(props).get("SINAL") or [] if not p.get("antigo")]
    soma = round(sum(p["valor"] for p in pags), 2)
    if soma > 0:
        return soma, "PORTAL", ""
    aviso = ""
    arqs = _comprovantes_do_sinal(props)
    if arqs:
        f = arqs[-1]
        url = ((f.get("file") or {}).get("url")) or ((f.get("external") or {}).get("url")) or ""
        mime = mimetypes.guess_type(str(f.get("name") or ""))[0] or ""
        try:
            texto = REC.texto_do_arquivo(notion.baixar(url), mime) if url else ""
        except Exception:   # noqa: BLE001 — sem leitura, cai no R$ 1,00 marcado
            texto, aviso = "", "não consegui baixar o comprovante"
        lido = valor_do_texto(texto)
        if lido:
            return lido, "COMPROVANTE", ""
        if not aviso:
            aviso = "o comprovante não tem um valor legível (foto, PDF digitalizado ou mais de um valor)"
    else:
        aviso = "o sinal não tem comprovante anexado"
    return VALOR_A_CONFIRMAR, "A_CONFIRMAR", aviso


def data_do_sinal(d: dict, props: dict) -> str | None:
    """Data da parcela: o 1º pagamento do sinal no portal; senão a data do recebimento; senão a do contrato."""
    pags = REC.pagamentos(props).get("SINAL") or []
    if pags:
        return pags[0]["data"]
    rec = REC._valor(REC._por_chave(props), REC.col_data("SINAL"))
    if rec and re.match(r"^\d{4}-\d{2}-\d{2}", str(rec)):
        return str(rec)[:10]
    return d["sinal"]["data"] or d.get("data_venda")


def faltas(d: dict) -> list[str]:
    f = []
    if not d.get("endereco"):
        f.append("Venda sem ENDEREÇO")
    if d.get("casa_ambigua"):
        f.append("CASA com mais de um número — deixe só o número da casa")
    elif not d.get("casa"):
        f.append("Venda sem número da CASA")
    if not d["comprador"].get("nome"):
        f.append("Falta o nome do comprador (CLIENTES)")
    if not R.cpf_valido(d["comprador"].get("cpf")):
        f.append("CPF do comprador vazio ou inválido")
    if not d.get("data_venda"):
        f.append("Sem data: nem DATA DA VENDA nem data do recebimento do sinal")
    return f


def _vendedor(erp, d: dict) -> tuple[str | None, str]:
    """Só usa cadastro que JÁ existe com o nome do corretor; não cadastra (isso é do lançamento completo)."""
    nome = str(d.get("corretor") or "").strip()
    if not nome:
        return None, "a venda não tem CORRETOR"
    try:
        vs = erp.homonimos(nome)
    except ErpErro:
        return None, "não consegui consultar o corretor no Mais Controle"
    if len(vs) > 1:
        vs = [v for v in vs if str(v.get("role")) == "SUPPLIER"] or vs
    if len(vs) == 1:
        return vs[0]["id"], ""
    return None, ("o corretor não está cadastrado no Mais Controle" if not vs
                  else "há %d cadastros com o nome do corretor" % len(vs))


def processar(page_id: str, notion, erp, aplicar: bool = False, bloqueado: bool = False) -> dict:
    pg = notion.pagina(page_id) or {}
    props = pg.get("properties") or {}
    d = R.dados_da_pagina(props)
    res = {"situacao": None, "codigo": None, "motivos": [], "avisos": [], "pageId": page_id}

    def fim(situacao, texto, venda_id=None, codigo=None, obrigatorio=False):
        res["situacao"], res["codigo"] = situacao, codigo or situacao
        valores = {R.COL["situacao"]: texto}
        if venda_id:
            valores[R.COL["venda_id"]] = venda_id
        try:
            faltou = notion.gravar_textos(page_id, props, valores)
            if faltou:
                res["avisos"].append("COLUNA_FALTANDO")
                if obrigatorio:
                    raise FalhaNotion("colunas faltando: " + ", ".join(faltou))
        except FalhaNotion:
            raise
        except Exception as e:   # noqa: BLE001
            if obrigatorio:   # venda CRIADA e o id não foi anotado: falhar alto
                raise FalhaNotion(str(e)[:200])
            res["avisos"].append("NOTION_NAO_ANOTADO")
        return res

    if d.get("venda_id_atual"):
        res["codigo"], res["situacao"] = "JA_LANCADA", "JA_LANCADA"
        return res   # nada a fazer e nada a escrever: a casa já tem venda
    if d.get("condominio_id"):
        return fim("RECUSADA", "SINAL: o lançamento automático do sinal é só para casa de rua.", codigo="CONDOMINIO")

    data = data_do_sinal(d, props)
    if not d.get("data_venda"):
        d["data_venda"] = data
    f = faltas(d)
    if f:
        res["motivos"] = f
        return fim("RECUSADA", "SINAL NÃO LANÇADO: " + "; ".join(f), codigo="FALTAS")

    obras = [o for o in erp.obras() if R.chave(o.get("name")) == R.chave(d["endereco"])]
    if len(obras) != 1:
        m = "obra '%s' %s no Mais Controle" % (d["endereco"], "não encontrada" if not obras else "repetida")
        return fim("RECUSADA", "SINAL NÃO LANÇADO: " + m, codigo="OBRA_NAO_ENCONTRADA" if not obras else "OBRA_REPETIDA")
    obra = obras[0]
    conta = (erp.obra(obra["id"]) or {}).get("defaultAccount") or {}
    if not conta.get("id"):
        return fim("RECUSADA", "SINAL NÃO LANÇADO: a obra não tem conta padrão no Mais Controle", codigo="OBRA_SEM_CONTA")

    mesma, sem_casa = R.venda_da_casa(erp.recebimentos(), obra["name"], d["casa"])
    if mesma:
        res["venda"] = {"id": mesma[0]["id"]}
        return fim("JA_EXISTE", "SINAL: já existe venda da CASA %02d no Mais Controle (%s) — nada foi criado."
                   % (d["casa"], mesma[0]["id"]), codigo="JA_EXISTE")
    if sem_casa:
        lista = "; ".join("venda %s (\"%s\")" % (x["id"], x["descricao"][:50]) for x in sem_casa[:3])
        return fim("RECUSADA", "SINAL NÃO LANÇADO: há venda desta obra sem o número da casa na descrição — %s. "
                   "Confira no Mais Controle." % lista, codigo="VENDA_SEM_CASA_NA_OBRA")

    clientes = erp.cliente_por_cpf(d["comprador"]["cpf"])
    if len(clientes) > 1:
        return fim("RECUSADA", "SINAL NÃO LANÇADO: o CPF do comprador aparece em %d clientes no Mais Controle"
                   % len(clientes), codigo="CPF_EM_VARIOS_CLIENTES")
    cliente_novo = None if clientes else R.corpo_cliente(d)
    if cliente_novo:
        try:
            homs = erp.homonimos(cliente_novo["name"])
        except ErpErro:
            homs = None
            res["avisos"].append("HOMONIMO_NAO_CONSULTADO")
        if homs:
            return fim("RECUSADA", "SINAL NÃO LANÇADO: já existe no Mais Controle um cadastro com o mesmo nome do "
                       "comprador e o ERP não aceita dois iguais — confira o cadastro.", codigo="NOME_JA_CADASTRADO")

    valor, origem, aviso = valor_do_sinal(d, props, notion)
    marcado = origem == "A_CONFIRMAR"
    rotulo = "Sinal - " + MARCA if marcado else "Sinal"
    d["parcelas_prontas"] = [{"tipo": R.TIPO_SINAL, "rotulo": rotulo, "valor": valor, "data": data}]
    vendedor_id, sem_vendedor = _vendedor(erp, d)
    corpo = R.corpo_venda(d, obra, clientes[0]["id"] if clientes else "(CLIENTE NOVO)", conta,
                          responsavel_id=getattr(erp, "user_id", None), vendedor_id=vendedor_id)
    if marcado:
        corpo["description"] = str(corpo.get("description") or "") + " - SINAL " + MARCA
    nota = "Lançada pelo robô só com o sinal (recebimento confirmado no portal); completar as demais parcelas."
    obs = str(corpo.get("comment") or "")
    corpo["comment"] = (obs + " | " if obs else "") + nota
    res.update({"corpo_venda": corpo, "valor": valor, "origem": origem, "marcado": marcado})
    nome = " ".join(str(d["comprador"]["nome"] or "").upper().split())
    linhas = ["Cliente: %s (%s)" % (nome, "já existe" if clientes else "novo"),
              "Sinal: %s em %s — %s" % (R.reais(valor), R.data_br(data), ORIGENS[origem]),
              "Conta da obra: %s" % (conta.get("name") or conta["id"]),
              "Vendedor: " + ("sem Vendedor — " + sem_vendedor if sem_vendedor else "cadastro existente do corretor"),
              "A baixa do sinal fica para fazer no Mais Controle."]
    if aviso:
        linhas.append("Aviso: " + aviso)

    if not aplicar:
        cab = ("BLOQUEADO: gravar no Mais Controle está desligado neste ambiente — " if bloqueado else "") + \
              "PRÉVIA DO SINAL | " + corpo["description"]
        return fim("PREVIA", "\n".join([cab] + linhas), codigo="BLOQUEADO" if bloqueado else "PREVIA")

    if cliente_novo:
        try:
            criado = erp.criar_cliente(cliente_novo) or {}
        except Exception as e:
            if "address" not in cliente_novo or "HTTP 4" not in str(e):
                raise
            criado = erp.criar_cliente({k: v for k, v in cliente_novo.items() if k != "address"}) or {}
            linhas.append("Aviso: o Mais Controle recusou o endereço; cliente cadastrado sem endereço")
        if not criado.get("id"):
            return fim("ERRO", "ERRO: cliente não confirmado — confira no Mais Controle antes de repetir",
                       codigo="CLIENTE_SEM_ID")
        corpo["customer"] = {"id": criado["id"]}
    venda = erp.criar_venda(corpo) or {}
    if not venda.get("id"):
        return fim("ERRO", "ERRO: venda do sinal não confirmada — confira no Mais Controle antes de repetir",
                   codigo="VENDA_SEM_ID")
    res["venda"] = {"id": venda["id"]}
    return fim("CRIADA", "\n".join(["SINAL LANÇADO | venda %s%s" % (venda["id"], " — " + MARCA if marcado else "")]
                                   + linhas), venda["id"], obrigatorio=True)


def _anotar_erro(notion, page, texto) -> None:
    try:
        props = notion.pagina(page).get("properties") or {}
        notion.gravar_textos(page, props, {R.COL["situacao"]: "SINAL — ERRO: " + texto[:300]})
    except Exception:   # noqa: BLE001
        pass


def main(argv=None) -> int:
    from .notion import Notion
    ap = argparse.ArgumentParser()
    ap.add_argument("--page", required=True)
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--bloqueado", action="store_true")
    ap.add_argument("--marcar-erro", default=None, help="o servidor falhou antes do robô: só anota o erro")
    a = ap.parse_args(argv)

    def sair(r, cod):
        print(json.dumps({"situacao": r.get("situacao"), "codigo": r.get("codigo"), "avisos": r.get("avisos") or []},
                         ensure_ascii=False))
        return cod

    if faltam_segredos(("NOTION_TOKEN",)):
        return sair({"situacao": "ERRO", "codigo": "SEM_SEGREDOS"}, 2)
    notion = Notion(os.environ["NOTION_TOKEN"])
    if a.marcar_erro is not None:
        _anotar_erro(notion, a.page, a.marcar_erro or "o robô do servidor falhou")
        return sair({"situacao": "ERRO", "codigo": "ROBO_FALHOU"}, 1)
    erp = do_ambiente()
    try:
        r = processar(a.page, notion, erp, aplicar=a.aplicar and not a.bloqueado, bloqueado=a.bloqueado)
    except FalhaNotion:
        _anotar_erro(notion, a.page, "a venda pode ter sido criada, mas o id não foi anotado — confira no Mais Controle")
        return sair({"situacao": "ERRO", "codigo": "NOTION_FALHOU_DEPOIS_DE_CRIAR"}, 1)
    except ErpErro as e:
        _anotar_erro(notion, a.page, "o Mais Controle recusou — " + str(e)[:250])
        return sair({"situacao": "ERRO", "codigo": "ERP_RECUSOU"}, 1)
    except Exception as e:   # noqa: BLE001
        _anotar_erro(notion, a.page, "falha inesperada (%s) — confira no Mais Controle antes de repetir" % type(e).__name__)
        return sair({"situacao": "ERRO", "codigo": type(e).__name__}, 1)
    return sair(r, 0 if r.get("situacao") in ("PREVIA", "CRIADA", "JA_EXISTE", "JA_LANCADA") else 1)


if __name__ == "__main__":
    sys.exit(main())
