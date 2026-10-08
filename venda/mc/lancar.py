# -*- coding: utf-8 -*-
"""Lança a venda de uma casa no Mais Controle a partir da página do Notion.

Uso:
    python -m venda.mc.lancar --page <id>              # PRÉVIA: só lê e mostra
    python -m venda.mc.lancar --page <id> --aplicar    # cria cliente (se faltar) e venda
    python -m venda.mc.lancar --page <id> --bloqueado  # pediram gravar, mas MC_VENDA_APLICAR está desligado
    python -m venda.mc.lancar --page <id> --marcar-erro "texto"   # o workflow falhou antes do robô

Ambiente: NOTION_TOKEN, MC_ROBO_EMAIL, MC_ROBO_SENHA. Sem --aplicar NADA é
gravado no ERP; o Notion recebe só o texto em "MC - SITUAÇÃO".

Travas:
- só se grava o que foi visto na prévia: a prévia grava uma assinatura [#xxxxxxxx]
  dos valores; o lançamento recalcula e recusa se mudou;
- venda da mesma casa já existente → não cria (e NÃO preenche "MC - VENDA ID":
  pode ser venda antiga de outro comprador, de antes de um distrato);
- venda da mesma obra cuja descrição não diz a casa → recusa e pede conferência.

O log do Actions é PÚBLICO: o stdout leva só a situação e códigos; o texto
completo (com valores) vai só para o Notion."""
from __future__ import annotations

import argparse
import json
import os
import sys

from . import condominio as C
from . import regras as R
from .erp import Erp, ErpErro
from .notion import Notion


class FalhaNotion(Exception):
    pass


def _ler(page_id: str, notion) -> tuple[dict, dict, bool]:
    """(props, dados, linha_do_condominio). A página pode ser a casa da VENDAS ou, desde a entrega 7,
    a própria linha da BANCO DE DADOS VENDAS CONDOMÍNIO (tela de venda do condomínio)."""
    pg = notion.pagina(page_id) or {}
    props = pg.get("properties") or {}
    if C.e_linha_do_condominio(pg, os.environ.get("DB_VENDAS_COND", "")):
        return props, C.dados_da_linha(props, page_id), True
    return props, R.dados_da_pagina(props), False


def sondar(page_id: str, notion, erp) -> dict:
    """Só CONSULTA: a casa (ENDEREÇO + CASA) tem obra no Mais Controle? Há venda/recebimento dela ou da obra?
    Não cria nada no ERP; anota o resultado em MC - SITUAÇÃO."""
    props, d, _ = _ler(page_id, notion)
    obras = [o for o in erp.obras() if R.chave(o.get("name")) == R.chave(d["endereco"])]
    if len(obras) != 1:
        txt, cod = "SONDA: obra %s no Mais Controle" % ("não encontrada" if not obras else "repetida"), "SONDA_SEM_OBRA"
    else:
        recs = [r for r in erp.recebimentos() if R.chave(r.get("workName")) == R.chave(obras[0]["name"])]
        mesma, sem_casa = R.venda_da_casa(recs, obras[0]["name"], d["casa"])
        vendas_obra = {r.get("saleId") for r in recs if r.get("saleId")}
        if mesma:
            txt, cod = "SONDA: JÁ TEM venda desta casa no Mais Controle (%s)" % mesma[0]["id"], "SONDA_TEM_VENDA"
        elif sem_casa:
            txt, cod = "SONDA: a obra tem venda sem número de casa (%s) — conferir" % sem_casa[0]["id"], "SONDA_DUVIDA"
        else:
            txt, cod = ("SONDA: SEM venda desta casa no Mais Controle (a obra tem %d venda(s) de outras casas)"
                        % len(vendas_obra)), "SONDA_LIVRE"
    notion.gravar_textos(page_id, props, {R.COL["situacao"]: txt})
    return {"situacao": "SONDA", "codigo": cod}


def processar(page_id: str, notion, erp, aplicar: bool = False, dias: int = R.DIAS_FINANCIAMENTO,
              bloqueado: bool = False, anexar: bool = False) -> dict:
    """bloqueado=True: pediram para gravar, mas o repositório não liberou (MC_VENDA_APLICAR).
    anexar=True (com aplicar): numa venda JÁ LANÇADA, só anexa o contrato."""
    props, d, linha_cond = _ler(page_id, notion)
    res = {"situacao": None, "codigo": None, "motivos": [], "avisos": [], "pageId": page_id,
           "obra": d["endereco"], "casa": d["casa"]}

    def fim(situacao, texto_notion=None, venda_id=None, codigo=None, obrigatorio=False):
        res["situacao"], res["codigo"] = situacao, codigo or situacao
        valores = {R.COL["situacao"]: texto_notion or situacao}
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
        except Exception as e:
            if obrigatorio:   # venda CRIADA e o id não foi anotado: o job tem de falhar alto
                raise FalhaNotion(str(e)[:200])
            res["avisos"].append("NOTION_NAO_ANOTADO")
        return res

    if d.get("venda_id_atual"):
        res["venda"] = {"id": d["venda_id_atual"]}
        if anexar and aplicar:   # venda já lançada pelo robô: só anexa o contrato
            nota = anexar_contrato(d, notion, erp, d["venda_id_atual"], res)
            return fim("JA_LANCADA", "JÁ LANÇADA | venda %s\nContrato: %s" % (d["venda_id_atual"], nota))
        return fim("JA_LANCADA", "JÁ LANÇADA | venda %s" % d["venda_id_atual"])

    fx = None
    if linha_cond or d.get("condominio_id"):
        if linha_cond:   # a própria linha do condomínio: o fluxo e o corretor estão nela
            cpg = {"properties": props}
        else:            # casa da VENDAS que aponta para a linha (caminho antigo, "Gerar venda")
            cpg = notion.pagina(d["condominio_id"]) or {}
            base = os.environ.get("DB_VENDAS_COND", "").replace("-", "").lower()
            mae = str(((cpg.get("parent") or {}).get("database_id")) or "").replace("-", "").lower()
            if base and mae != base:
                res["motivos"] = ["CONDOMÍNIO - VENDA ID não é uma página da BANCO DE DADOS VENDAS CONDOMÍNIO"]
                return fim("RECUSADA", "RECUSADA: " + res["motivos"][0], codigo="CONDOMINIO_OUTRA_BASE")
        fx = C.fluxo(cpg.get("properties") or {})
        # regra do dono (07/10/2026): no condomínio a comissão é paga pela incorporadora —
        # a venda no ERP é o VALOR DE VENDA inteiro, não o "valor na mão"
        d["comissao_paga_por"] = "VENDEDOR"
        d["aquisicao"] = d.get("total")
        d["corretor_contato"] = C.contato_corretor(cpg.get("properties") or {})
        d["parcelas_prontas"] = C.parcelas(fx, d, dias)

    f = (C.faltas_do_fluxo(fx, d.get("casa")) if fx is not None else []) + R.faltas(d, dias)
    if f:
        res["motivos"] = f
        return fim("RECUSADA", "RECUSADA: " + "; ".join(f), codigo="FALTAS")

    if fx is not None:
        obras = C.escolher_obra(erp.obras(), d["endereco"], d["casa"])
    else:
        obras = [o for o in erp.obras() if R.chave(o.get("name")) == R.chave(d["endereco"])]
    if len(obras) != 1:
        m = "Obra '%s' %s no Mais Controle" % (d["endereco"], "não encontrada" if not obras else "repetida (%d)" % len(obras))
        res["motivos"] = [m]
        return fim("RECUSADA", "RECUSADA: " + m, codigo="OBRA_NAO_ENCONTRADA" if not obras else "OBRA_REPETIDA")
    obra = obras[0]
    conta = (erp.obra(obra["id"]) or {}).get("defaultAccount") or {}
    if not conta.get("id"):
        m = "A obra não tem conta padrão no Mais Controle (a conta da venda vem da obra)"
        res["motivos"] = [m]
        return fim("RECUSADA", "RECUSADA: " + m, codigo="OBRA_SEM_CONTA")

    mesma, sem_casa = R.venda_da_casa(erp.recebimentos(), obra["name"], d["casa"])
    if mesma:
        v = mesma[0]
        res["venda"] = {"id": v["id"], "todas": [x["id"] for x in mesma]}
        res["motivos"] = ["Já existe venda da CASA %02d desta obra no Mais Controle" % d["casa"]]
        return fim("JA_EXISTE", "JÁ EXISTE no Mais Controle — venda %s (\"%s\", cliente: %s). Nada foi criado. "
                   "Se for venda antiga (distrato), confira no ERP antes de seguir."
                   % (v["id"], v["descricao"][:60], v["cliente"][:60] or "?"))
    if sem_casa:
        lista = "; ".join("venda %s (\"%s\")" % (x["id"], x["descricao"][:50]) for x in sem_casa[:3])
        res["motivos"] = ["Há venda desta obra sem a casa na descrição"]
        return fim("RECUSADA", "RECUSADA: há venda desta obra no Mais Controle sem o número da casa na descrição — "
                   "%s. Confira no ERP; se for de outra casa, corrija a descrição para \"CASA 0N - NOME\" e peça a prévia de novo."
                   % lista, codigo="VENDA_SEM_CASA_NA_OBRA")

    if fx is not None:
        precisa = sorted({p["tabela"] for p in d["parcelas_prontas"] if p.get("tabela")})
        tabs = {}
        for t in erp.tabelas_reajuste():
            tabs.setdefault(R.chave(t.get("name")), []).append(t)
        faltam = [n for n in precisa if len(tabs.get(R.chave(n), [])) != 1]
        if faltam:
            res["motivos"] = ["Tabela de reajuste ausente ou repetida no Mais Controle: " + ", ".join(faltam)]
            return fim("RECUSADA", "RECUSADA: " + res["motivos"][0], codigo="TABELA_DE_REAJUSTE")
        d["tabelas"] = {n: tabs[R.chave(n)][0]["id"] for n in precisa}

    clientes = erp.cliente_por_cpf(d["comprador"]["cpf"])
    if len(clientes) > 1:
        res["motivos"] = ["CPF do comprador aparece em %d clientes no Mais Controle" % len(clientes)]
        return fim("RECUSADA", "RECUSADA: " + res["motivos"][0], codigo="CPF_EM_VARIOS_CLIENTES")
    cliente_novo = None if clientes else R.corpo_cliente(d)
    res["cliente"] = {"existe": bool(clientes), "id": clientes[0]["id"] if clientes else None}
    if cliente_novo:
        try:
            homs = erp.homonimos(cliente_novo["name"])
        except ErpErro:
            homs = None
            res["avisos"].append("HOMONIMO_NAO_CONSULTADO")
        if homs:
            papeis = ", ".join(sorted({_papel(h) for h in homs}))
            mesmo_cpf = any(R.so_digitos(h.get("cpf")) == d["comprador"]["cpf"] for h in homs)
            res["motivos"] = ["Já existe cadastro com o mesmo nome no Mais Controle (%s)" % papeis]
            return fim("RECUSADA", "RECUSADA: já existe no Mais Controle um cadastro de %s com o mesmo nome do comprador%s, "
                       "e o ERP não aceita dois com nome igual. %s Depois peça a prévia de novo." % (
                           papeis, " e o mesmo CPF" if mesmo_cpf else "",
                           "Abra esse cadastro no Mais Controle e marque também como Cliente."
                           if mesmo_cpf else "Confira se é a mesma pessoa: se for, marque o cadastro também como "
                           "Cliente e ponha o CPF; se não for, diferencie o nome de um dos dois."),
                       codigo="NOME_JA_CADASTRADO")

    # Vendedor = corretor (regra do dono, 06/10/2026: toda venda tem Vendedor). Se não houver
    # cadastro com o nome dele, o robô cadastra como Fornecedor na hora de gravar.
    # 08/10/2026 (dono): corretor sem cadastro NÃO trava mais a prévia — a venda vai sem Vendedor e o motivo
    # aparece na prévia (corretor e comissão continuam na Observação).
    vendedor_id, vendedor_novo, sem_vendedor = None, None, ""
    if not str(d.get("corretor") or "").strip():
        sem_vendedor = "a venda não tem CORRETOR"
    else:
        vs = erp.homonimos(d["corretor"])
        if len(vs) > 1:
            vs = [v for v in vs if str(v.get("role")) == "SUPPLIER"] or vs
        if len(vs) > 1:
            sem_vendedor = "há %d cadastros com o nome do corretor no Mais Controle" % len(vs)
        elif not vs:
            cad = (R.corretor_do_cadastro(notion.linhas(os.environ["DB_CORRETORES"]), d["corretor"])
                   if os.environ.get("DB_CORRETORES") else None)
            if not (cad or {}).get("documento") and (d.get("corretor_contato") or {}).get("documento"):
                cad = dict(d["corretor_contato"])   # condomínio: CPF do corretor vem da pasta (CPF CORRETOR)
            doc = (cad or {}).get("documento") or ""
            if (cad or {}).get("repetido"):
                sem_vendedor = "o corretor aparece mais de uma vez na base CORRETORES – CONTRATO"
            elif not (R.cpf_valido(doc) or R.cnpj_valido(doc)):
                sem_vendedor = ("o corretor não está no Mais Controle e não tem CPF/CNPJ na base CORRETORES – CONTRATO "
                                "(o ERP exige para cadastrar)")
            else:
                d["corretor_cadastro"] = cad
                vs = erp.participantes_por_documento(doc)   # já cadastrado com outro nome? usa o mesmo
                if len(vs) > 1:
                    vs = [v for v in vs if str(v.get("role")) == "SUPPLIER"] or vs
                if len(vs) > 1:
                    sem_vendedor = "o CPF/CNPJ do corretor aparece em %d cadastros no Mais Controle" % len(vs)
                    vs = []
        if not sem_vendedor:
            vendedor_id = vs[0]["id"] if vs else None
            vendedor_novo = None if vs else R.corpo_corretor(d)
    res["sem_vendedor"] = sem_vendedor

    corpo = R.corpo_venda(d, obra, res["cliente"]["id"] or "(CLIENTE NOVO)", conta,
                          responsavel_id=getattr(erp, "user_id", None), vendedor_id=vendedor_id,
                          dias_financiamento=dias)
    assin = R.assinatura(corpo, d["comprador"]["cpf"])
    res["corpo_venda"] = corpo
    res["parcelas"] = [{"rotulo": p["rotulo"], "valor": p["valor"], "data": p["data"]}
                       for p in R.parcelas(d, dias)]
    ps = res["parcelas"]
    nome_cliente = " ".join(str(d["comprador"]["nome"] or "").upper().split()) or "?"

    if not aplicar:
        # Texto em linhas (a tela desenha em tópicos): 1ª linha = cabeçalho com o carimbo [#hash] que o
        # lançamento confere; as linhas "- " são o detalhe das parcelas.
        linhas = [("BLOQUEADO: gravar no Mais Controle está desligado neste ambiente (MC_VENDA_APLICAR) — "
                   if bloqueado else "") + "PRÉVIA OK [#%s] | %s" % (assin, corpo["description"].split(" - ")[0]),
                  "Cliente: %s (%s)" % (nome_cliente, "novo, será criado" if cliente_novo else "já existe"),
                  "Conta da obra: %s" % (conta.get("name") or conta["id"]),
                  ("Vendedor: sem Vendedor — %s" % sem_vendedor) if sem_vendedor else
                  "Vendedor: %s (%s)" % (R.corpo_corretor(d)["name"], "já cadastrado" if vendedor_id
                                         else "será cadastrado como Fornecedor"),
                  "Parcelas: " + R.contagem_parcelas(ps)]
        linhas += ["- " + x for x in R.linhas_parcelas(ps)]
        linhas.append("Total: " + R.total_parcelas(ps))
        if corpo.get("comment"):
            linhas.append("Observação: " + corpo["comment"])
        return fim("PREVIA", "\n".join(linhas), codigo="BLOQUEADO" if bloqueado else "PREVIA")

    vista = R.assinatura_da_situacao(d.get("situacao_atual"))
    if vista != assin:
        res["motivos"] = ["Os dados mudaram depois da prévia"]
        return fim("RECUSADA", "RECUSADA: os dados da venda mudaram depois da prévia — peça a prévia de novo e confira.",
                   codigo="PREVIA_DESATUALIZADA")

    if vendedor_novo:
        cv = erp.criar_cliente(vendedor_novo) or {}
        if not cv.get("id"):
            res["motivos"] = ["O ERP não devolveu o id do corretor cadastrado"]
            return fim("ERRO", "ERRO: corretor não confirmado — confira no Mais Controle antes de repetir",
                       codigo="CORRETOR_SEM_ID")
        corpo["seller"] = {"id": cv["id"]}
        res["vendedor"] = {"criado": True, "id": cv["id"]}
    if cliente_novo:
        criado = erp.criar_cliente(cliente_novo) or {}
        if not criado.get("id"):
            res["motivos"] = ["O ERP não devolveu o id do cliente criado"]
            return fim("ERRO", "ERRO: cliente não confirmado — confira no Mais Controle antes de repetir",
                       codigo="CLIENTE_SEM_ID")
        corpo["customer"] = {"id": criado["id"]}
        res["cliente"] = {"existe": False, "criado": True, "id": criado["id"]}
    venda = erp.criar_venda(corpo) or {}
    if not venda.get("id"):
        res["motivos"] = ["O ERP não devolveu o id da venda"]
        return fim("ERRO", "ERRO: venda não confirmada — confira no Mais Controle antes de repetir",
                   codigo="VENDA_SEM_ID")
    res["venda"] = {"id": venda["id"]}
    nota = anexar_contrato(d, notion, erp, venda["id"], res)
    texto = "\n".join(["CRIADA | venda %s" % venda["id"],
                       "Cliente: %s (%s)" % (nome_cliente, "criado agora" if cliente_novo else "já existia"),
                       "Parcelas: " + R.contagem_parcelas(ps),
                       "Total: " + R.total_parcelas(ps),
                       "Contrato: " + nota])
    return fim("CRIADA", texto, venda["id"], obrigatorio=True)


def anexar_contrato(d: dict, notion, erp, venda_id: str, res: dict) -> str:
    """Anexa o PDF da coluna CONTRATO ASSINADO ao recebimento. Nunca derruba a venda já criada:
    devolve o que aconteceu, para a linha "Contrato: …" da situação."""
    arqs = d.get("contrato_arquivos") or []
    if not arqs:
        res["avisos"].append("SEM_CONTRATO_PARA_ANEXAR")
        return "não anexado (coluna CONTRATO ASSINADO vazia)"
    try:
        conteudo = notion.baixar(arqs[-1]["url"])
        erp.anexar(venda_id, R.nome_do_contrato(d), conteudo)
        res["contrato_anexado"] = True
        return "anexado no recebimento"
    except Exception as e:   # noqa: BLE001 — o anexo é complemento: a venda fica e o motivo vai na situação
        res["avisos"].append("ANEXO_FALHOU")
        return "não anexado (%s) — anexe à mão no Mais Controle" % str(e)[:120]


PAPEIS = {"CUSTOMER": "Cliente", "SUPPLIER": "Fornecedor", "EMPLOYEE": "Funcionário", "SELLER": "Vendedor"}


def _papel(p: dict) -> str:
    r = p.get("role") or p.get("roles") or ""
    if isinstance(r, list):
        return "/".join(PAPEIS.get(str(x), str(x)) for x in r) or "cadastro"
    return PAPEIS.get(str(r), str(r) or "cadastro")


def _anotar_erro(notion, page, texto, manter_erro_anterior=False) -> None:
    try:
        props = notion.pagina(page).get("properties") or {}
        cel = props.get(R.COL["situacao"]) or {}
        atual = "".join(t.get("plain_text", "") for t in cel.get("rich_text") or [])
        if manter_erro_anterior and atual.strip() and not atual.startswith("PROCESSANDO"):
            return   # o robô já anotou o resultado (ERRO, RECUSADA...); não trocar por um aviso genérico
        notion.gravar_textos(page, props, {R.COL["situacao"]: "ERRO: " + texto[:300]})
    except Exception:
        pass


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--page", required=True)
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--bloqueado", action="store_true", help="pediram gravar, mas MC_VENDA_APLICAR não está ligado")
    ap.add_argument("--sondar", action="store_true", help="só consulta o ERP (não cria nada)")
    ap.add_argument("--anexar", action="store_true", help="venda já lançada: só anexa o contrato (exige --aplicar)")
    ap.add_argument("--marcar-erro", default=None, help="só anota ERRO na situação (o workflow falhou)")
    ap.add_argument("--dias-financiamento", type=int, default=R.DIAS_FINANCIAMENTO)
    a = ap.parse_args(argv)

    def sair(res, codigo_saida):
        # stdout = log PÚBLICO do Actions: só situação e códigos, nunca nomes, CPF, valores ou corpo do ERP
        print(json.dumps({"situacao": res.get("situacao"), "codigo": res.get("codigo"),
                          "avisos": res.get("avisos") or []}, ensure_ascii=False))
        return codigo_saida

    notion = Notion(os.environ["NOTION_TOKEN"]) if os.environ.get("NOTION_TOKEN") else None
    if a.marcar_erro is not None:
        if notion:
            _anotar_erro(notion, a.page, a.marcar_erro or "o robô falhou — veja o GitHub Actions",
                         manter_erro_anterior=True)
        return sair({"situacao": "ERRO", "codigo": "WORKFLOW_FALHOU"}, 1)
    falta = [n for n in ("NOTION_TOKEN", "MC_ROBO_EMAIL", "MC_ROBO_SENHA") if not os.environ.get(n)]
    if falta:
        if notion:
            _anotar_erro(notion, a.page, "o robô está sem configuração (segredos do GitHub)")
        return sair({"situacao": "ERRO", "codigo": "SEM_SEGREDOS"}, 2)
    erp = Erp(os.environ["MC_ROBO_EMAIL"].strip(), os.environ["MC_ROBO_SENHA"].strip(chr(13) + chr(10)),
              aparelho=os.environ.get("MC_ROBO_APARELHO", "").strip())
    if a.sondar:
        try:
            return sair(sondar(a.page, notion, erp), 0)
        except ErpErro as e:
            _anotar_erro(notion, a.page, "o Mais Controle recusou — " + str(e)[:250])
            return sair({"situacao": "ERRO", "codigo": "ERP_RECUSOU"}, 1)
    try:
        res = processar(a.page, notion, erp, aplicar=a.aplicar and not a.bloqueado,
                        dias=a.dias_financiamento, bloqueado=a.bloqueado, anexar=a.anexar)
    except FalhaNotion:
        # a venda pode ter sido CRIADA: falhar alto para alguém conferir antes de repetir
        _anotar_erro(notion, a.page, "a venda pode ter sido criada, mas o id não foi anotado — confira no Mais Controle antes de repetir")
        return sair({"situacao": "ERRO", "codigo": "NOTION_FALHOU_DEPOIS_DE_CRIAR"}, 1)
    except ErpErro as e:
        _anotar_erro(notion, a.page, "o Mais Controle recusou — " + str(e)[:250])
        return sair({"situacao": "ERRO", "codigo": "ERP_RECUSOU"}, 1)
    except Exception as e:   # rede, JSON, o que for: nunca deixar PROCESSANDO preso
        _anotar_erro(notion, a.page, "falha inesperada (%s) — tente de novo" % type(e).__name__)
        return sair({"situacao": "ERRO", "codigo": type(e).__name__}, 1)
    ok = res.get("situacao") in ("PREVIA", "CRIADA", "JA_EXISTE", "JA_LANCADA")
    return sair(res, 0 if ok else 1)


if __name__ == "__main__":
    sys.exit(main())
