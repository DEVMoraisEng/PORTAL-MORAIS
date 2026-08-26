#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_vendas.py — PORTAL-MORAIS
Morais Engenharia e Construção

Lê o Notion (VENDAS + DOCUMENTOS) e publica JSON estático em dist/.
É isto que deixa o portal rápido igual ao RAS-SEMANAL: o navegador baixa
um arquivo pronto em vez de esperar o Apps Script paginar o Notion ao vivo.

O Apps Script continua existindo — ele só cuida de LOGIN e ESCRITA.
Leitura passa a vir daqui.

Variáveis de ambiente (Settings > Secrets and variables > Actions > Secrets):
  NOTION_TOKEN        -> token da integração do Notion   <<< ÚNICO SEGREDO DE VERDADE

Os IDs das bases ficam fixos aqui embaixo de propósito: um ID de base do Notion
não é credencial (sem o token ele não abre nada, e ele já aparece na URL da
página). Deixar como secret só dava trabalho de configuração à toa.
Dá pra sobrescrever por variável de ambiente se algum dia mudar de base.

Saídas:
  dist/schema.json      -> definição das colunas (nome, tipo, opções, editável)
  dist/vendas.json      -> registros de VENDAS SEM as colunas sensíveis
                           (ver CAMPOS_SENSIVEIS logo abaixo). O dist/ é servido
                           pelo GitHub Pages sem token nenhum: tudo que entra
                           aqui é público na prática. Dado sensível fica de fora
                           e o site busca sob demanda, pelo Apps Script, quando
                           o usuário logado abre a obra. Cada registro leva um
                           "sens" com apenas "preenchido sim/não" (e a contagem
                           de anexos) das colunas ocultas.
  dist/documentos.json  -> índice endereço -> {habite, obra_iniciada}
  dist/ligacoes.json    -> UC por concessionária, por casa (água e energia)
  dist/data_vendas.json -> recorte achatado para o painel do Gestor de Vendas
                           (casas-vendidas.html). NÃO leva nome de cliente:
                           "clientes" vai como true/false, que é o único uso
                           que a página faz do campo.
  dist/updated.json     -> carimbo de data/hora da última atualização
"""

import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request

NOTION_VERSION = "2022-06-28"
API = "https://api.notion.com/v1"

# IDs das bases (não são segredo — ver comentário no topo).
# PREENCHER: o ID da base VENDAS está no seu Code.gs, ou na URL da base no
# Notion (o bloco de 32 caracteres depois de /p/ ou do nome do workspace).
ID_VENDAS_PADRAO = "33cc5ab532d38047ae3aee8b87ac1f4d"  # base VENDAS
ID_DOCUMENTOS_PADRAO = "32fc5ab532d380a0900dd7f4bfc619bd"
# Mesma base METAS já usada pelo Code.gs (CONFIG.DB.METAS) — reaproveitada
# aqui pra calcular o card "Meta de Casas" do dashboard (portal.json).
ID_METAS_PADRAO = "358c5ab532d3804fbcbfebc3656b1220"
# LIGAÇÕES DE ÁGUA E ENERGIA — uma linha por casa, com a UC de cada
# concessionária (SANEAGO/SANESC para água, EQUATORIAL para energia).
ID_LIGACOES_PADRAO = "313c5ab532d3801e974ced0bb656c9d5"

TOKEN = os.environ.get("NOTION_TOKEN", "").strip()
DB_VENDAS = (os.environ.get("VENDAS_DB_ID") or ID_VENDAS_PADRAO).strip()
DB_DOCS = (os.environ.get("DOCUMENTOS_DB_ID") or ID_DOCUMENTOS_PADRAO).strip()
DB_METAS = (os.environ.get("METAS_DB_ID") or ID_METAS_PADRAO).strip()
DB_LIGACOES = (os.environ.get("LIGACOES_DB_ID") or ID_LIGACOES_PADRAO).strip()

SAIDA = "dist"

# --------------------------------------------------------------------------
# CAMPOS SENSÍVEIS — nunca vão para dist/vendas.json
#
# O GitHub Pages serve dist/ para qualquer um que saiba a URL, sem login.
# Por isso o dado pessoal não é publicado: o schema marca a coluna como
# "sensivel", a planilha mostra "•••", e o valor real só chega quando o
# usuário LOGADO abre a obra (aí a leitura vai pelo Apps Script, que confere
# o token). Fora do portal, o dado simplesmente não existe.
#
# A comparação é por PEDAÇO do nome, sem acento e sem caixa — "CPF" pega
# "CPF ", "CPF DO CLIENTE", "Cpf/Cnpj" etc. Para incluir outra coluna, basta
# acrescentar um fragmento aqui (ou definir CAMPOS_SENSIVEIS no workflow,
# separado por vírgula, que substitui esta lista).
#
# ATENÇÃO ao esconder colunas usadas em REGRA de negócio, não só em exibição:
# "CLIENTES" alimenta o marcador de obra vendida (situacoesDe) e "VALOR NA MÃO"
# alimenta o de disponível, no vendas.html. Se você escondê-las, esses
# marcadores param de funcionar na planilha. Por isso ficam de fora por padrão.
# --------------------------------------------------------------------------
CAMPOS_SENSIVEIS_PADRAO = [
    # identificação do comprador
    "CLIENTE", "COMPRADOR", "NOME DO CLIENTE", "NOME DO COMPRADOR",
    "CPF", "CNPJ", "RG", "IDENTIDADE",
    # contato
    "TELEFONE", "CELULAR", "WHATSAPP", "CONTATO", "E-MAIL", "EMAIL",
    # financeiro pessoal
    "PARCELA", "FGTS",
    "AGENCIA", "CONTA CORRENTE", "PIX",   # "BANCO" fica de fora: é o banco
                                          # financiador da obra, não conta bancária
    "NASCIMENTO", "ESTADO CIVIL", "PROFISSAO", "RENDA",
    "ENDERECO DO CLIENTE", "ENDERECO RESIDENCIAL",
]
# Além da lista acima, TODA coluna do tipo "files" é tratada como sensível:
# o Notion devolve URLs assinadas do S3, e publicá-las em dist/ entregaria o
# anexo (contrato, RG escaneado…) a quem tivesse a URL do JSON, sem login.
OCULTAR_ANEXOS = True
_env_sens = os.environ.get("CAMPOS_SENSIVEIS", "").strip()
CAMPOS_SENSIVEIS = (
    [x.strip() for x in _env_sens.split(",") if x.strip()]
    if _env_sens else CAMPOS_SENSIVEIS_PADRAO
)
_SENS_NORM = None  # preenchido em main(), depois que norm() existe

# Tipos que o usuário pode editar pelo site. rollup/formula/relation são
# calculados no Notion — mostramos, mas não deixamos escrever.
TIPOS_EDITAVEIS = {
    "title", "rich_text", "select", "status", "multi_select", "date",
    "checkbox", "number", "url", "email", "phone_number",
    # "people" é editável, mas SÓ pela lista de usuários do Notion (a API
    # exige o UUID da pessoa, não o nome) — o site monta um <select> com a
    # ação "usuarios" do Code.gs. Precisa bater com o EDITAVEL_ de lá.
    "people",
}


def norm(s):
    """Maiúsculas sem acento — pra comparar nomes de coluna com segurança.
    A base VENDAS tem typo real ('ENG. RESPONSÁEL'), então nunca comparamos
    string crua.

    CORREÇÃO: NFD tira acento, mas NÃO mexe no indicador ordinal 'º' (nem no
    'ª', nem no grau '°', que muita gente digita no lugar do ordinal). Era por
    isso que a coluna real 'Nº DE CASAS' nunca casava com o fragmento
    'N DE CASAS' e todo lote acabava contado como 1 casa — o aviso
    "coluna de 'número de casas' não encontrada" no log do GitHub Actions.
    Aqui esses três caracteres somem antes da comparação, então
    'Nº DE CASAS' -> 'N DE CASAS'."""
    s = str(s or "")
    for c in ("º", "ª", "°"):
        s = s.replace(c, "")
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return " ".join(s.upper().split())


def eh_sensivel(nome):
    """True se o nome da coluna casar com algum fragmento de CAMPOS_SENSIVEIS.
    Compara sobre o nome normalizado (sem acento, sem caixa, sem espaço
    sobrando — a base VENDAS tem colunas como "CPF "), exigindo PALAVRA
    INTEIRA. Substring solto daria falso positivo feio: "RG" casaria com
    "ENCARGOS" e a coluna sumiria da planilha sem ninguém entender por quê.
    Palavra inteira ainda pega "CPF/CNPJ", "TELEFONE 1", "E-mail do cliente"."""
    n = norm(nome)
    # S? no fim: "PARCELA" pega "PARCELAS", "CLIENTE" pega "CLIENTES"
    return any(re.search(r"\b" + re.escape(frag) + r"S?\b", n) for frag in _SENS_NORM)


def getV_py(valores, nome):
    """Leitura tolerante (mesmo espírito do getV() do app.js): a base VENDAS
    às vezes tem espaço sobrando no fim do nome da coluna no Notion."""
    if nome in valores:
        return valores[nome]
    alvo = norm(nome)
    for k, v in valores.items():
        if norm(k) == alvo:
            return v
    return None


def api(method, path, body=None, tentativas=4):
    """Chamada ao Notion com retry em 429/5xx (o Actions falha feio sem isso)."""
    url = API + path
    dados = json.dumps(body).encode("utf-8") if body is not None else None
    for n in range(tentativas):
        req = urllib.request.Request(url, data=dados, method=method)
        req.add_header("Authorization", "Bearer " + TOKEN)
        req.add_header("Notion-Version", NOTION_VERSION)
        req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            corpo = e.read().decode("utf-8", "replace")[:300]
            if e.code in (429, 500, 502, 503, 504) and n < tentativas - 1:
                espera = 2 ** n
                print(f"  ! HTTP {e.code}, tentando de novo em {espera}s", flush=True)
                time.sleep(espera)
                continue
            raise SystemExit(f"Notion {e.code} em {path}: {corpo}")
        except urllib.error.URLError as e:
            if n < tentativas - 1:
                time.sleep(2 ** n)
                continue
            raise SystemExit(f"Falha de rede em {path}: {e}")


def ler_banco(db_id, rotulo):
    """Pagina o banco inteiro (100 por vez)."""
    paginas, cursor, volta = [], None, 0
    while True:
        corpo = {"page_size": 100}
        if cursor:
            corpo["start_cursor"] = cursor
        r = api("POST", f"/databases/{db_id}/query", corpo)
        paginas.extend(r.get("results", []))
        volta += 1
        print(f"  {rotulo}: {len(paginas)} registros…", flush=True)
        if not r.get("has_more"):
            break
        cursor = r.get("next_cursor")
        if volta > 200:  # trava de segurança contra loop infinito
            print("  ! parei em 200 páginas", flush=True)
            break
    return paginas


def valor(prop):
    """Converte uma propriedade do Notion para um valor simples de JSON.
    Mesmo formato que o front-end já espera do Apps Script."""
    t = prop.get("type")

    if t == "title":
        return "".join(x.get("plain_text", "") for x in prop.get("title", []))
    if t == "rich_text":
        return "".join(x.get("plain_text", "") for x in prop.get("rich_text", []))
    if t == "select":
        s = prop.get("select")
        return s.get("name") if s else None
    if t == "status":
        s = prop.get("status")
        return s.get("name") if s else None
    if t == "multi_select":
        return [x.get("name") for x in prop.get("multi_select", [])]
    if t == "date":
        d = prop.get("date")
        return d.get("start") if d else None
    if t == "checkbox":
        return bool(prop.get("checkbox"))
    if t == "number":
        return prop.get("number")
    if t in ("url", "email", "phone_number"):
        return prop.get(t)
    if t == "people":
        return [p.get("name") or p.get("id") for p in prop.get("people", [])]
    if t == "files":
        saida = []
        for f in prop.get("files", []):
            # arquivo hospedado no Notion expira; link externo não
            url = (f.get("file") or {}).get("url") or (f.get("external") or {}).get("url")
            saida.append({"name": f.get("name"), "url": url})
        return saida
    if t == "relation":
        # Devolve o NOME da página ligada quando já foi resolvido (ver
        # resolver_titulos_relacao, chamado antes de montar as linhas); cai no
        # id só se a base ligada não estiver compartilhada com a integração.
        # Antes daqui saía sempre o id cru, e era ele que aparecia na tela.
        saida = []
        for x in prop.get("relation", []):
            pid = x.get("id")
            nome = _TITULOS_RELACAO.get(_chave_id(pid))
            saida.append(nome if nome else pid)
        return saida
    if t == "formula":
        f = prop.get("formula", {})
        return f.get(f.get("type"))
    if t == "rollup":
        r = prop.get("rollup", {})
        tr = r.get("type")
        if tr == "array":
            return [valor(x) for x in r.get("array", [])]
        return r.get(tr)
    # (o "relation" acima já tratou este tipo — este bloco era inalcançável)
    if t in ("created_time", "last_edited_time"):
        return prop.get(t)
    return None


_TITULOS_RELACAO: dict = {}      # id da página (sem hífen) -> título
_BASES_JA_LIDAS: set = set()     # database_id já varrido, pra não repetir


def _chave_id(page_id) -> str:
    return str(page_id or "").replace("-", "")


def resolver_titulos_relacao(ids) -> None:
    """Descobre o NOME das páginas ligadas por colunas do tipo relation.

    Uma coluna relation no Notion guarda só o id da página ligada — foi por
    isso que a "cola" OBRA-AUTO aparecia como '34ac5ab5-32d3-...' no site em
    vez de 'RR 02 QD 01 LT 23'. E resolver isso em tempo real, pelo Apps
    Script, saiu caro: era um GET /pages por id, sequencial, competindo com as
    outras chamadas do site (o Apps Script atende uma por vez por usuário) —
    o que atrasava a tela e derrubava a contagem de atividades por timeout.
    Aqui, no build, o custo não incomoda: roda no GitHub Actions.

    Truque pra não precisar configurar nada: a gente NÃO sabe de antemão para
    qual base a relation aponta (no caso do OBRA-AUTO é uma base de projetos,
    não a de documentos). Então pega UM id, pergunta ao Notion quem é o pai
    dele e, de posse do database_id, varre a base inteira de uma vez — poucas
    chamadas paginadas em vez de uma por linha.
    """
    # dedup por id (sem hífen), mantendo um exemplar de cada, e descarta o que
    # já foi resolvido numa chamada anterior
    unicos = {_chave_id(x): x for x in ids if x}
    pendentes = [pid for chave, pid in unicos.items()
                 if chave not in _TITULOS_RELACAO]
    if not pendentes:
        return

    voltas = 0
    while pendentes and voltas < 6:      # teto: no máximo 6 bases diferentes
        voltas += 1
        amostra = pendentes[0]
        try:
            pg = api("GET", f"/pages/{amostra}")
        except Exception as e:
            # só a 1ª falha vira log: quando a base não está compartilhada com
            # a integração, TODAS falham pelo mesmo motivo e repetir 6 vezes a
            # mesma linha só atrapalha quem lê o log depois.
            if voltas == 1:
                print(f"  ! não consegui ler a página ligada {amostra}: {e}", flush=True)
            _TITULOS_RELACAO[_chave_id(amostra)] = None
            pendentes = [p for p in pendentes if _chave_id(p) not in _TITULOS_RELACAO]
            continue

        db_id = ((pg.get("parent") or {}).get("database_id") or "").replace("-", "")
        # guarda o título da própria amostra, sirva ou não a varredura
        _TITULOS_RELACAO[_chave_id(amostra)] = _titulo_de_pagina(pg)

        if db_id and db_id not in _BASES_JA_LIDAS:
            _BASES_JA_LIDAS.add(db_id)
            try:
                paginas = ler_banco(db_id, f"RELAÇÃO {db_id[:8]}")
                for p in paginas:
                    _TITULOS_RELACAO[_chave_id(p.get("id"))] = _titulo_de_pagina(p)
                print(f"  relação: base {db_id[:8]}… lida "
                      f"({len(paginas)} páginas com nome)", flush=True)
            except Exception as e:
                print(f"  ! não consegui varrer a base ligada {db_id[:8]}…: {e}", flush=True)

        pendentes = [p for p in pendentes if _chave_id(p) not in _TITULOS_RELACAO]

    for p in pendentes:                  # sobrou algo: marca pra não tentar de novo
        _TITULOS_RELACAO[_chave_id(p)] = None


def _titulo_de_pagina(pg) -> str:
    for _, prop in (pg.get("properties") or {}).items():
        if prop.get("type") == "title":
            return "".join(t.get("plain_text", "") for t in (prop.get("title") or [])).strip()
    return ""


def montar_schema(db_id, marcar_sensiveis=False):
    """marcar_sensiveis=True só para VENDAS: acrescenta "sensivel": true nas
    colunas cujo valor NÃO é publicado. O front-end usa essa marca para exibir
    "•••" na planilha e buscar o valor real ao abrir a obra."""
    r = api("GET", f"/databases/{db_id}")
    campos = []
    for nome, d in (r.get("properties") or {}).items():
        t = d.get("type")
        opcoes = None
        if t in ("select", "status", "multi_select"):
            bloco = d.get(t) or {}
            opcoes = [o.get("name") for o in bloco.get("options", [])]
        c = {
            "nome": nome,
            "tipo": t,
            "opcoes": opcoes,
            "editavel": t in TIPOS_EDITAVEIS,
        }
        if marcar_sensiveis and (eh_sensivel(nome) or (OCULTAR_ANEXOS and t == "files")):
            c["sensivel"] = True
        campos.append(c)
    # ordem alfabética só pra saída ficar estável entre execuções;
    # a ordem de exibição é decidida no front-end
    campos.sort(key=lambda c: norm(c["nome"]))
    return campos


def achar(campos_norm, *fragmentos):
    """Acha o nome real da coluna por pedaço do nome (tolera typo/acento)."""
    for frag in fragmentos:
        alvo = norm(frag)
        for real, n in campos_norm:
            if alvo in n:
                return real
    return None


def gravar(nome, obj):
    caminho = os.path.join(SAIDA, nome)
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    kb = os.path.getsize(caminho) / 1024
    print(f"  -> {caminho} ({kb:.0f} KB)", flush=True)


def main():
    if not TOKEN:
        raise SystemExit(
            "Falta o secret NOTION_TOKEN no GitHub "
            "(Settings > Secrets and variables > Actions)."
        )
    if not DB_VENDAS:
        raise SystemExit(
            "Falta o ID da base VENDAS. Abra fetch_vendas.py e cole o ID em "
            "ID_VENDAS_PADRAO (linha ~40). Ele está no seu Code.gs, ou na URL "
            "da base no Notion: o bloco de 32 caracteres."
        )

    os.makedirs(SAIDA, exist_ok=True)
    agora = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())

    global _SENS_NORM
    _SENS_NORM = [norm(x) for x in CAMPOS_SENSIVEIS if norm(x)]

    print("Lendo schema de VENDAS…", flush=True)
    campos = montar_schema(DB_VENDAS, marcar_sensiveis=True)

    # Nomes exatos das colunas que NÃO serão publicadas. Guardamos o nome real
    # (com o espaço sobrando que às vezes vem do Notion) pra descartar por
    # chave, sem depender de normalizar de novo lá embaixo.
    ocultas = {c["nome"] for c in campos if c.get("sensivel")}
    if ocultas:
        print("  colunas NÃO publicadas em dist/vendas.json ("
              + str(len(ocultas)) + "): "
              + ", ".join(sorted(repr(n) for n in ocultas)), flush=True)
        print("    (o site mostra '•••' e busca o valor pelo Apps Script ao "
              "abrir a obra, com o token do usuário logado)", flush=True)
    else:
        print("  ! nenhuma coluna sensível encontrada. Confira se os nomes reais "
              "da base batem com CAMPOS_SENSIVEIS (topo do arquivo) — se a base "
              "tem CPF e nada apareceu aqui, algo está errado.", flush=True)

    print("Lendo registros de VENDAS…", flush=True)
    paginas = ler_banco(DB_VENDAS, "VENDAS")

    # Nomes das páginas ligadas por relation (ex.: OBRA-AUTO). Precisa rodar
    # ANTES de montar as linhas, porque é o valor() que consulta o resultado.
    ids_relacao = []
    for pg in paginas:
        for _, prop in (pg.get("properties") or {}).items():
            if prop.get("type") == "relation":
                ids_relacao += [x.get("id") for x in (prop.get("relation") or []) if x.get("id")]
    if ids_relacao:
        print(f"Resolvendo nomes de {len({_chave_id(i) for i in ids_relacao})} "
              f"página(s) ligada(s) por relation…", flush=True)
        resolver_titulos_relacao(ids_relacao)
        achados = sum(1 for i in {_chave_id(x) for x in ids_relacao}
                      if _TITULOS_RELACAO.get(i))
        total = len({_chave_id(i) for i in ids_relacao})
        print(f"  nomes resolvidos: {achados}/{total}", flush=True)
        if achados < total:
            print("  ! os que faltaram continuam aparecendo como id no site — "
                  "compartilhe a base ligada com a integração no Notion "
                  "(base > ... > Conexões).", flush=True)

    # O endpoint /databases às vezes NÃO devolve colunas de relation e rollup —
    # acontece quando a integração não tem acesso à base do outro lado da
    # relação. As páginas, porém, trazem essas propriedades. Então completamos
    # o schema com o que aparece nos registros e avisamos no log.
    nomes_schema = {norm(c["nome"]) for c in campos}
    extras = {}
    for pg in paginas:
        for nome, prop in (pg.get("properties") or {}).items():
            if norm(nome) in nomes_schema or norm(nome) in extras:
                continue
            extras[norm(nome)] = (nome, prop.get("type"))
    if extras:
        print("  ! " + str(len(extras)) + " coluna(s) não vieram do schema do banco "
              "e foram recuperadas das páginas:", flush=True)
        for _, (nome, tipo) in sorted(extras.items()):
            print("      " + repr(nome) + "  (" + str(tipo) + ")", flush=True)
        print("      Se forem relation/rollup, o motivo é a integração do Notion não "
              "ter acesso à base relacionada. Compartilhe aquela base com a "
              "integração para o dado (não só o nome) vir preenchido.", flush=True)
        for _, (nome, tipo) in sorted(extras.items()):
            c = {"nome": nome, "tipo": tipo, "opcoes": None,
                 "editavel": tipo in TIPOS_EDITAVEIS}
            if eh_sensivel(nome) or (OCULTAR_ANEXOS and tipo == "files"):
                c["sensivel"] = True
            campos.append(c)
        campos.sort(key=lambda c: norm(c["nome"]))
        ocultas = {c["nome"] for c in campos if c.get("sensivel")}

    gravar("schema.json", {"ok": True, "campos": campos, "updated_at": agora})
    vendas = []
    vazios = 0
    for p in paginas:
        vals = {}
        # "sens": resumo NÃO identificável das colunas ocultas. Só diz se o campo
        # está preenchido (e, em anexo, quantos arquivos existem) — nunca o
        # conteúdo. É o que mantém a planilha útil: o marcador de obra vendida,
        # o "3 arq." e a noção de "falta preencher" continuam funcionando sem
        # que o dado em si saia do Notion.
        sens = {}
        for nome, prop in (p.get("properties") or {}).items():
            if nome in ocultas:
                vazios += 1
                v = valor(prop)
                if isinstance(v, list):
                    if v:
                        sens[nome] = len(v)          # nº de anexos / itens
                elif v is not None and v != "":
                    sens[nome] = True                # preenchido, e só
                continue  # o valor nunca entra no arquivo — nem vazio, nem mascarado
            vals[nome] = valor(prop)
        reg = {"id": p["id"], "valores": vals}
        if sens:
            reg["sens"] = sens
        vendas.append(reg)
    gravar("vendas.json", {
        "ok": True, "total": len(vendas), "vendas": vendas,
        # o front usa isto pra saber que a planilha veio "podada" de propósito
        # (e não que o build quebrou e esqueceu colunas)
        "ocultas": sorted(ocultas), "updated_at": agora,
    })
    if vazios:
        print(f"  {vazios} valores sensíveis descartados antes de gravar.", flush=True)

    # DOCUMENTOS: índice endereço -> flags (contadores "em breve"/"em construção")
    # + lista completa (docs_full) usada pra calcular o dashboard (portal.json):
    # precisa de n_casas/cota/datas, não só habite/obra_iniciada.
    docs_idx = {}
    docs_full = []
    if DB_DOCS:
        print("Lendo DOCUMENTOS OBRAS…", flush=True)
        cd = montar_schema(DB_DOCS)
        cn = [(c["nome"], norm(c["nome"])) for c in cd]
        c_end = achar(cn, "ENDERECO", "OBRA", "NOME")
        c_hab = achar(cn, "APROVOU HABITE", "HABITE")
        c_obr = achar(cn, "OBRA INICIADA", "OBRA INCIADA")
        # CORREÇÃO item 2/3: campos extras pra distinguir CASAS de LOTES e
        # separar Morais/Investidor. Busca tolerante (fragmento) — se algum
        # nome não bater, o card correspondente cai em valor-padrão seguro
        # (1 casa, 100% Morais) em vez de quebrar o build.
        # "Nº DE CASAS" vira "N DE CASAS" depois do norm() (ver correção lá).
        # As variantes cobrem quem escrever com ponto, por extenso ou "QTD".
        c_ncasas = achar(cn, "N DE CASAS", "NO DE CASAS", "N. DE CASAS",
                         "NUMERO DE CASAS", "QUANTIDADE DE CASAS",
                         "QTD DE CASAS", "QTD CASAS", "CASAS COMPORTADAS", "N CASAS")
        c_cota = achar(cn, "COTA DA EMPRESA", "COTA EMPRESA", "COTA")
        c_dini = achar(cn, "DATA DE INICIO DA OBRA", "DATA INICIO DA OBRA", "INICIO DA OBRA")
        c_daq = achar(cn, "DATA DE AQUISICAO DO LOTE", "DATA AQUISICAO DO LOTE", "AQUISICAO DO LOTE", "AQUISICAO LOTE")
        c_impl = achar(cn, "IMPLANTACAO")
        # usada só pelo painel do Gestor (prazo médio certidões -> venda)
        c_cert = achar(cn, "DATA DAS CERTIDOES", "DATA CERTIDOES", "CERTIDOES")
        # usadas pela aba Estoque de Casas
        c_setor = achar(cn, "SETOR")
        c_fim   = achar(cn, "OBRA FINALIZADA?", "OBRA FINALIZADA")
        # item 2 (pedido): data em que o habite-se foi aprovado, exibida ao
        # expandir o setor na coluna "Em estoque".
        c_dhab  = achar(cn, "DATA DE APROVACAO DO HABITE-SE", "DATA DE APROVACAO DO HABITE",
                        "DATA APROVACAO HABITE", "DATA DO HABITE", "DATA HABITE",
                        "APROVACAO DO HABITE")
        print(f"  colunas: endereço={c_end!r} habite={c_hab!r} obra={c_obr!r} "
              f"n_casas={c_ncasas!r} cota={c_cota!r} data_inicio_obra={c_dini!r} "
              f"data_aquisicao_lote={c_daq!r} implantacao={c_impl!r} "
              f"data_habite={c_dhab!r}", flush=True)
        if not c_dhab:
            print("  ! coluna 'DATA DE APROVAÇÃO DO HABITE-SE' não encontrada — a data "
                  "não vai aparecer ao expandir o setor na aba Estoque de Casas.", flush=True)
        if not c_ncasas:
            print("  ! coluna de 'número de casas' não encontrada — cada lote conta "
                  "como 1 casa (mesmo bug do item 2 do pedido). Confira o nome exato "
                  "da coluna no Notion e ajuste os fragmentos em achar(cn, ...).", flush=True)

        def pega(props, col):
            return valor(props[col]) if col and col in props else None

        for p in ler_banco(DB_DOCS, "DOCUMENTOS"):
            props = p.get("properties") or {}
            end = valor(props[c_end]) if c_end and c_end in props else None
            if not end:
                continue
            habite = pega(props, c_hab)
            obra_iniciada = pega(props, c_obr)
            docs_idx[norm(end)] = {"habite": habite, "obra_iniciada": obra_iniciada}
            cota = pega(props, c_cota)
            docs_full.append({
                # O id da página é o que permite traduzir uma coluna de
                # RELATION (que a API devolve como lista de ids) para um nome
                # legível no site — sem ele, a "cola" OBRA-AUTO aparecia como
                # "34ac5ab5-32d3-802d-..." em vez do endereço da obra.
                "id": p.get("id"),
                "endereco": end,
                "n_casas": pega(props, c_ncasas) or 1,
                "cota_empresa": cota if cota is not None else 1.0,
                "data_inicio_obra": pega(props, c_dini),
                "data_aquisicao_lote": pega(props, c_daq),
                "obra_iniciada": obra_iniciada,
                "implantacao": pega(props, c_impl),
                "data_certidoes": pega(props, c_cert),
                # estoque: setor, habite-se e obra finalizada
                "setor": pega(props, c_setor),
                "habite": habite,
                "data_habite": pega(props, c_dhab),
                "obra_finalizada": pega(props, c_fim),
            })
        # "lista" é o que a aba Estoque de Casas consome. O "docs" (índice por
        # endereço) continua igual, pra não quebrar quem já usa.
        gravar("documentos.json", {
            "ok": True, "total": len(docs_idx), "docs": docs_idx,
            "lista": docs_full,
            "colunas": {"endereco": c_end, "habite": c_hab, "obra_iniciada": c_obr,
                        "setor": c_setor, "obra_finalizada": c_fim, "n_casas": c_ncasas,
                        "data_habite": c_dhab},
            "updated_at": agora,
        })
    else:
        print("DOCUMENTOS_DB_ID não definido — pulando (contadores ficarão em '—').", flush=True)
        gravar("documentos.json", {"ok": False, "docs": {}, "updated_at": agora})

    # LIGAÇÕES DE ÁGUA E ENERGIA -----------------------------------------
    # Uma linha por casa e por concessionária. Publicamos os dois jeitos de
    # casar com a obra: o id da relação (preciso) e o texto do título
    # (ex.: "TB 18 QD 49 LT 31 CS 1"), que serve de plano B quando a linha
    # não estiver relacionada. O front tenta o id primeiro.
    if DB_LIGACOES:
        print("Lendo LIGAÇÕES DE ÁGUA E ENERGIA…", flush=True)
        try:
            lig_rows = ler_banco(DB_LIGACOES, "LIGAÇÕES")
        except Exception as e:
            print("  ! falhou: " + str(e), flush=True)
            lig_rows = None

        if lig_rows is None:
            gravar("ligacoes.json", {"ok": False, "ligacoes": [], "updated_at": agora})
        else:
            # Schema da base: é com ele que o ligacoes.html monta os filtros e
            # os campos de edição sem adivinhar tipo nem lista de opções.
            lig_schema = montar_schema(DB_LIGACOES, marcar_sensiveis=True)

            ligacoes = []
            for r in lig_rows:
                props = r.get("properties") or {}
                obra_ids, obra_txt = [], None
                for nome, prop in props.items():
                    # CORRIGIDO: era startswith("OBRA"), e a coluna de relação
                    # nesta base chama "Vínculo Obra" — nunca casava, então
                    # obraIds saía SEMPRE vazio e o vendas.html acabava sempre
                    # no plano B (casar pelo texto do título). Agora basta
                    # conter "OBRA" no nome.
                    if prop.get("type") == "relation" and "OBRA" in norm(nome):
                        obra_ids = [x.get("id") for x in (prop.get("relation") or [])]
                    if prop.get("type") == "title":
                        obra_txt = valor(prop)
                item = {
                    # id da página: é o que o site manda pro Apps Script na hora
                    # de escrever (e de pedir o valor sensível sob demanda).
                    "id": r.get("id"),
                    "obraIds": obra_ids,
                    "obra": obra_txt,
                    # uc/concessionaria/status ficam duplicados aqui de
                    # propósito: o vendas.html já os consome em
                    # ligacoesDaObra(). Tirar daqui quebraria a aba de Vendas
                    # sem nenhum aviso.
                    "uc": None, "concessionaria": None, "status": None,
                    # todas as colunas NÃO sensíveis, pelo nome exato do Notion
                    "v": {},
                    # colunas sensíveis: só "tem valor sim/não". O dist/ é
                    # servido pelo GitHub Pages sem login nenhum, então CPF/CNPJ
                    # e data de nascimento não entram aqui — o site pede sob
                    # demanda ao Apps Script quando o usuário logado abre a linha.
                    "sens": {},
                }
                for nome, prop in props.items():
                    n = norm(nome)
                    v = valor(prop)
                    if eh_sensivel(nome) or (OCULTAR_ANEXOS and prop.get("type") == "files"):
                        # Anexo publica a QUANTIDADE (o site mostra "2 arq." e
                        # decide se cobra a NF do medidor); o resto publica só
                        # sim/não, que é o bastante pra mostrar "•••".
                        item["sens"][nome] = (len(v or []) if prop.get("type") == "files" else bool(v))
                    else:
                        item["v"][nome] = v
                    if n == "UC":
                        item["uc"] = v
                    elif n.startswith("CONCESSIONARIA"):
                        item["concessionaria"] = v
                    elif n == "STATUS":
                        item["status"] = v
                # linha sem nenhuma âncora não serve pra nada no site
                if item["obraIds"] or item["obra"]:
                    ligacoes.append(item)
            gravar("ligacoes.json", {
                "ok": True, "total": len(ligacoes), "ligacoes": ligacoes,
                "schema": lig_schema, "titulo": "OBRA", "updated_at": agora,
            })
            print("  " + str(len(ligacoes)) + " ligações publicadas.", flush=True)
    else:
        gravar("ligacoes.json", {"ok": False, "ligacoes": [], "updated_at": agora})

    # METAS: só ANO e META DE CASAS por enquanto (mesmos campos que o antigo
    # portal_() do Code.gs já lia). Metas mensais por tipo/proprietário
    # (cs_rua_morais etc., como no EXEMPLO_METAS) ficam de fora até
    # confirmar o nome exato dessas colunas no Notion.
    metas_por_ano = {}
    if DB_METAS:
        print("Lendo METAS…", flush=True)
        cm = montar_schema(DB_METAS)
        cmn = [(c["nome"], norm(c["nome"])) for c in cm]
        c_ano = achar(cmn, "ANO")
        c_metac = achar(cmn, "META DE CASAS", "META CASAS")
        print(f"  colunas: ano={c_ano!r} meta_casas={c_metac!r}", flush=True)
        for p in ler_banco(DB_METAS, "METAS"):
            props = p.get("properties") or {}
            ano_v = valor(props[c_ano]) if c_ano and c_ano in props else None
            try:
                ano_i = int(str(ano_v).strip())
            except (TypeError, ValueError):
                continue
            meta_v = valor(props[c_metac]) if c_metac and c_metac in props else None
            metas_por_ano[ano_i] = meta_v

    # ---- portal.json: KPIs do Dashboard (Portal Central) ----------------
    # É o que faltava publicar (item 1: dashboard nunca atualizava porque
    # dist/portal.json não existia e o site sempre caía no cache antigo).
    print("Calculando portal.json…", flush=True)
    ano_atual = int(time.strftime("%Y", time.gmtime()))

    def cota_m(d):
        c = d.get("cota_empresa")
        return 1.0 if c is None else float(c)

    def trimestre_de(data_str):
        """Trimestre FIXO do calendário (Jan-Mar=1, Abr-Jun=2, Jul-Set=3, Out-Dez=4).
        Pedido item 6 (rodada 2): 'dividindo o ano em 4 trimestres fixos' — não é
        janela móvel (isso era do CONTROLES-INTERNOS, sistema diferente)."""
        mes = int(str(data_str)[5:7])
        return (mes - 1) // 3 + 1

    # Casas Vendidas (ano vigente) — não mudou de lógica, só reescrito em Python
    casas_vend, vgv, meses_v, trimestres_v = 0, 0.0, set(), set()
    for v in vendas:
        val = v["valores"]
        dv = getV_py(val, "DATA DA VENDA")
        if dv and str(dv)[:4] == str(ano_atual):
            casas_vend += 1
            meses_v.add(str(dv)[:7])
            trimestres_v.add(trimestre_de(dv))
            vlr = getV_py(val, "VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)")
            if isinstance(vlr, (int, float)):
                vgv += vlr
    n_meses_v = len(meses_v) or 1
    n_trim_v = len(trimestres_v) or 1

    # Início de Obras — CORREÇÃO item 2: soma n_casas, não conta lotes
    casas_inic_m, casas_inic_i, meses_o, trimestres_o = 0.0, 0.0, set(), set()
    for d in docs_full:
        oi = norm(d.get("obra_iniciada") or "")
        di = d.get("data_inicio_obra")
        if oi in ("SIM", "SIM SEM PRAZO") and di and str(di)[:4] == str(ano_atual):
            n = float(d.get("n_casas") or 1)
            cm = cota_m(d)
            casas_inic_m += n * cm
            casas_inic_i += n * (1 - cm)
            meses_o.add(str(di)[:7])
            trimestres_o.add(trimestre_de(di))
    casas_inic_total = casas_inic_m + casas_inic_i
    n_meses_o = len(meses_o) or 1
    n_trim_o = len(trimestres_o) or 1
    meta_casas = metas_por_ano.get(ano_atual)

    # Lotes Comprados — mantém a contagem por LOTE (não por casa, isso já
    # estava certo), só adiciona a divisão Morais/Investidor + a meta (item 3)
    lotes_m, lotes_i = 0, 0
    for d in docs_full:
        da = d.get("data_aquisicao_lote")
        if da and str(da)[:4] == str(ano_atual):
            cm = cota_m(d)
            if cm > 0:
                lotes_m += 1
            if cm < 1:
                lotes_i += 1
    lotes_total = lotes_m + lotes_i

    # ---- SÉRIES MENSAIS POR ANO (gráficos de evolução do dashboard) -----
    # Um vetor de 12 posições (Jan..Dez) por ano, para cada indicador. É o que
    # alimenta os gráficos ocultos do index.html e o seletor de ano.
    # Calculado AQUI e não no navegador de propósito: o vendas.json publicado
    # é podado (colunas sensíveis fora), e o documentos.json é grande — varrer
    # tudo no celular a cada abertura da tela custaria caro à toa.
    def _serie_nova():
        return [0.0] * 12

    serie_vendas, serie_vgv, serie_obras, serie_lotes = {}, {}, {}, {}

    def _acumular(dest, data_str, quanto):
        """Soma `quanto` no mês/ano de data_str ('yyyy-mm-dd'). Ignora data
        malformada em vez de derrubar o build inteiro por causa de uma linha."""
        try:
            ano_i = int(str(data_str)[:4])
            mes_i = int(str(data_str)[5:7])
        except (TypeError, ValueError):
            return
        if not (1 <= mes_i <= 12) or not (2000 <= ano_i <= 2100):
            return
        dest.setdefault(ano_i, _serie_nova())[mes_i - 1] += quanto

    for v in vendas:
        val = v["valores"]
        dv = getV_py(val, "DATA DA VENDA")
        if not dv:
            continue
        _acumular(serie_vendas, dv, 1)
        vlr = getV_py(val, "VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)")
        if isinstance(vlr, (int, float)):
            _acumular(serie_vgv, dv, float(vlr))

    for d in docs_full:
        oi = norm(d.get("obra_iniciada") or "")
        di = d.get("data_inicio_obra")
        if oi in ("SIM", "SIM SEM PRAZO") and di:
            _acumular(serie_obras, di, float(d.get("n_casas") or 1))
        da = d.get("data_aquisicao_lote")
        if da:
            _acumular(serie_lotes, da, 1)

    def _arredondar(serie):
        return {str(a): [round(x, 2) for x in vet] for a, vet in sorted(serie.items())}

    anos_disponiveis = sorted(
        set(serie_vendas) | set(serie_obras) | set(serie_lotes) | set(metas_por_ano)
    )

    # ---- recortes do ANO VIGENTE ---------------------------------------
    # mês/trimestre corrente pela hora de Brasília (o runner do GitHub roda em
    # UTC; nos primeiros dias do mês, à noite, UTC já virou e São Paulo não).
    mes_atual = int(time.strftime("%m", time.localtime(time.time() - 3 * 3600)))
    tri_atual = (mes_atual - 1) // 3 + 1
    mes_ini_tri = (tri_atual - 1) * 3          # índice 0-based do 1º mês do trimestre

    def _recorte(serie, ano):
        """Números do ano pedido: vetor mensal, mês corrente, mês anterior e
        total do trimestre corrente."""
        vet = serie.get(ano) or _serie_nova()
        return {
            "mensal": [round(x, 2) for x in vet],
            "mesCorrente": round(vet[mes_atual - 1], 2),
            "mesAnterior": round(vet[mes_atual - 2], 2) if mes_atual > 1 else 0,
            "trimestreTotal": round(sum(vet[mes_ini_tri:mes_ini_tri + 3]), 2),
        }

    rv = _recorte(serie_vendas, ano_atual)
    ro = _recorte(serie_obras, ano_atual)
    rl = _recorte(serie_lotes, ano_atual)

    # "Média por mês no ano" = total ÷ MESES DECORRIDOS, não ÷ meses que
    # tiveram movimento. Contar só os meses com venda escondia os meses zerados
    # e inflava a média — um ano com 10 casas em 2 meses aparecia como média 5,
    # quando a média real do ano até aqui é bem menor. É essa média que dá pra
    # comparar de igual pra igual com a meta mensal (meta do ano ÷ 12).
    meses_decorridos = mes_atual
    meta_anterior = metas_por_ano.get(ano_atual - 1)

    def _metas(meta):
        if not meta:
            return {"meta": meta, "metaMes": None, "metaTrimestre": None}
        return {"meta": meta, "metaMes": meta / 12.0, "metaTrimestre": meta / 4.0}

    portal = {
        "ok": True,
        "ano": ano_atual,
        "mesAtual": mes_atual,
        "trimestreAtual": tri_atual,
        "mesesDecorridos": meses_decorridos,
        # metas por ano, pro front escolher (venda de casas usa a do ano
        # anterior no analise.html — ver META_VENDAS_ANO_ANTERIOR no index.html)
        "metas": {str(a): m for a, m in sorted(metas_por_ano.items()) if m},
        "anos": anos_disponiveis,
        "series": {
            "vendas": _arredondar(serie_vendas),
            "vgv": _arredondar(serie_vgv),
            "obras": _arredondar(serie_obras),
            "lotes": _arredondar(serie_lotes),
        },
        "vendaCasas": dict({
            "total": casas_vend, "vgv": vgv,
            "mediaMes": casas_vend / meses_decorridos, "meses": meses_decorridos,
            "mesesComVenda": n_meses_v,
            # média do trimestre CORRENTE ÷ 3 meses (combinado: /3, não /4) —
            # comparável direto com a meta mensal
            "mediaTrimestre": rv["trimestreTotal"] / 3.0,
            "trimestreTotal": rv["trimestreTotal"], "trimestres": n_trim_v,
            "mesCorrente": rv["mesCorrente"], "mesAnterior": rv["mesAnterior"],
            "ticket": (vgv / casas_vend) if casas_vend else 0,
            "metaAnoAnterior": meta_anterior,
        }, **_metas(meta_casas)),
        "inicioObras": dict({
            "iniciadas": round(casas_inic_total, 2),
            "iniciadasMorais": round(casas_inic_m, 2),
            "iniciadasInvestidores": round(casas_inic_i, 2),
            "mediaMes": casas_inic_total / meses_decorridos, "meses": meses_decorridos,
            "mesesComObra": n_meses_o,
            "mediaTrimestre": ro["trimestreTotal"] / 3.0,
            "trimestreTotal": ro["trimestreTotal"], "trimestres": n_trim_o,
            "mesCorrente": ro["mesCorrente"], "mesAnterior": ro["mesAnterior"],
            "pct": (casas_inic_total / meta_casas) if meta_casas else None,
        }, **_metas(meta_casas)),
        # LOTES COMPRADOS fica SEM meta (confirmado): não existe coluna de meta
        # de lotes no banco METAS, e usar a meta de casas como aproximação
        # produziria um percentual que não quer dizer nada.
        "lotes": {
            "total": lotes_total, "morais": lotes_m, "investidores": lotes_i,
            "mediaMes": lotes_total / meses_decorridos, "meses": meses_decorridos,
            "mediaTrimestre": rl["trimestreTotal"] / 3.0,
            "trimestreTotal": rl["trimestreTotal"],
            "mesCorrente": rl["mesCorrente"], "mesAnterior": rl["mesAnterior"],
            "meta": None, "metaMes": None, "metaTrimestre": None,
        },
        "updated_at": agora,
    }
    gravar("portal.json", portal)
    print(f"  portal.json: mes={mes_atual} tri={tri_atual} "
          f"anos com série={anos_disponiveis}", flush=True)

    # ---- data_vendas.json: recorte achatado do painel do Gestor ----------
    # A página casas-vendidas.html espera nomes em snake_case e uma lista só.
    # "clientes" vai como BOOLEANO: a página só usa o campo pra saber se a casa
    # foi vendida (x.clientes && x.data_venda) e nunca exibe o nome — então dá
    # pra atender sem publicar dado pessoal num arquivo que é público.
    def campo(v, *frags):
        for frag in frags:
            alvo = norm(frag)
            for k in v:
                if norm(k) == alvo:
                    return v[k]
        for frag in frags:
            alvo = norm(frag)
            for k in v:
                if alvo in norm(k):
                    return v[k]
        return None

    dv = []
    for reg in vendas:
        v = reg["valores"]
        sens = reg.get("sens") or {}
        # a coluna CLIENTES não é publicada; o resumo "sens" diz se está preenchida
        vendida = any(norm(k).startswith("CLIENTE") and sens[k] for k in sens)
        dv.append({
            "endereco": campo(v, "ENDEREÇO"),
            "casa": campo(v, "CASA"),
            "cidade": campo(v, "CIDADE"),
            "setor": campo(v, "SETOR"),
            "clientes": bool(vendida),
            "data_venda": campo(v, "DATA DA VENDA"),
            "valor_na_mao": campo(v, "VALOR NA MÃO"),
            "valor_venda_contrato": campo(v, "VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)", "VALOR DE COMPRA E VENDA"),
            "comissao": campo(v, "COMISSÃO"),
            "corretor": campo(v, "CORRETOR"),
            "imobiliaria": campo(v, "IMOBILIÁRIA"),
            "correspondente": campo(v, "CORRESPONDENTE"),
        })
    gravar("data_vendas.json", {
        "ok": True,
        "vendas": dv,
        "documentos": docs_full,
        "metas": [{"ano": a, "meta_casas": m} for a, m in sorted(metas_por_ano.items())],
        "updated_at": agora,
    })
    print("  data_vendas.json: " + str(len(dv)) + " linhas ("
          + str(sum(1 for x in dv if x["clientes"])) + " vendidas).", flush=True)

    gravar("updated.json", {"updated_at": agora})
    print(f"OK — {len(vendas)} vendas, {len(docs_idx)} documentos.", flush=True)


if __name__ == "__main__":
    sys.exit(main())
