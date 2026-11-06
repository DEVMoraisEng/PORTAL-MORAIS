# -*- coding: utf-8 -*-
"""Documentos assinados da venda no Mais Controle (03/11/2026). Pedido "mc-anexos" da fila do servidor.

Uso (o servidor/robo_fila.py chama; nunca pelo GitHub — o ERP é acessado SÓ pelo Chrome do porteiro):
    python -m venda.mc.anexos --page <id>              # PRÉVIA: só lê e diz o que faria
    python -m venda.mc.anexos --page <id> --aplicar    # anexa / envia o que falta
    python -m venda.mc.anexos --page <id> --bloqueado  # pediram gravar, mas a gravação está desligada

Duas partes, cada uma idempotente pelo NOME do arquivo (já existe na pasta = não sobe de novo):
 1) contrato: com MC - VENDA ID e PDF em CONTRATO ASSINADO, anexa no recebimento da venda (mesma pasta e mesmo
    nome do lançamento, regras.nome_do_contrato) — é o que faltava quando a venda foi criada antes do PDF chegar;
 2) ZIP: o arquivo da coluna CONTRATOS ASSINADOS (ZIP), que o Apps Script monta quando todos assinam, vai para
    Obras > Orçamento > Arquivos > pasta "Contratos Venda" da obra. A pasta NÃO é criada pelo robô: sem ela, a
    situação diz o que fazer. Condomínio: a obra do condomínio; 05/11, casa de rua (base VENDAS), se a base tiver a
    coluna: a obra de nome = ENDEREÇO, como no lançamento (lancar.py);
 3) 05/11/2026 (dono), só casa de rua: "toda vez que o contrato for finalizado (assinado por todos) ele tem que ir
    pro orçamento" — o PDF do CONTRATO ASSINADO vai para a mesma pasta do Orçamento da obra da casa, com o nome do
    recebimento (regras.nome_do_contrato), com ou sem venda lançada. Linha "Contrato no Orçamento: …".
O resultado vai para as linhas "Contrato: …" e "Contratos (ZIP): …" de MC - SITUAÇÃO; as outras linhas ficam.
Falha numa parte nunca impede a outra. stdout = log PÚBLICO: só códigos, nunca nomes, CPF ou valores."""
from __future__ import annotations

import argparse
import json
import os
import sys

from . import condominio as C
from . import regras as R
from .erp import ErpErro, do_ambiente, faltam_segredos, pelo_porteiro
from .notion import Notion

COL_ZIP = "CONTRATOS ASSINADOS (ZIP)"
ROTULO_CONTRATO = "Contrato"
ROTULO_ZIP = "Contratos (ZIP)"
ROTULO_ORCAMENTO = "Contrato no Orçamento"   # 05/11: casa de rua
PASTA_PADRAO = "Contratos Venda"
CABECALHO_VAZIO = "ainda não lançada"   # o mesmo que a tela mostra com a situação vazia


def trocar_linha(situacao: str, rotulo: str, texto: str) -> str:
    """Troca (ou acrescenta) a linha "Rótulo: …" sem mexer nas outras. A 1ª linha (cabeçalho) nunca é trocada;
    situação vazia ganha o cabeçalho CABECALHO_VAZIO, para a próxima vez trocar em vez de repetir.
    Mesma regra do mcTrocarLinha_ (venda/AnexosMC.gs)."""
    s = str(situacao or "")
    if not s.strip():
        s = CABECALHO_VAZIO
    linhas = s.split("\n")
    nova, achou = "%s: %s" % (rotulo, texto), False
    for i in range(1, len(linhas)):
        if linhas[i].startswith(rotulo + ":"):
            linhas[i], achou = nova, True
    if not achou:
        linhas.append(nova)
    return "\n".join(linhas)


def _ler(page_id: str, notion) -> tuple[dict, dict, bool]:
    pg = notion.pagina(page_id) or {}
    props = pg.get("properties") or {}
    if C.e_linha_do_condominio(pg, os.environ.get("DB_VENDAS_COND", "")):
        return props, C.dados_da_linha(props, page_id), True
    return props, R.dados_da_pagina(props), False


def _contrato(d: dict, notion, erp, aplicar: bool, bloqueado: bool, res: dict) -> str | None:
    """Texto da linha "Contrato:" ou None (venda não lançada: nada a dizer)."""
    venda_id = d.get("venda_id_atual")
    if not venda_id:
        return None
    arqs = d.get("contrato_arquivos") or []
    if not arqs:
        res["codigos"].append("CONTRATO_SEM_PDF")
        return "não anexado (coluna CONTRATO ASSINADO vazia)"
    nome = R.nome_do_contrato(d)
    try:
        if erp.tem_arquivo(erp.pasta_da_venda(venda_id), nome):
            res["codigos"].append("CONTRATO_JA_ANEXADO")
            return "anexado no recebimento"
        if not aplicar:
            res["codigos"].append("CONTRATO_BLOQUEADO" if bloqueado else "CONTRATO_PREVIA")
            return ("não anexado — gravar no Mais Controle está desligado neste ambiente" if bloqueado
                    else "não anexado (prévia: seria anexado no recebimento)")
        erp.anexar(venda_id, nome, notion.baixar(arqs[-1]["url"]))
        res["codigos"].append("CONTRATO_ANEXADO")
        return "anexado no recebimento"
    except Exception as e:   # noqa: BLE001 — complemento: o motivo vai na situação, a outra parte segue
        res["codigos"].append("CONTRATO_FALHOU")
        res["falhou"] = True
        return "não anexado (%s) — use o botão Anexar contrato ou anexe à mão" % str(e)[:120]


def _pasta_nome() -> str:
    return os.environ.get("MC_PASTA_CONTRATOS_VENDA", "").strip() or PASTA_PADRAO


def _obras_da_venda(erp, d: dict, linha_cond: bool) -> list:
    """A obra é SEMPRE a do ENDEREÇO da venda, a mesma do lançamento: nada de obra fixa por variável, que mandaria o
    arquivo de outra casa para a obra errada (revisão 03/11). Condomínio: C.escolher_obra; casa de rua (05/11): nome
    igual ao ENDEREÇO, exatamente como lancar.processar."""
    if linha_cond:
        return C.escolher_obra(erp.obras(), d.get("endereco") or "", d.get("casa"))
    return [o for o in erp.obras() if R.chave(o.get("name")) == R.chave(d.get("endereco"))]


def _pasta_orcamento(erp, d: dict, linha_cond: bool, cache: dict) -> tuple:
    """(obras, pasta): a pasta "Contratos Venda" do Orçamento da obra da venda; pasta None se a obra não é uma só ou
    se a pasta não existe. Uma consulta por pedido (o contrato e o ZIP vão para a mesma pasta)."""
    if "pasta" not in cache:
        obras = _obras_da_venda(erp, d, linha_cond)
        pasta = erp.pasta_do_orcamento(obras[0]["id"], _pasta_nome()) if len(obras) == 1 else None
        cache["obras"], cache["pasta"] = obras, pasta
    return cache["obras"], cache["pasta"]


def _contrato_orcamento(d: dict, notion, erp, aplicar: bool, bloqueado: bool, res: dict, cache: dict) -> str | None:
    """05/11 (casa de rua): texto da linha "Contrato no Orçamento:" ou None (contrato ainda não assinado)."""
    arqs = d.get("contrato_arquivos") or []
    if not arqs:
        return None
    nome, pasta_nome, obra_nome = R.nome_do_contrato(d), _pasta_nome(), d.get("endereco") or ""
    try:
        obras, pasta = _pasta_orcamento(erp, d, False, cache)
        if len(obras) != 1:
            res["codigos"].append("ORCAMENTO_SEM_OBRA")
            res["falhou"] = True
            return "não enviado (obra \"%s\" %s no Mais Controle)" % (
                obra_nome, "não encontrada" if not obras else "repetida")
        if not pasta or not pasta.get("id"):
            res["codigos"].append("ORCAMENTO_SEM_PASTA")
            res["falhou"] = True
            return ("não enviado (o Orçamento da obra não tem a pasta \"%s\" em Arquivos — crie a pasta no "
                    "Mais Controle e clique em Anexar contrato no Mais Controle)" % pasta_nome)
        if erp.tem_arquivo(pasta, nome):
            res["codigos"].append("ORCAMENTO_JA_ENVIADO")
            return "enviado para Orçamento > Arquivos > %s" % pasta_nome
        if not aplicar:
            res["codigos"].append("ORCAMENTO_BLOQUEADO" if bloqueado else "ORCAMENTO_PREVIA")
            return ("não enviado — gravar no Mais Controle está desligado neste ambiente" if bloqueado
                    else "não enviado (prévia: iria para Orçamento > Arquivos > %s)" % pasta_nome)
        conteudo = notion.baixar(arqs[-1]["url"])
        if not erp.cabe_na_pasta(pasta["id"], len(conteudo)):
            res["codigos"].append("ORCAMENTO_SEM_ESPACO")
            res["falhou"] = True
            return "não enviado (o armazenamento de arquivos do Mais Controle está cheio)"
        erp.subir_arquivo(pasta["id"], nome, conteudo, "application/pdf")
        res["codigos"].append("ORCAMENTO_ENVIADO")
        return "enviado para Orçamento > Arquivos > %s" % pasta_nome
    except Exception as e:   # noqa: BLE001 — complemento: o motivo vai na situação, as outras partes seguem
        res["codigos"].append("ORCAMENTO_FALHOU")
        res["falhou"] = True
        return "não enviado (%s) — clique em Anexar contrato no Mais Controle para tentar de novo" % str(e)[:120]


def _zip(props: dict, d: dict, notion, erp, aplicar: bool, bloqueado: bool, res: dict,
         linha_cond: bool = True, cache: dict | None = None) -> str | None:
    """Texto da linha "Contratos (ZIP):" ou None (sem coluna ou sem ZIP: nada a fazer)."""
    por_chave = {R.chave(k): v for k, v in (props or {}).items()}
    arqs = R._arquivos(por_chave.get(R.chave(COL_ZIP)))
    if not arqs:
        return None
    nome = arqs[-1]["nome"]
    pasta_nome = _pasta_nome()
    obra_nome = d.get("endereco") or ""
    try:
        obras, pasta = _pasta_orcamento(erp, d, linha_cond, {} if cache is None else cache)
        if len(obras) != 1:
            res["codigos"].append("ZIP_SEM_OBRA")
            res["falhou"] = True
            return "não enviado (obra \"%s\" %s no Mais Controle)" % (
                obra_nome, "não encontrada" if not obras else "repetida")
        if not pasta or not pasta.get("id"):
            res["codigos"].append("ZIP_SEM_PASTA")
            res["falhou"] = True
            return ("não enviado (o Orçamento da obra não tem a pasta \"%s\" em Arquivos — crie a pasta no "
                    "Mais Controle e clique em Enviar ZIP)" % pasta_nome)
        if erp.tem_arquivo(pasta, nome):
            res["codigos"].append("ZIP_JA_ENVIADO")
            return "enviado para Orçamento > Arquivos > %s" % pasta_nome
        if not aplicar:
            res["codigos"].append("ZIP_BLOQUEADO" if bloqueado else "ZIP_PREVIA")
            return ("não enviado — gravar no Mais Controle está desligado neste ambiente" if bloqueado
                    else "não enviado (prévia: iria para Orçamento > Arquivos > %s)" % pasta_nome)
        conteudo = notion.baixar(arqs[-1]["url"])
        if not erp.cabe_na_pasta(pasta["id"], len(conteudo)):
            res["codigos"].append("ZIP_SEM_ESPACO")
            res["falhou"] = True
            return "não enviado (o armazenamento de arquivos do Mais Controle está cheio)"
        erp.subir_arquivo(pasta["id"], nome, conteudo, "application/zip")
        res["codigos"].append("ZIP_ENVIADO")
        return "enviado para Orçamento > Arquivos > %s" % pasta_nome
    except Exception as e:   # noqa: BLE001
        res["codigos"].append("ZIP_FALHOU")
        res["falhou"] = True
        return "não enviado (%s) — clique em Enviar ZIP para tentar de novo" % str(e)[:120]


def processar(page_id: str, notion, erp, aplicar: bool = False, bloqueado: bool = False) -> dict:
    props, d, linha_cond = _ler(page_id, notion)
    res = {"situacao": "ANEXOS", "codigos": [], "avisos": [], "falhou": False}
    trocas, cache = [], {}
    t = _contrato(d, notion, erp, aplicar, bloqueado, res)
    if t is not None:
        trocas.append((ROTULO_CONTRATO, t))
    if not linha_cond:   # 05/11: casa de rua — o contrato assinado também vai para o Orçamento da obra da casa
        o = _contrato_orcamento(d, notion, erp, aplicar, bloqueado, res, cache)
        if o is not None:
            trocas.append((ROTULO_ORCAMENTO, o))
    z = _zip(props, d, notion, erp, aplicar, bloqueado, res, linha_cond, cache)
    if z is not None:
        trocas.append((ROTULO_ZIP, z))
    if not trocas:
        res["codigos"].append("NADA_A_FAZER")
        return res
    # relê a situação na hora de gravar: o lançamento pode ter escrito enquanto este pedido rodava
    try:
        atual = R._valor({R.chave(k): v for k, v in ((notion.pagina(page_id) or {}).get("properties") or {}).items()}
                         .get(R.chave(R.COL["situacao"]))) or ""
    except Exception:   # noqa: BLE001
        atual = d.get("situacao_atual") or ""
    texto = str(atual)
    for rotulo, linha in trocas:
        texto = trocar_linha(texto, rotulo, linha)
    try:
        if notion.gravar_textos(page_id, props, {R.COL["situacao"]: texto}):
            res["avisos"].append("COLUNA_FALTANDO")
    except Exception:   # noqa: BLE001
        res["avisos"].append("NOTION_NAO_ANOTADO")
    return res


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--page", required=True)
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--bloqueado", action="store_true")
    a = ap.parse_args(argv)

    def sair(res, codigo):
        print(json.dumps({"situacao": res.get("situacao"), "codigos": res.get("codigos") or [],
                          "avisos": res.get("avisos") or []}, ensure_ascii=False))
        return codigo

    if not pelo_porteiro():
        # regra do dono (14/10/2026): o ERP só pelo Chrome do porteiro — este robô não tem plano B com senha
        return sair({"situacao": "ERRO", "codigos": ["SO_PELO_PORTEIRO"]}, 2)
    if faltam_segredos(("NOTION_TOKEN",)):
        return sair({"situacao": "ERRO", "codigos": ["SEM_SEGREDOS"]}, 2)
    notion = Notion(os.environ["NOTION_TOKEN"])
    try:
        res = processar(a.page, notion, do_ambiente(), aplicar=a.aplicar and not a.bloqueado, bloqueado=a.bloqueado)
    except Exception as e:   # noqa: BLE001 — Notion ou porteiro fora: as linhas "pedido ao robô" não podem ficar presas
        anotar_falha(notion, a.page, "o robô falhou (%s) — tente de novo pelo botão" % type(e).__name__)
        return sair({"situacao": "ERRO", "codigos": ["ERP_RECUSOU" if isinstance(e, ErpErro) else type(e).__name__]}, 1)
    return sair(res, 1 if res.get("falhou") else 0)


def anotar_falha(notion, page_id: str, texto: str) -> None:
    """Troca só as linhas "Contrato:"/"Contratos (ZIP):" que ainda dizem "pedido ao robô" pelo motivo da falha."""
    try:
        props = (notion.pagina(page_id) or {}).get("properties") or {}
        por_chave = {R.chave(k): v for k, v in props.items()}
        atual = str(R._valor(por_chave.get(R.chave(R.COL["situacao"]))) or "")
        novo = atual
        for rotulo in (ROTULO_CONTRATO, ROTULO_ORCAMENTO, ROTULO_ZIP):
            for linha in novo.split("\n")[1:]:
                if linha.startswith(rotulo + ":") and "pedido ao robô" in linha:
                    novo = trocar_linha(novo, rotulo, texto)
        if novo != atual:
            notion.gravar_textos(page_id, props, {R.COL["situacao"]: novo})
    except Exception:   # noqa: BLE001
        pass


if __name__ == "__main__":
    sys.exit(main())
