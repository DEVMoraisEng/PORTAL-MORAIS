#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sincronizar_obras.py — PORTAL-MORAIS · a OBRA manda nos campos ligados (28/10/26)

Pedido: "tem que corrigir todos os campos ligados entre si" — alterou na obra
((EMP) Projeto 2.0), DOCUMENTOS e VENDAS acompanham. Antes só o ENDEREÇO era
levado (moEnderecoMudou_ no MapaObras.gs); setor, engenheiro, cidade,
proprietário etc. ficavam com o valor antigo nas outras bases, e o
completar_vendas.py só preenche o que está VAZIO.

O que faz, a cada publicação do site (pages.yml, de 30 em 30 min):
  - para cada linha de DOCUMENTOS e de VENDAS ligada a UMA obra (OBRA-AUTO),
    compara os campos de CAMPOS abaixo com a obra e, se a obra tem valor e a
    linha está diferente, GRAVA o valor da obra (sobrescreve);
  - campo vazio na obra não apaga nada; linha sem obra ligada (obras antigas)
    não é tocada; ENDEREÇO não entra aqui (tem fluxo próprio, que também
    renomeia Pós Obra, Ligações, atividades e o Mais Controle);
  - cada obra corrigida ganha um ALERTA na coluna ENDEREÇO ALTERADO da obra
    (é o que a aba Obras › Alertas mostra em "Alterações na obra — conferir",
    com o botão Validar) dizendo o que foi trocado, DE → PARA;
  - grava dist/obras_sinc.json só com um hash dos campos que o Mais Controle
    usa, por obra (sem dado nenhum): se mudou desde a publicação anterior,
    dispara os Robôs do Mais Controle para a correção chegar lá também sem
    esperar a rodada das 06h23 (e o robô anota no mesmo alerta o que trocou).

CPF/CNPJ nunca aparece no log nem no alerta (só "CPF/CNPJ atualizado").

Variáveis:
  APLICAR=1      grava (sem isso é SIMULAÇÃO: só imprime o que faria)
  FORCAR=1       deixa passar mais de LIMITE_SEGURO linhas numa rodada
                 (trava contra um mapeamento errado reescrever a base inteira)
  GH_TOKEN, GITHUB_REPOSITORY   para disparar os robôs do MC (opcional)
"""

import hashlib
import json
import os
import sys
import unicodedata
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fetch_vendas import ler_banco, api

ID_OBRAS = "306c5ab532d3812fa14fe9a281510128"          # (EMP) Projeto 2.0
ID_DOCS = (os.environ.get("DOCUMENTOS_DB_ID") or "32fc5ab532d380a0900dd7f4bfc619bd").strip()
ID_VENDAS = (os.environ.get("VENDAS_DB_ID") or "33cc5ab532d38047ae3aee8b87ac1f4d").strip()
APLICAR = os.environ.get("APLICAR", "").strip() == "1"
FORCAR = os.environ.get("FORCAR", "").strip() == "1"
LIMITE_SEGURO = 120
COL_ALERTA = "ENDEREÇO ALTERADO"       # mesma coluna do alerta de endereço (MapaObras.gs)
COL_REL = "OBRA-AUTO"
SNAP = Path("dist/obras_sinc.json")
URL_SNAP = "https://devmoraiseng.github.io/PORTAL-MORAIS/dist/obras_sinc.json"

# (rótulo, colunas possíveis na OBRA, colunas possíveis em DOCUMENTOS, em VENDAS)
# A primeira que existir em cada base é a usada. Coluna que não existe numa
# base é simplesmente ignorada lá.
CAMPOS = [
    ("SETOR", ["SETOR"], ["SETOR"], ["SETOR"]),
    ("CIDADE", ["Cidade", "CIDADE"], ["CIDADE"], ["CIDADE"]),
    ("ENGENHEIRO", ["Responsável Pela Obra"], ["ENG. EXECUÇÃO"], ["ENG. RESPONSÁEL", "ENG. RESPONSÁVEL"]),
    ("ENGENHEIRO RT", ["ENGENHEIRO RT"], ["ENGENHEIRO RT"], ["ENGENHEIRO RT"]),
    ("PROPRIETÁRIO", ["Proprietário", "PROPRIETÁRIO"], ["PROPRIETARIO DOCUMENTO", "PROPRIETÁRIO DOCUMENTO"], []),
    ("PROPRIETÁRIO REAL", ["Proprietário Real", "PROPRIETÁRIO REAL"], ["PROPRIETARIO REAL", "PROPRIETÁRIO REAL"], []),
    ("CPF/CNPJ", ["CPF/CNPJ"], ["CPF/CNPJ"], []),
    ("Nº DE CASAS", ["Nº DE CASAS"], ["Nº DE CASAS"], []),
    ("COTA DA EMPRESA", ["COTA DA EMPRESA (%)", "COTA DA EMPRESA"], ["COTA DA EMPRESA (%)", "COTA DA EMPRESA"], []),
    ("DATA DE AQUISIÇÃO DO LOTE", ["DATA DE AQUISIÇÃO DO LOTE"], ["DATA DE AQUISIÇÃO DO LOTE"], []),
    ("IMPLANTAÇÃO", ["IMPLANTAÇÃO"], ["IMPLANTAÇÃO"], []),
    ("ÁREA DO LOTE", ["ÁREA DO LOTE"], ["ÁREA DO LOTE"], []),
    ("ÁREA CONSTRUÍDA AVERBADA", ["ÁREA CONSTRUÍDA AVERBADA"], ["ÁREA CONSTRUÍDA AVERBADA"], []),
    ("ÁREA PÓS HABITE-SE", ["ÁREA PÓS HABITE-SE"], ["ÁREA PÓS HABITE-SE"], []),
]
SIGILO = {"CPF/CNPJ"}                       # valor nunca vai para log/alerta
LOG_SIGILO = SIGILO | {"PROPRIETÁRIO", "PROPRIETÁRIO REAL"}   # o log do Actions é público: nomes de dono ficam só no alerta
CRIA_OPCAO = {"CPF/CNPJ"}                   # select que pode ganhar opção nova (dado, não categoria)
# campos que o robô do Mais Controle confere (mudou → dispara o robô)
CAMPOS_MC = ["Nº DE CASAS", "ÁREA CONSTRUÍDA AVERBADA", "ÁREA PÓS HABITE-SE", "ENGENHEIRO RT",
             "Responsável Pela Obra", "Proprietário", "Cidade", "SETOR", "CONTA", "Projeto"]
GRAVAVEIS = {"title", "rich_text", "select", "status", "multi_select", "people", "number", "date",
             "phone_number", "url", "email", "checkbox"}


def N(s):
    s = unicodedata.normalize("NFD", str(s if s is not None else ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return " ".join(s.upper().split())


def achar(esquema, nomes):
    for nome in nomes:
        for k in esquema:
            if N(k) == N(nome):
                return k
    return None


# ---------------------------------------------------------------- valores
def bruto(p):
    """Valor "cru" comparável de uma propriedade (lida da página).
    people -> lista de (id, nome); rollup/fórmula -> valor simples."""
    if not p:
        return None
    t = p.get("type")
    v = p.get(t)
    if t in ("title", "rich_text"):
        return "".join(x.get("plain_text", "") for x in v or []).strip() or None
    if t in ("select", "status"):
        return (v or {}).get("name")
    if t == "multi_select":
        return ", ".join(x.get("name") or "" for x in v or []) or None
    if t == "people":
        return [(x.get("id"), x.get("name") or "") for x in v or []] or None
    if t == "date":
        return ((v or {}).get("start") or "")[:10] or None
    if t in ("number", "checkbox", "phone_number", "url", "email"):
        return v
    if t == "formula":
        return (v or {}).get((v or {}).get("type"))
    if t == "rollup":
        r = v or {}
        if r.get("type") == "array":
            for x in r.get("array") or []:
                b = bruto(x)
                if b not in (None, "", []):
                    return b
            return None
        return r.get(r.get("type"))
    if t == "relation":
        return None
    return None


def vazio(v):
    return v is None or v == "" or v == [] or (isinstance(v, str) and not v.strip())


def como_texto(v):
    if isinstance(v, list):
        return ", ".join(n or i for i, n in v)
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    if isinstance(v, (int, float)):
        return str(v).replace(".", ",")
    if isinstance(v, str) and len(v) == 10 and v[4] == "-" and v[7] == "-":
        return f"{v[8:10]}/{v[5:7]}/{v[0:4]}"
    return str(v)


def pct_fator(def_origem, def_alvo):
    """COTA: obra em % do Notion (0,5) e alvo em número comum (50) ou vice-versa."""
    fo = ((def_origem or {}).get("number") or {}).get("format")
    fa = ((def_alvo or {}).get("number") or {}).get("format")
    if fo == "percent" and fa != "percent":
        return 100.0
    if fo != "percent" and fa == "percent":
        return 0.01
    return 1.0


def converter(v, def_origem, def_alvo, rotulo):
    """Valor da obra -> (valor Notion para gravar, valor cru para comparar) ou
    (None, motivo) quando não dá para gravar com segurança."""
    t = def_alvo.get("type")
    if t not in GRAVAVEIS:
        return None, f"coluna do tipo {t} não aceita gravação"
    if t == "people":
        if not isinstance(v, list):
            return None, "na obra não é pessoa — não sei o usuário do Notion"
        return {"people": [{"id": i} for i, _ in v if i]}, v
    if isinstance(v, list):                         # pessoa -> texto
        v = como_texto(v)
    if t in ("title", "rich_text"):
        s = como_texto(v)
        return {t: [{"text": {"content": s[:1900]}}]}, s
    if t in ("select", "status"):
        s = como_texto(v).strip()
        opcoes = [o.get("name") for o in ((def_alvo.get(t) or {}).get("options") or [])]
        real = next((o for o in opcoes if N(o) == N(s)), None)
        if not real:
            if t == "select" and rotulo in CRIA_OPCAO:
                real = s                            # o Notion cria a opção
            else:
                return None, f"opção '{s}' não existe na coluna (não criei, é lista fechada)"
        return {t: {"name": real}}, real
    if t == "multi_select":
        nomes = [x.strip() for x in como_texto(v).split(",") if x.strip()]
        return {"multi_select": [{"name": x} for x in nomes]}, ", ".join(nomes)
    if t == "number":
        try:
            n = float(str(v).replace(",", ".")) if not isinstance(v, (int, float)) else float(v)
        except ValueError:
            return None, f"'{v}' não é número"
        n = round(n * pct_fator(def_origem, def_alvo), 6)
        return {"number": n}, n
    if t == "date":
        s = str(v)[:10]
        return {"date": {"start": s}}, s
    if t == "checkbox":
        return {"checkbox": bool(v)}, bool(v)
    s = como_texto(v)
    return {t: s}, s


def iguais(atual, novo):
    if vazio(atual) and vazio(novo):
        return True
    if isinstance(novo, list) or isinstance(atual, list):     # pessoas: compara os ids
        ids = lambda x: sorted(i for i, _ in x) if isinstance(x, list) else []
        return ids(atual) == ids(novo)
    if isinstance(novo, (int, float)) and not isinstance(novo, bool):
        try:
            return abs(float(atual) - float(novo)) < 1e-6
        except (TypeError, ValueError):
            return False
    return N(como_texto(atual)) == N(como_texto(novo))


# ---------------------------------------------------------------- função pura
def diferencas(linha_props, obra_props, mapa, esq_obra, esq_alvo):
    """Função PURA. mapa = [(rotulo, col_obra, col_alvo)]. Devolve
    (patch {coluna: valor Notion}, [(rotulo, antes_txt, depois_txt)], [avisos])."""
    patch, trocas, avisos = {}, [], []
    for rotulo, co, ca in mapa:
        v = bruto(obra_props.get(co))
        if vazio(v):
            continue                                  # obra vazia: não apaga nada
        notion, novo = converter(v, esq_obra.get(co), esq_alvo.get(ca), rotulo)
        if notion is None:
            avisos.append(f"{rotulo}: {novo}")
            continue
        atual = bruto(linha_props.get(ca))
        if iguais(atual, novo):
            continue
        patch[ca] = notion
        trocas.append((rotulo, "(vazio)" if vazio(atual) else como_texto(atual), como_texto(novo)))
    return patch, trocas, avisos


def mostrar(rotulo, txt):
    return "***" if rotulo in LOG_SIGILO else txt


def titulo(props):
    for p in (props or {}).values():
        if (p or {}).get("type") == "title":
            return "".join(x.get("plain_text", "") for x in p.get("title") or []).strip()
    return ""


def obra_da_linha(props):
    rel = None
    for k, p in (props or {}).items():
        if N(k) == N(COL_REL) and (p or {}).get("type") == "relation":
            rel = p
    ids = [str(x.get("id") or "").replace("-", "") for x in ((rel or {}).get("relation") or [])]
    return ids[0] if len(ids) == 1 else None


# ---------------------------------------------------------------- alerta
def texto_alerta(trocas_docs, trocas_vendas, agora):
    """Função PURA: [(rotulo, antes, depois)] de DOCUMENTOS e {casa: [...]} de
    VENDAS -> uma linha de alerta. Sigilo aplicado."""
    partes = []
    if trocas_docs:
        partes.append("DOCUMENTOS: " + "; ".join(
            f"{r} atualizado" if r in SIGILO else f"{r} {a} → {d}" for r, a, d in trocas_docs))
    if trocas_vendas:
        # agrupa as casas que tiveram a MESMA troca
        grupos = {}
        for casa, trs in trocas_vendas.items():
            for r, a, d in trs:
                grupos.setdefault((r, a, d), []).append(casa)
        itens = []
        for (r, a, d), casas in grupos.items():
            cs = ", ".join(sorted({str(c) for c in casas}, key=lambda x: (len(x), x)))
            itens.append((f"{r} atualizado" if r in SIGILO else f"{r} {a} → {d}") + f" (casa {cs})")
        partes.append("VENDAS: " + "; ".join(itens))
    if not partes:
        return ""
    return "DADOS DA OBRA levados · " + " · ".join(partes) + f" · {agora}"


def anotar_alerta(obra_id, nota, esq_obra):
    col = achar(esq_obra, [COL_ALERTA])
    if not col:
        print(f"  ! coluna {COL_ALERTA} não existe na base de obras — alerta não gravado", flush=True)
        return
    pg = api("GET", f"/pages/{obra_id}")
    atual = bruto((pg.get("properties") or {}).get(col)) or ""
    conteudo = (((atual + "\n") if atual else "") + nota)[-1900:]
    api("PATCH", f"/pages/{obra_id}", {"properties": {col: {"rich_text": [{"text": {"content": conteudo}}]}}})


# ---------------------------------------------------------------- Mais Controle
def hash_mc(props, esq_obra):
    vals = []
    for nome in CAMPOS_MC:
        col = achar(esq_obra, [nome])
        b = bruto(props.get(col)) if col else None
        if isinstance(b, list):
            b = sorted(i for i, _ in b)
        vals.append(b)
    return hashlib.sha1(json.dumps(vals, ensure_ascii=False, default=str).encode("utf-8")).hexdigest()[:16]


def snap_anterior():
    try:
        with urllib.request.urlopen(URL_SNAP + "?t=" + str(int(datetime.now().timestamp())), timeout=20) as r:
            return json.loads(r.read().decode("utf-8")).get("obras") or {}
    except Exception as e:
        print(f"(sem foto anterior dos campos do MC: {str(e)[:60]})", flush=True)
        return None


def disparar_robo_mc(motivo):
    tok, repo = os.environ.get("GH_TOKEN", "").strip(), os.environ.get("GITHUB_REPOSITORY", "").strip()
    if not tok or not repo:
        print("  (sem GH_TOKEN: não disparei o robô do MC — fica para a rodada das 06h23)", flush=True)
        return
    req = urllib.request.Request(f"https://api.github.com/repos/{repo}/dispatches", method="POST",
                                 data=json.dumps({"event_type": "robos-mc", "client_payload": {"motivo": motivo}}).encode())
    req.add_header("Authorization", "Bearer " + tok)
    req.add_header("Accept", "application/vnd.github+json")
    try:
        urllib.request.urlopen(req, timeout=20).read()
        print(f"Robôs do Mais Controle disparados ({motivo}).", flush=True)
    except Exception as e:
        print(f"  ! não disparei o robô do MC: {str(e)[:100]}", flush=True)


# ---------------------------------------------------------------- principal
def main():
    esq_obra = api("GET", f"/databases/{ID_OBRAS}").get("properties") or {}
    esq_docs = api("GET", f"/databases/{ID_DOCS}").get("properties") or {}
    esq_vend = api("GET", f"/databases/{ID_VENDAS}").get("properties") or {}

    def montar(esq_alvo, idx, base):
        m = []
        for c in CAMPOS:
            co, ca = achar(esq_obra, c[1]), achar(esq_alvo, c[idx]) if c[idx] else None
            if co and ca and esq_alvo[ca].get("type") not in GRAVAVEIS:
                print(f"  {base}: {c[0]:<26} — '{ca}' é {esq_alvo[ca].get('type')} (calculada no Notion, acompanha sozinha)", flush=True)
            elif co and ca:
                m.append((c[0], co, ca))
                print(f"  {base}: {c[0]:<26} obra '{co}' ({esq_obra[co].get('type')}) -> '{ca}' ({esq_alvo[ca].get('type')})", flush=True)
            elif c[idx]:
                print(f"  {base}: {c[0]:<26} — {'sem coluna na obra' if not co else 'sem coluna em ' + base}", flush=True)
        return m

    print("Campos ligados:", flush=True)
    mapa_docs, mapa_vend = montar(esq_docs, 2, "DOCUMENTOS"), montar(esq_vend, 3, "VENDAS")

    obras = {pg["id"].replace("-", ""): pg for pg in ler_banco(ID_OBRAS, "OBRAS")}
    pendentes = []        # (base, pagina, patch, trocas, obra_id, casa)
    avisos = {}
    for base, banco, mapa, esq in (("DOCUMENTOS", ID_DOCS, mapa_docs, esq_docs), ("VENDAS", ID_VENDAS, mapa_vend, esq_vend)):
        for pg in ler_banco(banco, base):
            if pg.get("archived") or pg.get("in_trash"):
                continue
            pr = pg.get("properties") or {}
            oid = obra_da_linha(pr)
            if not oid or oid not in obras:
                continue
            patch, trocas, av = diferencas(pr, obras[oid].get("properties") or {}, mapa, esq_obra, esq)
            for a in av:
                avisos[a] = avisos.get(a, 0) + 1
            if patch:
                casa = bruto(pr.get(achar(esq, ["CASA"]) or "")) if base == "VENDAS" else None
                pendentes.append((base, pg, patch, trocas, oid, casa))

    por_campo = {}
    for base, _, _, trocas, _, _ in pendentes:
        for r, _, _ in trocas:
            por_campo[f"{base} {r}"] = por_campo.get(f"{base} {r}", 0) + 1
    print(f"\nLinhas a corrigir: {len(pendentes)} · por campo: {json.dumps(por_campo, ensure_ascii=False)}", flush=True)
    for a, n in sorted(avisos.items(), key=lambda x: -x[1]):
        print(f"  aviso ({n}x): {a}", flush=True)
    for base, pg, _, trocas, oid, casa in pendentes[:60]:
        nome = titulo(obras[oid].get("properties")) + (f" CS {como_texto(casa)}" if casa is not None else "")
        print(f"  {base} · {nome}: " + " | ".join(f"{r}: {mostrar(r, a)} → {mostrar(r, d)}" for r, a, d in trocas), flush=True)
    if len(pendentes) > 60:
        print(f"  … e mais {len(pendentes) - 60}", flush=True)

    trava = len(pendentes) > LIMITE_SEGURO and not FORCAR
    if trava:
        print(f"\n!! {len(pendentes)} linhas > {LIMITE_SEGURO}: NÃO GRAVEI NADA. Confira o log e rode com FORCAR=1.", flush=True)

    feitos = {}           # obra -> {"docs": [...], "vendas": {casa: [...]}}
    if APLICAR and not trava:
        for base, pg, patch, trocas, oid, casa in pendentes:
            try:
                api("PATCH", f"/pages/{pg['id']}", {"properties": patch})
            except (Exception, SystemExit) as e:
                print(f"  ! não gravou {base} {titulo(pg.get('properties'))}: {str(e)[:160]}", flush=True)
                continue
            f = feitos.setdefault(oid, {"docs": [], "vendas": {}})
            if base == "DOCUMENTOS":
                f["docs"] += trocas
            else:
                f["vendas"].setdefault(como_texto(casa) if casa is not None else "?", []).extend(trocas)
        agora = datetime.now(timezone(timedelta(hours=-3))).strftime("%d/%m %H:%M")
        for oid, f in feitos.items():
            nota = texto_alerta(f["docs"], f["vendas"], agora)
            if nota:
                try:
                    anotar_alerta(oid, nota, esq_obra)
                except (Exception, SystemExit) as e:
                    print(f"  ! alerta não gravado em {titulo(obras[oid].get('properties'))}: {str(e)[:120]}", flush=True)
        n_docs = sum(1 for f in feitos.values() if f["docs"])
        n_casas = sum(len(f["vendas"]) for f in feitos.values())
        print(f"\nAPLICADO: DOCUMENTOS de {n_docs} obra(s) e {n_casas} casa(s) de VENDAS corrigidas · {len(feitos)} alerta(s)", flush=True)
    elif not APLICAR:
        print("\nSIMULAÇÃO — nada foi gravado.", flush=True)

    # ---- Mais Controle: os campos que o robô confere mudaram desde a última publicação?
    atual = {oid: hash_mc(pg.get("properties") or {}, esq_obra) for oid, pg in obras.items()}
    antes = snap_anterior()
    if antes is not None:
        mc_col = achar(esq_obra, ["MAIS CONTROLE"])
        mudaram = [oid for oid, h in atual.items() if oid in antes and antes[oid] != h
                   and (not mc_col or N(bruto(obras[oid]["properties"].get(mc_col))) == "CRIADA")]
        if mudaram:
            print(f"\n{len(mudaram)} obra(s) do Mais Controle com campo alterado: "
                  + ", ".join(titulo(obras[o].get("properties")) for o in mudaram[:15]), flush=True)
            if APLICAR:
                disparar_robo_mc(f"{len(mudaram)} obra(s) alterada(s)")
    SNAP.parent.mkdir(parents=True, exist_ok=True)
    SNAP.write_text(json.dumps({"gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"), "obras": atual},
                               separators=(",", ":")), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
