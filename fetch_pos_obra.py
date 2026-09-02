#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_pos_obra.py — PORTAL-MORAIS
Morais Engenharia e Construção

Publica dist/pos_obra.json: é o que a pos-obra.html passa a ler na abertura,
no lugar da ação "posObraBoot" do Apps Script.

POR QUE ESTE ARQUIVO EXISTE
---------------------------
A tela de Pós Obra era a única do portal que lia AO VIVO pelo Apps Script.
Isso a deixava presa a três custos que nenhum cache resolve:
  1. cada chamada é POST -> 302 -> GET em script.googleusercontent.com
     (2 RTTs antes de qualquer execução — 1 a 3 s só de rede no celular);
  2. o Web App publicado como "Executar como: Eu" ENFILEIRA as execuções de
     todos os usuários, porque para o Google são todas do mesmo dono;
  3. no caso frio, a execução ainda pagina as duas bases do Notion inteiras.
As telas de Vendas e Ligações não têm nenhum desses custos: elas baixam um
arquivo pronto do GitHub Pages (CDN). Este script coloca o Pós Obra no mesmo
caminho.

O QUE NÃO ENTRA AQUI (e por quê)
--------------------------------
CLIENTES e TELEFONE. O dist/ é servido pelo GitHub Pages para qualquer um que
saiba a URL, SEM login — é a mesma razão pela qual o fetch_vendas.py já deixa
esses campos fora do vendas.json. A tela pinta a lista na hora sem eles e
completa em seguida com a ação "posObraSensiveis" do Code.gs, que confere o
token do usuário logado. Mesmo padrão do "ligSensiveis" das Ligações.

O nome do CHAMADO ("ENDEREÇO CS 2") não é dado pessoal e continua no arquivo.

REGRAS COPIADAS DO Code.gs (mantenha as duas pontas em dia)
-----------------------------------------------------------
  posObraListaCalc_       -> a lista de obras e o STATUS calculado
  posObraContarCalc_      -> total / abertas / incompletos por obra
  posObraFaltando_        -> quais campos obrigatórios estão em branco
  posObraMarcacoesCalc_   -> uma marcação por data preenchida
  posObraInfoDaColuna_    -> o texto que acompanha cada data
  posObraAndamentoDaColuna_ (r14) -> o andamento DAQUELE evento
Se qualquer uma delas mudar lá, muda aqui — senão a tela mostra um número no
arquivo estático e outro depois de gravar (quando ela relê pelo Apps Script).

Variáveis de ambiente:
  NOTION_TOKEN  -> mesmo secret que o fetch_vendas.py já usa
"""

import json
import os
import re
import sys
import time

# Reaproveita os utilitários já validados do fetch_vendas.py: retry em
# 429/5xx, paginação de 100 em 100 e a conversão de propriedade do Notion
# para JSON. Importar é seguro — o main() de lá está protegido por
# if __name__ == "__main__", então nada dele roda neste import.
from fetch_vendas import api, ler_banco, valor, norm, gravar, SAIDA

# IDs das bases (não são credencial — ver comentário no topo do fetch_vendas.py).
# São os mesmos do CONFIG.DB do Code.gs.
ID_POS_OBRA_PADRAO = "3c9c5ab532d380a0b78bdb2f421bc9f5"   # PÓS OBRA (uma linha por obra/casa)
ID_ATIVIDADES_PADRAO = "3c9c5ab532d3800f8261fdab1e4ff621"  # ATIVIDADES PÓS OBRA (chamados)

DB_POS = (os.environ.get("POS_OBRA_DB_ID") or ID_POS_OBRA_PADRAO).strip()
DB_ATV = (os.environ.get("ATIVIDADES_POS_OBRA_DB_ID") or ID_ATIVIDADES_PADRAO).strip()

FINALIZADO = norm("SERVIÇO FINALIZADO")
COL_FLEX = "HORÁRIO FLEXÍVEL"
COL_AGIO = "ÁGIO"

# Tipos que o front-end considera editáveis. Precisa bater com o EDITAVEL_ do
# Code.gs: é ele que decide, no servidor, o que aceita gravação. Divergir aqui
# faria a tela desenhar um campo que o backend depois recusa.
TIPOS_EDITAVEIS = {
    "title", "rich_text", "number", "select", "status", "multi_select",
    "date", "checkbox", "url", "email", "phone_number", "files", "people",
}


# --------------------------------------------------------------------------
# Leitura tolerante de propriedade (mesmo papel do getTol_ do Code.gs)
# --------------------------------------------------------------------------
def prop_tol(props, nome):
    """Acha a coluna tolerando acento, caixa e espaço sobrando no nome.
    A base real tem colunas como 'SERVIÇO ' (com espaço no fim)."""
    if nome in props:
        return props[nome]
    alvo = norm(nome)
    for k, v in props.items():
        if norm(k) == alvo:
            return v
    return None


def v_tol(props, nome):
    p = prop_tol(props, nome)
    return valor(p) if p else None


def texto_livre(props, nome):
    """Equivalente do posObraTextoLivre_: CIDADE em VENDAS é FÓRMULA e SETOR é
    seleção, e as duas precisam virar texto. O valor() já resolve formula e
    rollup; aqui só normalizamos lista -> string."""
    v = v_tol(props, nome)
    if isinstance(v, list):
        v = ", ".join(str(x) for x in v if x)
    if v is None:
        return None
    v = str(v).strip()
    return v or None


def flex_da_obra(props):
    """HORÁRIO FLEXÍVEL aceita checkbox, select ou texto — a coluna pode ter
    sido criada de qualquer um desses jeitos no Notion, e a tela desenha o
    controle certo a partir do tipo (ver flexCampo, no fim do arquivo)."""
    p = prop_tol(props, COL_FLEX)
    if not p:
        return None
    if p.get("type") == "checkbox":
        return "SIM" if p.get("checkbox") else None
    v = valor(p)
    if isinstance(v, list):
        v = ", ".join(str(x) for x in v if x)
    return (str(v).strip() or None) if v else None


# --------------------------------------------------------------------------
# CAMPOS OBRIGATÓRIOS DO CHAMADO — cópia de POS_OBRA_OBRIGATORIOS (Code.gs)
# A comparação é por PEDAÇO do nome normalizado, e não por nome exato, pelo
# mesmo motivo de lá: renomear a coluna no Notion (como já aconteceu com
# "DATA DO SERVIÇO" -> "DATA AGENDAMENTO SERVIÇO") não pode quebrar a
# checagem em silêncio.
# --------------------------------------------------------------------------
OBRIGATORIOS = [
    ("SERVICO", "Serviço", "multi"),
    ("RESPONSAVEL", "Responsável", "sel"),
    ("DATA AGENDAMENTO", "Data de agendamento", "data"),
    ("INFORMACOES SERVICO", "Informações serviço", "texto"),
    ("ANDAMENTO DA SOLICITACAO", "Andamento da solicitação", "sel"),
    ("STATUS MATERIAL", "Status material", "sel"),
]


def faltando(props):
    """Rótulos dos campos obrigatórios em branco. Lista vazia = completo.
    Coluna que não existe na base é ignorada — não vira 'faltando' fantasma."""
    faltas = []
    for chave, rotulo, tipo in OBRIGATORIOS:
        achou = preenchido = False
        for nome, pp in props.items():
            n = norm(nome)
            if chave not in n:
                continue
            # "DATA AGENDAMENTO" casaria também com uma coluna de retorno;
            # as de retorno terminam em número e são opcionais.
            if chave == "DATA AGENDAMENTO" and re.search(r"\d\s*$", n):
                continue
            achou = True
            v = valor(pp)
            if tipo == "multi":
                preenchido = bool(v)
            elif tipo == "data":
                preenchido = bool(v)
            elif tipo == "texto":
                preenchido = bool(v and str(v).strip())
            else:
                preenchido = bool(v)
            if preenchido:
                break
        if achou and not preenchido:
            faltas.append(rotulo)
    return faltas


def nivel_de(nome):
    """Número no fim do nome da coluna: 'DATA REMARCAÇÃO 2' -> '2'."""
    m = re.search(r"(\d+)\s*$", str(nome))
    return m.group(1) if m else None


def eh_retorno(n_normalizado):
    """A base tem os dois nomes convivendo: REMARCAÇÃO (antigo) e RETORNO."""
    return "REMARCA" in n_normalizado or "RETORNO" in n_normalizado


def info_da_coluna(props, col):
    """Texto que acompanha uma data (posObraInfoDaColuna_ do Code.gs).
    Numa coluna de retorno é a INFORMAÇÕES daquele nível; em qualquer outra
    é a INFORMAÇÕES SERVIÇO."""
    n = norm(col)
    nivel = nivel_de(col)
    if eh_retorno(n) and nivel:
        for nome, pp in props.items():
            kn = norm(nome)
            if "INFORMAC" in kn and eh_retorno(kn) and nivel in kn:
                return valor(pp) or ""
    return v_tol(props, "INFORMAÇÕES SERVIÇO") or ""


def andamento_da_coluna(props, col, geral):
    """Andamento DAQUELE evento (r14). Serviço concluído não faz o retorno 3
    parecer concluído, e vice-versa.
    'ANDAMENTO DA SOLICITAÇÃO', depois de normalizado, NÃO contém 'SERVICO' —
    é por isso que ela nunca é confundida com 'ANDAMENTO DO SERVIÇO'."""
    n = norm(col)
    nivel = nivel_de(col)
    if eh_retorno(n) and nivel:
        for nome, pp in props.items():
            kn = norm(nome)
            if "ANDAMENTO" in kn and eh_retorno(kn) and nivel in kn:
                return valor(pp)
        return None
    if n.startswith("DATA") and "SERVICO" in n:
        for nome, pp in props.items():
            kn = norm(nome)
            if "ANDAMENTO" in kn and "SERVICO" in kn and not eh_retorno(kn):
                return valor(pp)
        return None
    return geral


def sem_hifen(pid):
    return str(pid or "").replace("-", "")


def valores_do_chamado(props):
    """Mesmo formato do resolver_() do Code.gs — é o que o painel do chamado
    já espera — com UMA diferença: a coluna de arquivo publica só o NOME.

    A URL que o Notion devolve para um arquivo hospedado é assinada e expira
    em cerca de uma hora. Publicar num arquivo estático entregaria link
    quebrado, e foto de obra não deve ficar acessível sem login de qualquer
    forma. A tela pede o link no clique (ação posObraArquivos do Code.gs)."""
    out = {}
    for nome, pp in props.items():
        t = pp.get("type")
        if t == "files":
            out[nome] = [{"name": f.get("name")} for f in (pp.get("files") or [])]
        elif t == "rollup":
            # o Code.gs devolve a string "(rollup)" e a tela já sabe lidar;
            # manter igual evita a coluna aparecer de um jeito no arquivo e de
            # outro depois que a tela revalida pelo Apps Script
            out[nome] = "(rollup)"
        else:
            out[nome] = valor(pp)
    return out


# --------------------------------------------------------------------------
def schema_da_base(db_id, com_titulo=False):
    """Schema ao vivo: nome, tipo, opções e se é editável.
    É daqui que a tela monta os campos do chamado — nunca de uma lista fixa,
    porque a base ganha colunas novas a cada nível de retorno criado."""
    r = api("GET", "/databases/" + db_id)
    campos, titulo_prop = [], "Nome"
    for nome, d in (r.get("properties") or {}).items():
        t = d.get("type")
        if t == "title":
            titulo_prop = nome
        c = {
            "nome": nome,
            "tipo": t,
            # title fica de fora: o nome do chamado é montado na criação
            # ("ENDEREÇO CS N"), não é pra ser digitado à mão
            "editavel": (t in TIPOS_EDITAVEIS and t != "title"),
        }
        if t in ("select", "status", "multi_select"):
            c["opcoes"] = [o.get("name") for o in (d.get(t) or {}).get("options", [])]
        campos.append(c)
    campos.sort(key=lambda c: norm(c["nome"]))
    if com_titulo:
        return {"ok": True, "tituloProp": titulo_prop, "campos": campos}
    return {"ok": True, "campos": campos}


def campo_do_schema(schema, nome):
    alvo = norm(nome)
    for c in schema.get("campos", []):
        if norm(c["nome"]) == alvo:
            return c
    return None


# --------------------------------------------------------------------------
def main():
    if not os.environ.get("NOTION_TOKEN", "").strip():
        raise SystemExit("Falta o secret NOTION_TOKEN no GitHub Actions.")

    os.makedirs(SAIDA, exist_ok=True)
    agora = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())

    # ---- 1. CHAMADOS: contagem por obra + marcações do calendário ---------
    # Uma leitura só da base de atividades gera os dois resultados, igual ao
    # posObraDadosCalc_ do Code.gs (r22).
    print("Lendo ATIVIDADES PÓS OBRA…", flush=True)
    atvs = ler_banco(DB_ATV, "ATIVIDADES PÓS OBRA")

    por_obra = {}
    marcacoes = []
    # Ids de TODOS os chamados publicados. A tela usa isto para saber quando
    # pode esquecer um serviço que ela criou e guardou no navegador: enquanto
    # o id não aparecer aqui, o chamado continua sendo desenhado a partir da
    # cópia local (ver "SERVIÇOS CRIADOS AGORA" na pos-obra.html). Sem esta
    # lista a conta ficava dobrada — o chamado sem data nunca gera marcação,
    # então a antiga limpeza pelo calendário nunca acontecia para ele.
    chamados = []
    # Chamados completos, agrupados por obra: viram um arquivo por obra em
    # dist/pos_obra/<id>.json, que é o que a tela lê ao abrir uma obra. Antes
    # isso era a ação "posObra" do Apps Script — uma execução inteira, na fila,
    # a cada clique numa obra.
    por_obra_atv = {}
    for a in atvs:
        props = a.get("properties") or {}
        chamados.append(a.get("id"))
        rel = (props.get("PÓS OBRA") or {}).get("relation") or []
        geral = v_tol(props, "ANDAMENTO DA SOLICITAÇÃO")
        aberta = norm(geral or "") != FINALIZADO
        # Chamado finalizado com campo em branco é histórico: cobrar agora não
        # muda nada e encheria a tela de aviso que ninguém pode resolver.
        faltas = faltando(props) if aberta else []

        for o in rel:
            k = sem_hifen(o.get("id"))
            if not k:
                continue
            m = por_obra.setdefault(k, {"total": 0, "abertas": 0, "incompletos": 0})
            m["total"] += 1
            if aberta:
                m["abertas"] += 1
            if faltas:
                m["incompletos"] += 1

        nome_chamado = ""
        for _, pp in props.items():
            if pp.get("type") == "title":
                nome_chamado = valor(pp) or ""
                break
        servicos = v_tol(props, "SERVIÇO") or []
        if not isinstance(servicos, list):
            servicos = [servicos]
        base = {
            "atividadeId": a.get("id"),
            "obraId": rel[0].get("id") if rel else None,
            "nome": nome_chamado,
            "andamento": geral,
            "responsavel": v_tol(props, "RESPONSÁVEL"),
            "servico": servicos,
            "statusMaterial": v_tol(props, "STATUS MATERIAL"),
            "faltando": faltas,
        }
        for col, pp in props.items():
            if pp.get("type") != "date":
                continue
            # DATA DO CHAMADO é registro de ABERTURA, não compromisso — fica
            # fora da agenda inteira (mesma exclusão do Code.gs).
            if "CHAMADO" in norm(col):
                continue
            d = valor(pp)
            if not d:
                continue
            item = dict(base)
            item["coluna"] = col
            item["data"] = d
            item["info"] = info_da_coluna(props, col)
            item["andamentoEvento"] = andamento_da_coluna(props, col, geral)
            marcacoes.append(item)

        # registro completo do chamado, para o arquivo da obra
        if rel:
            reg = {
                "id": a.get("id"),
                "nome": nome_chamado,
                "andamento": geral,
                "faltando": faltas,
                "valores": valores_do_chamado(props),
            }
            por_obra_atv.setdefault(sem_hifen(rel[0].get("id")), []).append(reg)

    marcacoes.sort(key=lambda m: str(m["data"]))
    print(f"  {len(atvs)} chamados -> {len(marcacoes)} marcações no calendário.", flush=True)

    # ---- 2. OBRAS ---------------------------------------------------------
    print("Lendo PÓS OBRA…", flush=True)
    linhas = ler_banco(DB_POS, "PÓS OBRA")

    obras = []
    # valores da própria obra (OBSERVAÇÕES, FOTOS DO CONTRATO, etc.), usados
    # pelo painel. CLIENTES e TELEFONE nunca entram — ver o topo do arquivo.
    obras_props = {}
    sem_cliente = 0
    for r in linhas:
        props = r.get("properties") or {}
        endereco = None
        for _, pp in props.items():
            if pp.get("type") == "title":
                endereco = valor(pp)
                break
        if not endereco:
            continue
        # Só entram obras COM cliente preenchido: obra sem cliente ainda não
        # foi vendida, então não existe pós obra pra ela. O NOME do cliente
        # não é publicado (ver o topo do arquivo) — só o fato de existir.
        cliente = v_tol(props, "CLIENTES")
        if not (cliente and str(cliente).strip()):
            sem_cliente += 1
            continue

        casa = v_tol(props, "CASA")
        vals = valores_do_chamado(props)
        for oculto in list(vals.keys()):
            n = norm(oculto)
            if n in ("CLIENTES", "CLIENTE", "TELEFONE"):
                del vals[oculto]
        obras_props[sem_hifen(r.get("id"))] = vals
        c = por_obra.get(sem_hifen(r.get("id")), {"total": 0, "abertas": 0, "incompletos": 0})
        obras.append({
            "id": r.get("id"),
            "endereco": endereco,
            "casa": casa,
            "titulo": endereco + ("" if casa is None else " CS " + str(int(casa) if float(casa).is_integer() else casa)),
            # clientes/telefone entram na tela pela ação posObraSensiveis
            "dataAssinatura": v_tol(props, "DATA DE ASSINATURA DO CONTRATO"),
            "horarioFlexivel": flex_da_obra(props),
            "agio": v_tol(props, COL_AGIO),
            "cidade": texto_livre(props, "CIDADE"),
            "setor": texto_livre(props, "SETOR"),
            "servicos": c["total"],
            "servicosAbertos": c["abertas"],
            "servicosIncompletos": c["incompletos"],
            "status": "PÓS OBRA EM ANDAMENTO" if c["abertas"] > 0 else "SEM PÓS OBRA",
        })

    obras.sort(key=lambda o: norm(o["titulo"]))
    print(f"  {len(obras)} obras com cliente ({sem_cliente} sem cliente, ignoradas).", flush=True)

    # ---- 3. SCHEMAS -------------------------------------------------------
    print("Lendo schema das duas bases…", flush=True)
    schema_atv = schema_da_base(DB_ATV, com_titulo=True)
    schema_obra = schema_da_base(DB_POS)
    fc = campo_do_schema(schema_obra, COL_FLEX)
    flex_campo = None
    if fc:
        flex_campo = {"nome": fc["nome"], "tipo": fc["tipo"], "opcoes": fc.get("opcoes")}
    else:
        print("  ! coluna 'HORÁRIO FLEXÍVEL' não existe na base PÓS OBRA — "
              "a tela simplesmente não mostra o controle.", flush=True)

    # ---- 4. UM ARQUIVO POR OBRA -----------------------------------------
    # É o que a tela baixa ao abrir uma obra: 2 a 10 KB, direto do CDN, em vez
    # de uma execução do Apps Script na fila. O nome do arquivo é o id da obra
    # SEM hífen (o id do Notion tem hífen, e hífen em nome de arquivo servido
    # pelo Pages funciona, mas o resto do sistema já compara ids sem ele —
    # manter um padrão só evita erro bobo de "arquivo não encontrado").
    pasta = os.path.join(SAIDA, "pos_obra")
    os.makedirs(pasta, exist_ok=True)
    escritos = 0
    for o in obras:
        chave = sem_hifen(o["id"])
        pagina = {
            "ok": True,
            "updated_at": agora,
            "id": o["id"],
            "endereco": o["endereco"],
            "casa": o["casa"],
            "titulo": o["titulo"],
            # CLIENTES e TELEFONE ficam de fora aqui também — a tela já os tem
            # em memória, vindos do posObraSensiveis
            "valores": obras_props.get(chave, {}),
            "horarioFlexivel": o["horarioFlexivel"],
            "agio": o["agio"],
            "cidade": o["cidade"],
            "setor": o["setor"],
            "atividades": por_obra_atv.get(chave, []),
        }
        caminho = os.path.join(pasta, chave + ".json")
        with open(caminho, "w", encoding="utf-8") as f:
            json.dump(pagina, f, ensure_ascii=False, separators=(",", ":"))
        escritos += 1
    print(f"  {escritos} páginas de obra em {pasta}/", flush=True)

    gravar("pos_obra.json", {
        "ok": True,
        "updated_at": agora,
        "total": len(obras),
        "obras": obras,
        "marcacoes": marcacoes,
        "chamados": chamados,
        "flexCampo": flex_campo,
        "schema": schema_atv,
    })
    print(f"OK — {len(obras)} obras, {len(marcacoes)} marcações.", flush=True)


if __name__ == "__main__":
    sys.exit(main())
