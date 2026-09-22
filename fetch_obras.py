#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_obras.py — PORTAL-MORAIS
Publica dist/obras.json, lido pela obras.html (aba de OBRAS).

Lê duas bases:
  (EMP) Projeto 2.0        -> as obras
  ATIVIDADES DE PROJETOS   -> as atividades de cada obra

E publica também as OPÇÕES das colunas de seleção (para o formulário de
"Solicitar nova obra" só oferecer valores que existem) e a lista de PESSOAS
(id + nome) que aparecem nas colunas de pessoa — é o id que a API do Notion
aceita para gravar Responsável Pela Obra e ENGENHEIRO RT.

FICA DE FORA, de propósito (o dist/ é público para quem tem a URL):
CPF/CNPJ, DATA DE NASCIMENTO e CONTA da obra. Nenhuma dessas é usada na tela.

Variável de ambiente: NOTION_TOKEN (o mesmo dos outros fetch_*.py).
"""

import os
from datetime import datetime, timezone

from fetch_vendas import ler_banco, api, gravar, norm, SAIDA, TOKEN

ID_OBRAS = "306c5ab532d3812fa14fe9a281510128"   # (EMP) Projeto 2.0
ID_ATIV = "306c5ab532d381fb864edee432bb128d"    # ATIVIDADES DE PROJETOS

# colunas da obra que NUNCA vão para o arquivo público
PROIBIDAS = {norm(x) for x in ["CPF/CNPJ", "DATA DE NASCIMENTO", "CONTA", "Nº DA CONTA"]}


def txt(p):
    """Texto de qualquer tipo de coluna (listas viram 'a, b')."""
    if not p:
        return None
    t = p.get("type")
    v = p.get(t)
    if t == "title" or t == "rich_text":
        return "".join(x.get("plain_text", "") for x in (v or [])) or None
    if t in ("select", "status"):
        return (v or {}).get("name")
    if t == "multi_select":
        return ", ".join(x.get("name", "") for x in (v or [])) or None
    if t == "people":
        return ", ".join(x.get("name") or "" for x in (v or [])) or None
    if t == "date":
        return ((v or {}).get("start") or "")[:10] or None
    if t == "number":
        return v
    if t == "checkbox":
        return "Sim" if v else None
    if t == "formula":
        if not v:
            return None
        fv = v.get(v.get("type"))
        if v.get("type") == "date":
            return ((fv or {}).get("start") or "")[:10] or None
        return fv
    if t == "rollup":
        if (v or {}).get("type") == "array":
            partes = [txt(x) for x in v.get("array") or []]
            return ", ".join(str(x) for x in partes if x not in (None, "")) or None
        return (v or {}).get((v or {}).get("type"))
    if t in ("url", "email", "phone_number"):
        return v
    return None


def ids(p):
    t = (p or {}).get("type")
    if t in ("people", "relation"):
        return [x.get("id") for x in (p.get(t) or []) if x.get("id")]
    return []


def por_nome(props):
    return {norm(k): v for k, v in (props or {}).items()}


def pega(ip, *nomes):
    for n in nomes:
        v = ip.get(norm(n))
        if v is not None:
            return v
    return None


def main():
    if not TOKEN:
        raise SystemExit("Falta o secret NOTION_TOKEN.")
    os.makedirs(SAIDA, exist_ok=True)

    esquema = api("GET", f"/databases/{ID_OBRAS}").get("properties") or {}
    opcoes = {}
    for nome, d in esquema.items():
        t = d.get("type")
        if t in ("select", "status", "multi_select"):
            opcoes[nome] = [o.get("name") for o in (d.get(t) or {}).get("options") or []]
    fmt_cota = None
    for nome, d in esquema.items():
        if norm(nome) == norm("COTA DA EMPRESA (%)") and d.get("type") == "number":
            fmt_cota = (d.get("number") or {}).get("format")

    pessoas = {}

    def guarda_pessoas(p):
        for u in ((p or {}).get("people") or []):
            if u.get("id") and u.get("name"):
                pessoas[u["id"]] = u["name"]

    obras = []
    for pg in ler_banco(ID_OBRAS, "OBRAS"):
        props = pg.get("properties") or {}
        for v in props.values():
            if (v or {}).get("type") == "people":
                guarda_pessoas(v)
        ip = por_nome(props)
        cota = txt(pega(ip, "COTA DA EMPRESA (%)"))
        if isinstance(cota, (int, float)) and fmt_cota == "percent":
            cota = round(cota * 100, 4)          # a tela trabalha em 0-100
        resp = pega(ip, "Responsável Pela Obra")
        rt = pega(ip, "ENGENHEIRO RT")
        obras.append({
            "id": pg.get("id"),
            "url": pg.get("url"),
            "criada": (pg.get("created_time") or "")[:10],
            "titulo": txt(pega(ip, "Projeto")),
            "setor": txt(pega(ip, "SETOR")),
            "cidade": txt(pega(ip, "Cidade")),
            "proprietario": txt(pega(ip, "Proprietário")),
            "proprietario_real": txt(pega(ip, "Proprietário Real")),
            "resp": txt(resp), "resp_ids": ids(resp),
            "rt": txt(rt), "rt_ids": ids(rt),
            "status": txt(pega(ip, "Status")),
            "liberar": txt(pega(ip, "Liberar Obra Para Processo Interno")),
            "projeto_finalizado": txt(pega(ip, "Projeto Finalizado")),
            "orcamento_finalizado": txt(pega(ip, "Orçamento Finalizado")),
            "projeto_aprovado": txt(pega(ip, "Projeto Aprovado")),
            "data_inicial": txt(pega(ip, "Data Inicial")),
            "data_prevista": txt(pega(ip, "Data Prevista P/ Término")),
            "data_conclusao": txt(pega(ip, "Data de Conclusão do Processo")),
            "controle_prazo": txt(pega(ip, "CONTROLE DE PRAZO")),
            "n_casas": txt(pega(ip, "Nº DE CASAS")),
            "cota": cota,
            "data_lote": txt(pega(ip, "DATA DE AQUISIÇÃO DO LOTE")),
            "implantacao": txt(pega(ip, "IMPLANTAÇÃO")),
            "area_lote": txt(pega(ip, "ÁREA DO LOTE")),
            "area_averbada": txt(pega(ip, "ÁREA CONSTRUÍDA AVERBADA")),
            "area_habite": txt(pega(ip, "ÁREA PÓS HABITE-SE")),
            "estudo_layout": txt(pega(ip, "PRECISA DE ESTUDO DE LAYOUT")),
        })

    atividades = []
    for pg in ler_banco(ID_ATIV, "ATIVIDADES DE PROJETOS"):
        props = pg.get("properties") or {}
        ip = por_nome(props)
        r = pega(ip, "Responsável")
        guarda_pessoas(r)
        obra = ids(pega(ip, "(EMP) Projeto 2.0"))
        atividades.append({
            "id": pg.get("id"),
            "url": pg.get("url"),
            "titulo": txt(pega(ip, "Atividade")),
            "tipo": txt(pega(ip, "Tipo")),
            "status": txt(pega(ip, "Status")),
            "resp": [u.get("name") for u in ((r or {}).get("people") or []) if u.get("name")],
            "data_criacao": txt(pega(ip, "Data de criação")),
            "data_inicio": txt(pega(ip, "Data De Início")),
            "data_final": txt(pega(ip, "Data Final Prevista")),
            "data_conclusao": txt(pega(ip, "Data De Conclusão da Atividade")),
            "controle_prazo": txt(pega(ip, "CONTROLE DE PRAZO")),
            "obra_id": obra[0] if obra else None,
        })

    # nada proibido escapa (checagem final, caso alguém renomeie coluna)
    for o in obras:
        for k in list(o.keys()):
            if norm(k) in PROIBIDAS:
                o.pop(k)

    gravar("obras.json", {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "obras": obras,
        "atividades": atividades,
        "opcoes": {k: v for k, v in opcoes.items() if norm(k) not in PROIBIDAS},
        "pessoas": sorted([{"id": k, "nome": v} for k, v in pessoas.items()], key=lambda x: norm(x["nome"])),
    })
    print(f"obras.json: {len(obras)} obras, {len(atividades)} atividades, {len(pessoas)} pessoas", flush=True)


if __name__ == "__main__":
    main()
