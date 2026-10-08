#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
robo_mc_obras.py — PORTAL-MORAIS · cria no Mais Controle as obras marcadas "Criar"

Quem entra na fila: obras da (EMP) Projeto 2.0 com MAIS CONTROLE = "Criar"
(toda obra nova do portal nasce assim; as antigas entram quando alguém clica
"Criar" na aba Alertas). Obra que já existe no MC (pela aba Obras da planilha
do ERP) só é marcada "Criada", sem abrir formulário.

Para cada uma: Obras → Minhas Obras → "+ Nova Obra" e preenche
  Nome da obra        = endereço da obra (padrão RUA QD XX LT XX)
  Tipo da obra        = "Casa" / "2 casas" / "3 casas" / "4 casas" (pelo Nº DE CASAS)
  Dados gerais        : Área total (ÁREA CONSTRUÍDA AVERBADA), Responsável técnico
                        (ENGENHEIRO RT), Responsável da obra (Responsável Pela Obra)
  Dados do cliente    : Cliente = Proprietário (tem que existir no MC — por isso
                        o robô de clientes roda antes)
e clica "Salvar Obra". Depois confere na lista e marca "Criada" no Notion.
Sem APLICAR=1: preenche, tira o print e FECHA sem salvar.
"""

import sys

from playwright.sync_api import sync_playwright

import re
from datetime import datetime, timedelta, timezone

from robo_mc_comum import N, foto, abrir, login, ir_menu, clicar_texto, APLICAR, MC_URL
from fetch_vendas import ler_banco, api
from fetch_obras import obras_no_mc, padronizar_endereco
import robo_mc_contas as rc  # reaproveita _achar_filho_banco/txt/pega do banco de contas (sem playwright no topo dele)

ID_OBRAS = "306c5ab532d3812fa14fe9a281510128"
TIPOS = {1: "Casa", 2: "2 casas", 3: "3 casas", 4: "4 casas", 5: "5 casas"}
TIPO_PADRAO = "Genérico"     # sem Nº DE CASAS ainda: entra como genérico

# "Visível para": ficam só os engenheiros de execução (e o estagiário deles)
# que são os responsáveis da obra. Os demais são desmarcados.
# 08/10/26 — nomes EXATOS como aparecem na lista "Visível para" do MC. Antes
# era só "Guilherme": a lista tem "Guilherme Filipe" ANTES de "Guilherme
# Gouveia" (e "Felipe Guilherme Berçan"), e o robô desmarcava o errado — o
# Gouveia continuava vendo as obras do João Marcos.
EQUIPES = {
    "GUILHERME GOUVEIA": ["Guilherme Gouveia", "Alefe"],
    "JOAO MARCOS VIEIRA CABRAL MENEZES": ["João Marcos", "Ian"],
    "ISAAC NATAN": ["Isaac Natan", "Icaro"],
}

STATUS_OBRA = "Em andamento"       # 08/10/26: obra nova nasce Em andamento (o MC sugere "Em orçamento")

# 08/10/26 — Endereço completo no MC: "Rua TB 19, s/n, Terrabela Cerrado II,
# 75264264, Senador Canedo - GO". Bairro oficial de cada setor do Notion (o
# nome que o Correios/ViaCEP e as obras antigas do MC usam). O CEP vem do
# ViaCEP pela rua; sem CEP achado, fica só o bairro (e o log avisa).
SETORES_END = {
    "TERRABELA CERRADO": "Terrabela Cerrado II",
    "RAVENA": "Residencial Ravena",
    "SOLAR VILLE": "Residencial Solar Ville",
    "PQ DOS BURITIS": "Residencial Parque dos Buritis",
    "ACROPOLE": "Residencial Acrópole II",
}


def txt(p):
    t = (p or {}).get("type")
    v = (p or {}).get(t)
    if t == "title" or t == "rich_text":
        return "".join(x.get("plain_text", "") for x in v or [])
    if t in ("select", "status"):
        return (v or {}).get("name") or ""
    if t == "multi_select":
        return ", ".join(x.get("name") or "" for x in v or [])
    if t == "people":
        return ", ".join(x.get("name") or "" for x in v or [])
    if t == "number":
        return v
    if t == "formula" and v:
        return v.get(v.get("type")) or ""
    return ""


def pega(pr, nome):
    for k, v in (pr or {}).items():
        if N(k) == N(nome):
            return v
    return None


COL_RELACAO_CONTA = "CONTA BANCÁRIA"   # relação (desenho antigo, nunca chegou a produção)
COL_CONTA = "CONTA"                    # 23/09/26: SELEÇÃO com o nome da conta do ERP
CONTA_PENDENTE = {"CRIAR CONTA", "DUVIDA"}   # opções que dizem "ainda não sei a conta"


def ids_relacionados(p):
    """`txt()` (acima) não lê `relation` — só title/rich_text/select/status.
    Devolve TODOS os ids da relação (lista, possivelmente vazia)."""
    if (p or {}).get("type") != "relation":
        return []
    return [str(i.get("id") or "") for i in (p.get("relation") or []) if i.get("id")]


def id_relacionado(p):
    """Primeiro id da relação, ou ''. Só para leitura rápida — quem decide a
    conta da obra é `resolver_conta`, que trata 2+ contas como erro."""
    ids = ids_relacionados(p)
    return ids[0] if ids else ""


# 08/10/26 — "PESSOA FISICA" no Notion = a conta do MC com esse nome (antes
# ficava em branco de propósito).
CONTA_PESSOA_FISICA = "PESSOA FISICA - APENAS LANÇAMENTO"


def nome_conta_texto(valor):
    """Função PURA: texto da coluna CONTA como nome de conta do MC."""
    valor = str(valor or "").strip()
    return CONTA_PESSOA_FISICA if N(valor) == "PESSOA FISICA" else valor


def resolver_conta(prop_relacao, mapa_contas):
    """Função PURA: a partir da propriedade CONTA BANCÁRIA da obra e do mapa
    id->{"nome","numero"} do banco de contas, devolve
    (conta_exata, conta_numero, nao_resolvida).

    - sem relação -> ("", "", False): nada pedido pela relação (vale o texto
      antigo da coluna CONTA, se houver);
    - UMA página relacionada que está no mapa com nome -> (nome, numero, False);
    - página relacionada fora do mapa (banco renomeado/duplicado, título
      vazio) OU mais de uma conta relacionada -> ("", "", True): a conta FOI
      pedida e não dá para saber qual — a obra não é criada nem marcada
      "Criada" (nunca cai no texto livre, nunca escolhe uma ao acaso)."""
    if (prop_relacao or {}).get("type") != "relation":
        # 23/09/26 — coluna CONTA como SELEÇÃO: o valor É o nome da opção,
        # que o robô de contas mantém igual ao nome da conta no ERP.
        valor = nome_conta_texto(txt(prop_relacao))
        if not valor:
            return "", "", False
        if N(valor) in CONTA_PENDENTE:
            return "", "", True           # CRIAR CONTA / DÚVIDA: não escolhe nenhuma
        info = (mapa_contas or {}).get("opcao:" + N(valor)) or {}
        if info.get("nome"):
            return info["nome"], str(info.get("numero") or "").strip(), False
        return "", "", False              # fora do mapa: cai no caminho do texto (busca pelo nome)
    ids = ids_relacionados(prop_relacao)
    if not ids:
        return "", "", False
    if len(ids) > 1:
        return "", "", True
    info = (mapa_contas or {}).get(ids[0]) or {}
    nome = str(info.get("nome") or "").strip()
    if not nome:
        return "", "", True
    return nome, str(info.get("numero") or "").strip(), False


def mapa_contas_por_id():
    """id da página do banco CONTAS BANCÁRIAS -> {"nome": nome exato da conta
    (título "Conta", que dá nome à opção na lista do MC), "numero": coluna
    "Número" (usada para conferir a opção escolhida)}. Lê o banco UMA VEZ
    por rodada (fila_de_obras/fila_atualizar reaproveitam o mapa) e acha o
    banco pelos blocos do pai — mesma função que robo_mc_contas usa
    (`_achar_filho_banco`), para não duplicar a lógica de índice atrasado.
    Banco ainda não existe (robo_mc_contas nunca aplicou) -> {}.
    23/09/26: também indexa por "opcao:<nome da opção>" (coluna "Nome na
    obra"), que é como a coluna CONTA das obras aponta para a conta; e usa o
    id fixo CONTAS_DB_ID quando existir."""
    db_id = rc.CONTAS_DB_ID
    if not db_id:
        obras = api("GET", f"/databases/{ID_OBRAS}")
        pai = (obras.get("parent") or {}).get("page_id")
        if not pai:
            return {}
        db_id = rc._achar_filho_banco(pai)
    if not db_id:
        return {}
    mapa = {}
    for pg in ler_banco(db_id, "CONTAS BANCÁRIAS"):
        pr = pg.get("properties") or {}
        nome = rc.txt(rc.pega(pr, "Conta"))
        if nome:
            info = {"nome": nome, "numero": rc.txt(rc.pega(pr, "Número")) or ""}
            mapa[pg["id"]] = info
            opcao = rc.txt(rc.pega(pr, rc.COL_OPCAO)) or rc.nome_opcao(nome)
            mapa["opcao:" + N(opcao)] = info
    return mapa


def prop_conta(pr):
    """A propriedade que diz a conta da obra: a relação antiga, se tiver
    alguma conta ligada; senão a coluna CONTA (seleção)."""
    rel = pega(pr, COL_RELACAO_CONTA)
    return rel if ids_relacionados(rel) else pega(pr, COL_CONTA)


def fila_de_obras(mapa_contas=None):
    mapa_contas = mapa_contas or {}
    fila = []
    for pg in ler_banco(ID_OBRAS, "OBRAS"):
        pr = pg.get("properties") or {}
        if N(txt(pega(pr, "MAIS CONTROLE"))) != "CRIAR":
            continue
        a1, a2 = txt(pega(pr, "ÁREA CONSTRUÍDA AVERBADA")), txt(pega(pr, "ÁREA PÓS HABITE-SE"))
        conta_exata, conta_numero, nao_resolvida = resolver_conta(prop_conta(pr), mapa_contas)
        fila.append({
            "id": pg["id"],
            "titulo": padronizar_endereco(txt(pega(pr, "Projeto"))),
            "casas": txt(pega(pr, "Nº DE CASAS")),
            "area": ((a1 or 0) + (a2 or 0)) or None,      # área do MC = averbada + pós habite-se
            "rt": txt(pega(pr, "ENGENHEIRO RT")),
            "resp": txt(pega(pr, "Responsável Pela Obra")),
            "cliente": txt(pega(pr, "Proprietário")),
            "cidade": txt(pega(pr, "Cidade")).split(",")[0].strip(),
            "setor": txt(pega(pr, "SETOR")),
            "conta": nome_conta_texto(txt(pega(pr, "CONTA"))),
            "mc_erro": txt(pega(pr, COL_MC_ERRO)) or "",
            "conta_exata": conta_exata,
            "conta_numero": conta_numero,
            "conta_nao_resolvida": nao_resolvida,
        })
    return fila


def marcar_criada(pid):
    api("PATCH", f"/pages/{pid}", {"properties": {"MAIS CONTROLE": {"select": {"name": "Criada"}}}})


# ---------------------------------------------------------------- formulário
# Seletores conferidos direto no formulário do MC (set/26): cada campo tem um
# name próprio do react-hook-form, e o Cliente é o #participants (o rótulo
# "Cliente" é for=participants). Nada de procurar por texto na tela.
CAMPO = {
    "nome": "input[name=name]",
    "tipo": "input[name=workType]",
    "status": "input[name=status]",
    "area": "input[name=estimatedArea]",
    "rt": "input[name='responsible.technicalResponsible']",
    "resp": "input[name='responsible.workResponsible']",
    "cliente": "#participants",
    "logradouro": "input[name='address.address']",
    "complemento": "input[name='address.complement']",
    "quem_paga": "input[name=defaultWhoPays]",
    "conta": "#select-single-account-visible",
}


JS_SET = """(el, v) => {
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  s.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}"""


def escrever(page, sel, valor):
    """Escreve num campo do formulário e CONFERE se o valor ficou.
    Primeiro digitando de verdade (é o que o react-hook-form registra); se o
    campo continuar vazio, insiste pelo DOM. O clique comum do Playwright não
    serve: as camadas do Material UI cobrem o campo e o clique fica esperando."""
    el = page.locator(sel).first
    el.scroll_into_view_if_needed()
    try:
        el.evaluate("e => e.focus()")
        page.keyboard.press("Control+a")
        page.keyboard.type(str(valor), delay=25)
        page.wait_for_timeout(300)
    except Exception:
        pass
    if not (el.input_value() or "").strip():
        el.evaluate(JS_SET, str(valor))
        page.wait_for_timeout(300)
    ficou = (el.input_value() or "").strip()
    if not ficou:
        print(f"  ! campo {sel} continuou vazio", flush=True)
    return ficou


# o que pode vir logo depois do nome da conta quando a opção do combo mostra
# MAIS que o nome (ex. "NOME - Conta corrente: 1234-5", "NOME (BANCO)"):
# só separador — nunca outra palavra ("NOME SPE 2" é OUTRA conta).
_SEPARADORES_SUFIXO = (" -", " –", " (")
_GRUPO_DIGITOS = re.compile(r"\d+(?:-\d+)?")


def _numero_bate(texto, numero):
    """Se o banco de contas tem o número e o texto mostra dígitos, os dígitos
    do número têm de aparecer num grupo de dígitos do texto."""
    num = "".join(c for c in str(numero or "") if c.isdigit())
    if not num:
        return True
    grupos = ["".join(c for c in g if c.isdigit()) for g in _GRUPO_DIGITOS.findall(str(texto or ""))]
    if not grupos:
        return True
    return any(num in g for g in grupos)


def escolha_por_prefixo(textos, alvo, numero=""):
    """Função PURA (sem Playwright): escolhe, entre `textos`, a ÚNICA opção
    que é o nome pedido (`alvo`) — igual, ou igual seguido de um SEPARADOR
    (" -", " –", " (") e mais texto (a opção do combo pode mostrar número/
    banco depois do nome). Nunca o contrário (opção mais curta que o nome:
    "EMPRESA MODELO" não serve para "EMPRESA MODELO SPE 2"), nunca o nome
    seguido de outra palavra ("EMPRESA MODELO SPE 2" não serve para
    "EMPRESA MODELO"). Quando a opção tem texto a mais e `numero` (coluna
    "Número" do banco de contas) vem preenchido, o texto a mais que mostra
    dígitos tem de mostrar os dígitos desse número. Exige EXATAMENTE UMA
    candidata: com 0 ou 2+, devolve None (falha sem chutar). Devolve o
    ÍNDICE da opção escolhida, ou None."""
    alvo_n = N(alvo)
    if not alvo_n:
        return None
    candidatos = []
    for i, t in enumerate(textos):
        t_n = N(t)
        if not t_n:
            # opção em branco/placeholder do combo nunca é candidata
            continue
        if t_n == alvo_n:
            candidatos.append(i)
            continue
        resto = t_n[len(alvo_n):]
        if t_n.startswith(alvo_n) and resto.startswith(_SEPARADORES_SUFIXO) and _numero_bate(resto, numero):
            candidatos.append(i)
    return candidatos[0] if len(candidatos) == 1 else None


def escolher_na_lista(page, campo_sel, texto_busca, alvo=None, exato=False, prefixo=False, sigilo=False, numero="",
                      criterio=None):
    """Abre a lista do campo, digita (quando o campo aceita busca) e clica na
    opção. Devolve o texto da opção escolhida.

    `prefixo=True`: a escolha é TODA de `escolha_por_prefixo` (igualdade ou
    nome + separador, conferindo `numero`; exige uma única candidata — nunca
    "a primeira igual", nunca o "melhor parecido" do `exato=False`).
    `sigilo=True`: a mensagem de erro NÃO leva `alvo` nem as opções vistas —
    só a contagem. É para o campo de conta bancária: nome real de conta não
    pode ir para o log público do Actions (repo público)."""
    campo = page.locator(campo_sel).first
    campo.scroll_into_view_if_needed()
    opcoes = page.locator("[role=listbox] [role=option], [role=listbox] li")
    # abre a lista: no campo e, se não abrir, no quadro em volta dele
    for alvo_clique in [campo, campo.locator("xpath=.."), campo.locator("xpath=../..")]:
        try:
            alvo_clique.click(force=True, timeout=6000)
        except Exception:
            continue
        page.wait_for_timeout(700)
        if texto_busca:
            campo.evaluate(JS_SET, texto_busca)    # busca (autocompletes)
            page.wait_for_timeout(1600)
        if opcoes.count():
            break
    n = opcoes.count()
    if not n:
        raise RuntimeError("a lista não abriu")
    alvo = alvo or texto_busca or ""

    def decidir(textos):
        if criterio:
            return criterio(textos)
        if prefixo:
            return escolha_por_prefixo(textos, alvo, numero)
        for i, t in enumerate(textos):
            if N(t) == N(alvo):
                return i
        return None

    textos = [(opcoes.nth(i).inner_text() or "").strip() for i in range(n)]
    escolha = decidir(textos)
    if escolha is None:
        # 08/10/26: alguns combos (conta bancária) NÃO filtram pelo texto e só
        # carregam 30 opções por vez — o resto vem rolando a lista. Sem isso,
        # conta depois da letra M ("PESSOA FISICA - APENAS LANÇAMENTO",
        # "TERRA BELA ...") nunca aparecia.
        mais = carregar_mais_opcoes(page, opcoes)
        if mais > n:
            n = mais
            textos = [(opcoes.nth(i).inner_text() or "").strip() for i in range(n)]
            escolha = decidir(textos)
    if escolha is None and not prefixo and not exato and not criterio:
        # melhor parecido: mais palavras em comum (o MC às vezes guarda o nome
        # sem o "LTDA" que existe no cadastro do Notion)
        pal = set(N(alvo).split())
        notas = [(len(pal & set(N(t).split())), i) for i, t in enumerate(textos)]
        notas.sort(reverse=True)
        if notas and notas[0][0] >= 2:
            escolha = notas[0][1]
    if escolha is None:
        if sigilo:
            raise RuntimeError(f"não apareceu na lista ({len(textos)} opções vistas)")
        raise RuntimeError(f"'{alvo}' não apareceu na lista (vi: {textos[:6]})")
    alvo_op = opcoes.nth(escolha)
    try:
        alvo_op.scroll_into_view_if_needed(timeout=3000)
        alvo_op.click(timeout=6000)
    except Exception:
        alvo_op.evaluate("e => e.click()")
    page.wait_for_timeout(600)
    return textos[escolha]


def carregar_mais_opcoes(page, opcoes, voltas=40):
    """Rola a lista aberta até o fim, várias vezes, até parar de crescer.
    Devolve quantas opções ficaram carregadas."""
    antes = opcoes.count()
    parado = 0
    for _ in range(voltas):
        try:
            page.evaluate("""() => { const lb = document.querySelector('[role=listbox]');
                if (lb) { lb.scrollTop = lb.scrollHeight; lb.dispatchEvent(new Event('scroll', {bubbles: true})); } }""")
        except Exception:
            break
        page.wait_for_timeout(900)
        agora = opcoes.count()
        if agora == antes:
            parado += 1
            if parado >= 3:
                break
        else:
            parado = 0
        antes = agora
    return antes


def escolha_cliente(textos, nome):
    """Função PURA: índice da ÚNICA opção que é o cliente `nome` (igual,
    ignorando caixa/acento/LTDA). 08/10/26: antes caía no "mais parecido" e,
    com vários clientes MORAIS ... SPE, escolhia a SPE errada."""
    iguais = [i for i, t in enumerate(textos) if mesmo_nome(nome, t)]
    return iguais[0] if len(iguais) == 1 else None


def escolha_nome_fantasia(nomes, nome):
    """Função PURA: entre os nomes que a busca de Contatos > Clientes do MC
    devolveu (a coluna Nome = nome FANTASIA), qual é o cliente do Notion.
    08/10/26: o Notion guarda a RAZÃO SOCIAL ("... SPE I LTDA") e o combo da
    obra mostra o nome fantasia ("... SPE"); a busca do MC acha pela razão
    social e pelo CNPJ. Igual (ignorando LTDA/acento) > resultado único >
    nada (nunca chuta entre vários)."""
    nomes = [str(x or "").strip() for x in nomes if str(x or "").strip()]
    iguais = [x for x in nomes if mesmo_nome(nome, x)]
    if len(iguais) == 1:
        return iguais[0]
    if len(nomes) == 1:
        return nomes[0]
    return None


_cache_cliente = {}


def nome_cliente_no_mc(page, nome):
    """Nome do cliente como aparece nos combos do MC (nome fantasia), buscando
    o nome do Notion (razão social) em Contatos > Clientes. Sem achar, devolve
    o próprio nome."""
    nome = (nome or "").strip()
    if not nome:
        return nome
    if N(nome) in _cache_cliente:
        return _cache_cliente[N(nome)]
    achado = nome
    try:
        base = (MC_URL.split("#")[0] or "https://acessar.maiscontroleerp.com.br/").rstrip("/") + "/#/customer"
        page.goto(base)
        page.locator("table tbody tr").first.wait_for(state="visible", timeout=20000)
        busca = page.locator("input[placeholder*='Digite aqui sua busca']").first
        busca.fill(nome)
        page.wait_for_timeout(3000)
        nomes = page.locator("table tbody tr").evaluate_all(
            "rs => rs.map(r => { const td = r.querySelectorAll('td'); return td.length > 1 ? td[1].innerText.trim() : ''; })")
        escolha = escolha_nome_fantasia(nomes, nome)
        if escolha:
            achado = escolha
            if N(escolha) != N(nome):
                print(f"  cliente: '{nome}' no MC é '{escolha}' (nome fantasia)", flush=True)
    except Exception as e:
        print(f"  ! cliente '{nome}': busca em Contatos > Clientes falhou ({str(e)[:80]})", flush=True)
    _cache_cliente[N(nome)] = achado
    return achado


def escolher_cliente(page, nome):
    for busca in (nome[:25], nome[:12]):
        try:
            return escolher_na_lista(page, CAMPO["cliente"], busca, alvo=nome,
                                     criterio=lambda textos: escolha_cliente(textos, nome))
        except Exception as e:
            ultimo = e
    raise RuntimeError(f"cliente '{nome}' não apareceu igual na lista do MC ({str(ultimo)[:80]})")


# ---------------------------------------------------------------- orçamento
# 08/10/26 — toda obra nova ganha um orçamento em Obras > Orçamento, com o
# código "sem orça N" (N = maior "sem orça" que já existe + 1).
_SEM_ORCA = re.compile(r"sem\s+or[cç]a\s*(\d+)", re.I)


def proximo_sem_orca(textos):
    """Função PURA: próximo número a partir dos textos da lista de orçamentos."""
    nums = [int(m.group(1)) for t in textos for m in _SEM_ORCA.finditer(str(t or ""))]
    return (max(nums) + 1) if nums else 1


def _url_orcamentos():
    return (MC_URL.split("#")[0] or "https://acessar.maiscontroleerp.com.br/").rstrip("/") + "/#/estimate"


def _buscar_orcamentos(page, texto):
    """A busca da lista (AngularJS) só filtra com input+change — digitar tecla
    a tecla não filtrava e o robô via só a 1ª página (08/10/26)."""
    busca = page.locator("input[placeholder='Digite aqui sua busca']").first
    busca.wait_for(state="visible", timeout=25000)
    busca.evaluate("""(e, v) => { e.focus(); e.value = v;
        e.dispatchEvent(new Event('input', {bubbles: true}));
        e.dispatchEvent(new Event('change', {bubbles: true})); }""", texto)
    page.wait_for_timeout(3500)
    # rola até o fim para a lista carregar tudo (é lista infinita)
    for _ in range(8):
        page.mouse.wheel(0, 4000)
        page.wait_for_timeout(500)
    return page.locator("table tbody tr").all_inner_texts()


def tem_orcamento(linhas, titulo):
    """Função PURA: alguma linha da lista é desta obra? ('LT 1' não casa 'LT 16')."""
    alvo = re.compile(r"(^|\s)" + re.escape(N(titulo)) + r"(\s|$)")
    return any(alvo.search(N(l)) for l in linhas)


def garantir_orcamento(page, o):
    """Cria o orçamento 'sem orça N' da obra, se ela ainda não tiver nenhum.
    Devolve um texto curto do que aconteceu. Se der erro no meio, recarrega a
    página: um modal aberto que sobra bloqueia os cliques da próxima obra."""
    try:
        return _garantir_orcamento(page, o)
    except Exception:
        try:
            page.keyboard.press("Escape")
            page.reload()
            page.wait_for_timeout(3000)
        except Exception:
            pass
        raise


def _garantir_orcamento(page, o):
    titulo = o["titulo"]
    page.goto(_url_orcamentos())
    linhas = _buscar_orcamentos(page, titulo)
    if tem_orcamento(linhas, titulo):
        return "já tinha orçamento"
    codigo = f"sem orça {proximo_sem_orca(_buscar_orcamentos(page, 'sem orça'))}"
    if not APLICAR:
        return f"criaria '{codigo}'"
    page.locator("a[ng-click*='onClickNew']").first.click()      # o "Novo" da lista (não o do menu)
    modal = page.locator(".modal.in, .modal-dialog").last
    cod = modal.locator("input[ng-model='$ctrl.planning.code']").first
    cod.wait_for(state="visible", timeout=15000)
    # 08/10/26: o MC preenche sozinho o próximo número (123, 124…) logo DEPOIS
    # que o campo aparece — escrever o código aqui era apagado por ele. O
    # código só é escrito no fim, antes do Começar, e conferido.
    for _ in range(20):
        if (cod.input_value() or "").strip():
            break
        page.wait_for_timeout(500)
    # obra
    modal.locator("[ng-model='$ctrl.planning.work'] .select-button").first.click()
    page.wait_for_timeout(600)
    busca = page.locator("input[ng-model='$parent.searchText']:visible").first
    busca.type(titulo, delay=30)
    page.wait_for_timeout(2500)
    itens = page.locator("li.ng-scope:visible")
    alvo = None
    for i in range(min(itens.count(), 30)):
        if N(itens.nth(i).inner_text()) == N(titulo):
            alvo = itens.nth(i)
            break
    if alvo is None:
        modal.locator("button").filter(has_text="Cancelar").first.evaluate("b => b.click()")
        raise RuntimeError("obra não apareceu na lista do orçamento (o MC só lista obra sem orçamento)")
    try:
        alvo.click(timeout=8000)
    except Exception:
        alvo.evaluate("e => e.click()")
    page.wait_for_timeout(1500)
    # cliente (o MC costuma trazer o da obra; se não trouxe, escolhe)
    cli = modal.locator("[ng-model='$ctrl.planning.work.customer'] .select-button").first
    if o.get("cliente") and "SELECIONE" in N(cli.inner_text()):
        cli.click()
        page.wait_for_timeout(600)
        b2 = page.locator("input[ng-model='$parent.searchText']:visible").first
        b2.type(o["cliente"][:25], delay=30)
        page.wait_for_timeout(2500)
        it2 = page.locator("li.ng-scope:visible")
        idx = escolha_cliente([it2.nth(i).inner_text() for i in range(min(it2.count(), 30))], o["cliente"])
        if idx is not None:
            it2.nth(idx).click()
            page.wait_for_timeout(800)
    # status da obra
    try:
        modal.locator("select[ng-model='$ctrl.ngModel']").first.select_option(label="Em Andamento")
    except Exception as e:
        print(f"  ! orçamento — status: {str(e)[:80]}", flush=True)
    # código "sem orça N" — por último, e conferido no campo e no modelo do MC
    if not _escrever_codigo(page, cod, codigo):
        modal.locator("button").filter(has_text="Cancelar").first.evaluate("b => b.click()")
        raise RuntimeError(f"não consegui escrever o código '{codigo}' no orçamento")
    # 08/10/26: o botão é <button type="submit button" title="Começar"
    # class="c-upsert-planning-modal__footer--confirm"> (o type NÃO é "submit").
    # Ele fica desabilitado sem a permissão EDIT_PLANNING do usuário. Espera
    # habilitar e clica pelo DOM.
    bt = modal.locator("button.c-upsert-planning-modal__footer--confirm, button[title='Começar']").first
    bt.wait_for(state="attached", timeout=15000)
    for _ in range(30):
        if not bt.is_disabled():
            break
        page.wait_for_timeout(500)
    if bt.is_disabled():
        modal.locator("button").filter(has_text="Cancelar").first.evaluate("b => b.click()")
        raise RuntimeError("botão Começar desabilitado — o usuário do robô precisa da permissão de editar orçamento (EDIT_PLANNING)")
    print(f"  orçamento: '{codigo}' — obra e cliente escolhidos, clicando em Começar", flush=True)
    bt.evaluate("b => b.click()")
    try:
        modal.wait_for(state="hidden", timeout=30000)
    except Exception:
        pass
    page.wait_for_timeout(3000)
    # o MC abre o orçamento novo; se o título não começa pelo código pedido,
    # corrige pelo lápis "Editar informações do orçamento"
    renomeado = ""
    try:
        cab = page.locator("span[ng-click*='openNewTabTitle']").first
        cab.wait_for(state="visible", timeout=20000)
        if not N(cab.inner_text()).startswith(N(codigo) + " "):
            renomear_orcamento(page, codigo)
            renomeado = " (código corrigido depois de criar)"
    except Exception as e:
        print(f"  ! orçamento: conferência do código na página: {str(e)[:90]}", flush=True)
    # confere na lista
    page.goto(_url_orcamentos())
    linhas = _buscar_orcamentos(page, titulo)
    if tem_orcamento([l for l in linhas if N(codigo) in N(l)], titulo):
        return f"criado '{codigo}'{renomeado}"
    # criou com outro código: acha o da obra e renomeia
    if tem_orcamento(linhas, titulo):
        abrir_orcamento_da_lista(page, titulo)
        renomear_orcamento(page, codigo)
        page.goto(_url_orcamentos())
        linhas = _buscar_orcamentos(page, titulo)
        if tem_orcamento([l for l in linhas if N(codigo) in N(l)], titulo):
            return f"criado '{codigo}' (código corrigido depois de criar)"
    raise RuntimeError(f"cliquei em Começar, mas '{codigo}' não apareceu na lista de orçamentos")


def _escrever_codigo(page, cod, codigo):
    for _ in range(3):
        cod.fill(codigo)
        page.wait_for_timeout(400)
        valor = (cod.input_value() or "").strip()
        try:
            modelo = cod.evaluate("e => { try { return angular.element(e).scope().$ctrl.planning.code || ''; } catch (x) { return null; } }")
        except Exception:
            modelo = None
        if valor == codigo and (not modelo or modelo == codigo):
            return True
        page.wait_for_timeout(800)
    return False


def abrir_orcamento_da_lista(page, titulo):
    """Na lista (já filtrada pela obra), abre o orçamento da obra."""
    alvo = re.compile(r"(^|\s)" + re.escape(N(titulo)) + r"(\s|$)")
    linhas = page.locator("table tbody tr")
    for i in range(linhas.count()):
        if alvo.search(N(linhas.nth(i).inner_text())):
            linhas.nth(i).locator("td").nth(2).click()
            page.locator("span[ng-click*='onEdit']").first.wait_for(state="visible", timeout=20000)
            return
    raise RuntimeError("não achei o orçamento da obra na lista para corrigir o código")


def renomear_orcamento(page, codigo):
    """Na página do orçamento: lápis -> Código do orçamento -> Salvar."""
    page.locator("span[ng-click*='onEdit']").first.click()
    modal = page.locator(".modal.in, .modal-dialog").last
    cod = modal.locator("input[ng-model$='.code']").first
    cod.wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(800)
    if not _escrever_codigo(page, cod, codigo):
        modal.locator("button").filter(has_text="Cancelar").first.evaluate("b => b.click()")
        raise RuntimeError(f"não consegui corrigir o código para '{codigo}'")
    modal.locator("button").filter(has_text=re.compile("Salvar", re.I)).first.evaluate("b => b.click()")
    try:
        modal.wait_for(state="hidden", timeout=20000)
    except Exception:
        pass
    page.wait_for_timeout(1500)
    print(f"  orçamento: código corrigido para '{codigo}'", flush=True)


def abrir_secao(page, titulo):
    """Os blocos de "Dados opcionais" vêm FECHADOS. Enquanto não são abertos,
    os campos existem no HTML mas não recebem o que o robô escreve — foi o que
    fez o cliente, a área e os responsáveis ficarem vazios nas primeiras
    tentativas."""
    try:
        cab = page.get_by_text(titulo, exact=True).last
        cab.scroll_into_view_if_needed()
        cab.click(force=True)
        page.wait_for_timeout(700)
    except Exception as e:
        print(f"  ! não abri a seção '{titulo}': {str(e)[:80]}", flush=True)


def fechar_replicar(page):
    """Ao escolher o cliente, o MC pergunta "Replicar dados do cliente?" numa
    janela que fica por cima e BLOQUEIA o botão Salvar Obra. Respondemos Não:
    o endereço da obra é o nosso, não o do cliente."""
    try:
        page.get_by_text("Replicar dados do cliente", exact=False).first.wait_for(state="visible", timeout=4000)
    except Exception:
        return
    for rot in ["Não", "Nao"]:
        bt = page.locator("button:visible").filter(has_text=re.compile(rf"^\s*{rot}\s*$", re.I))
        if bt.count():
            bt.last.click(force=True)
            page.wait_for_timeout(900)
            print("  janela 'Replicar dados do cliente': respondi Não", flush=True)
            return
    page.keyboard.press("Escape")


def equipe_do_responsavel(resp):
    """Função PURA: (manter, tirar) — nomes da lista "Visível para"."""
    manter = []
    for eng, nomes in EQUIPES.items():
        if resp and (N(eng) in N(resp) or N(resp) in N(eng)):
            manter = nomes
    if not manter:
        return [], []
    tirar = [n for eng, nomes in EQUIPES.items() for n in nomes if n not in manter]
    return manter, tirar


_JS_VISIVEIS = """(args) => {
  const norm = s => (s || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toUpperCase().replace(/\\s+/g, ' ').trim();
  const b = [...document.querySelectorAll('input')].find(i => /usu/i.test(i.placeholder || ''));
  let c = b;
  for (let k = 0; k < 8 && c; k++) { c = c.parentElement; if (c && c.querySelectorAll('input[type=checkbox]').length > 3) break; }
  if (!c) return null;
  const linhas = [...c.querySelectorAll('input[type=checkbox]')].map(x => {
    const r = x.closest('li,label') || x.parentElement;
    return { x, r, nome: (r ? r.innerText : '').trim() };
  });
  // UM clique por chamada: a lista é controlada pelo React e dois cliques
  // seguidos usam o estado velho — o segundo desfazia o primeiro (08/10/26:
  // o Gouveia continuava marcado porque o clique no Ian veio logo depois).
  const mudou = [];
  if (args.aplicar) {
    for (const l of linhas) {
      const n = norm(l.nome);
      const querMarcado = args.manter.includes(n) ? true : (args.tirar.includes(n) ? false : null);
      if (querMarcado === null || l.x.checked === querMarcado) continue;
      (l.r || l.x).click();
      mudou.push((querMarcado ? '+' : '-') + l.nome);
      break;
    }
  }
  return { mudou, estado: linhas.map(l => [l.nome, l.x.checked]) };
}"""


def ajustar_visiveis(page, resp, aplicar=True):
    """Deixa marcados só os usuários da equipe do responsável pela obra e tira
    os das OUTRAS equipes de engenharia (os demais usuários ficam como estão).
    Devolve a lista do que mudou (vazia = já estava certo)."""
    manter, tirar = equipe_do_responsavel(resp)
    if not manter:
        print(f"  Visível para: '{resp or '(vazio)'}' não é engenheiro de execução — deixei como está", flush=True)
        return []
    caixa = page.locator("xpath=//label[@id='select-checkbox-list-label']/following-sibling::div[1]").first
    caixa.click(force=True)
    page.wait_for_timeout(900)
    args = {"manter": [N(x) for x in manter], "tirar": [N(x) for x in tirar], "aplicar": aplicar}
    mudou = []
    for _ in range(12):                      # um clique por vez, esperando o React
        r = page.evaluate(_JS_VISIVEIS, args) or {}
        if not r.get("mudou"):
            break
        mudou += r["mudou"]
        page.wait_for_timeout(600)
    # confere: lê de novo e vê se ficou como deveria
    r2 = page.evaluate(_JS_VISIVEIS, dict(args, aplicar=False)) or {}
    errados = [nome for nome, marcado in (r2.get("estado") or [])
               if (N(nome) in args["manter"] and not marcado) or (N(nome) in args["tirar"] and marcado)]
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    print(f"  Visível para: equipe {manter}; mudou {mudou or 'nada'}" +
          (f" | ! continuam errados: {errados}" if errados else ""), flush=True)
    return mudou


def ajustar_exibir(page):
    """'Exibir obra para': Lançamento e Faturamento ATIVADOS, Compras DESATIVADO.
    Pelo name de cada interruptor (antes ia pela ordem das caixas da tela e
    errava quando havia outra caixa visível)."""
    alvo = {"enabledForPayment": True, "enabledForReceipt": True, "enabledForPurchasing": False}
    rot = {"enabledForPayment": "Lançamento", "enabledForReceipt": "Faturamento", "enabledForPurchasing": "Compras"}
    mudou = []
    for nome, quer in alvo.items():
        cx = page.locator(f"input[type=checkbox][name={nome}]").first
        try:
            if not cx.count():
                print(f"  ! Exibir obra para: não achei '{rot[nome]}'", flush=True)
                continue
            if cx.is_checked() != quer:
                cx.scroll_into_view_if_needed()
                cx.click(force=True)
                page.wait_for_timeout(300)
                mudou.append(f"{rot[nome]} {'ativado' if quer else 'desativado'}")
        except Exception as e:
            print(f"  ! Exibir obra para ({rot[nome]}): {str(e)[:80]}", flush=True)
    return mudou


def status_atual(page):
    try:
        return page.locator(CAMPO["status"]).first.evaluate("""e => {
            const q = e.parentElement.querySelector('[role=combobox], .MuiSelect-select');
            return (q ? q.innerText : '').trim(); }""")
    except Exception:
        return ""


def escolher_status(page, alvo=STATUS_OBRA):
    atual = status_atual(page)
    if N(atual) == N(alvo):
        return ""
    escolher_na_lista(page, CAMPO["status"], "", alvo=alvo, exato=True)
    return f"status {atual or '(vazio)'} -> {alvo}"


# ---------------------------------------------------------------- endereço
_cache_cep = {}


def _variantes_rua(rua):
    """'TB 06' -> ['TB 06', 'TB 6', 'TB-06', 'TB-6']."""
    sem_zero = re.sub(r"\b0+(\d)", r"\1", rua)
    vs = [rua, sem_zero, rua.replace(" ", "-"), sem_zero.replace(" ", "-")]
    out = []
    for v in vs:
        if v and v not in out:
            out.append(v)
    return out


def escolher_cep(resultados, bairro_esperado):
    """Função PURA: entre os resultados do ViaCEP, o único que é do bairro
    esperado (pela 1ª palavra relevante do bairro). Sem bairro esperado, só
    aceita resultado único. Devolve o dict ou None."""
    res = [r for r in (resultados or []) if isinstance(r, dict) and r.get("cep")]
    if bairro_esperado:
        chaves = [w for w in N(bairro_esperado).split() if w not in ("RESIDENCIAL", "SETOR", "JARDIM", "PARQUE", "DOS", "DAS", "DO", "DA", "DE", "II", "I")]
        if chaves:
            res = [r for r in res if chaves[0] in N(r.get("bairro"))]
    return res[0] if len(res) == 1 else None


def buscar_cep(rua, cidade, bairro_esperado):
    """ViaCEP (público, sem chave) pela rua. Nunca derruba o robô."""
    chave = (N(rua), N(cidade), N(bairro_esperado))
    if chave in _cache_cep:
        return _cache_cep[chave]
    achado = None
    if rua and cidade:
        import requests
        from urllib.parse import quote
        for v in _variantes_rua(rua):
            try:
                r = requests.get(f"https://viacep.com.br/ws/GO/{quote(cidade)}/{quote(v)}/json/", timeout=15)
                if r.status_code == 200:
                    achado = escolher_cep(r.json(), bairro_esperado)
            except Exception as e:
                print(f"  ! ViaCEP: {str(e)[:80]}", flush=True)
                break
            if achado:
                break
    _cache_cep[chave] = achado
    return achado


def endereco_da_obra(o, viacep=None):
    """Função PURA (com `viacep` = resultado de buscar_cep): os campos do bloco
    Endereço do MC para a obra."""
    rua, compl = partes_endereco(o["titulo"])
    bairro = SETORES_END.get(N(o.get("setor")), "") or (o.get("setor") or "").strip()
    logradouro = rua if re.match(r"(?i)^(rua|av|avenida|alameda|travessa|rodovia)\b", rua) else f"Rua {rua}"
    cep = ""
    if viacep:
        cep = re.sub(r"\D", "", viacep.get("cep") or "")
        if viacep.get("logradouro"):
            logradouro = viacep["logradouro"]
        if viacep.get("bairro") and not SETORES_END.get(N(o.get("setor"))):
            bairro = viacep["bairro"]
    return {"cep": cep, "logradouro": logradouro, "numero": "s/n", "complemento": compl,
            "bairro": bairro, "cidade": o.get("cidade") or ""}


CAMPO_END = {
    "cep": "input[name='address.zipCode']",
    "logradouro": "input[name='address.address']",
    "numero": "input[name='address.addressNumber']",
    "complemento": "input[name='address.complement']",
    "bairro": "input[name='address.neighborhood']",
}


def ler_endereco_mc(page):
    v = {k: valor_campo(page, sel) for k, sel in CAMPO_END.items()}
    v["cep"] = re.sub(r"\D", "", v["cep"])
    v["estado"] = valor_campo(page, "#state")
    v["cidade"] = valor_campo(page, "#city")
    return v


def diferencas_endereco(alvo, atual):
    """Função PURA: campos do endereço do MC que não batem com o alvo. Campo
    vazio no alvo (ex.: CEP não achado) não conta como diferença."""
    dif = []
    for k in ("cep", "logradouro", "numero", "complemento", "bairro", "cidade"):
        if alvo.get(k) and N(alvo[k]) != N(atual.get(k)):
            dif.append(k)
    if N(atual.get("estado")) not in ("GOIAS", "GO"):
        dif.append("estado")
    return dif


def preencher_endereco(page, o, so=None):
    """Bloco Endereço completo: CEP, Rua, s/n, QD/LT, bairro, Goiás, cidade.
    `so` = lista de campos a escrever (conferência); None = todos (criação).
    Devolve o texto do endereço montado."""
    viacep = buscar_cep(partes_endereco(o["titulo"])[0], o.get("cidade"),
                        SETORES_END.get(N(o.get("setor")), ""))
    e = endereco_da_obra(o, viacep)
    todos = so is None
    so = set(so or [])
    for k in ("cep", "logradouro", "numero", "complemento", "bairro"):
        if e[k] and (todos or k in so):
            escrever(page, CAMPO_END[k], e[k])
    if todos or "estado" in so or "cidade" in so:
        try:
            if todos or "estado" in so:
                escolher_na_lista(page, "#state", "Goi", alvo="Goiás")
                page.wait_for_timeout(900)
            if e["cidade"]:
                escolher_na_lista(page, "#city", e["cidade"][:12], alvo=e["cidade"])
        except Exception as ex:
            print(f"  ! estado/cidade: {str(ex)[:110]}", flush=True)
    texto = f"{e['logradouro']}, {e['numero']}, {e['bairro']}, {e['cep'] or '(sem CEP)'}, {e['cidade']} - GO ({e['complemento']})"
    if not e["cep"]:
        print(f"  ! {o['titulo']}: CEP não achado no ViaCEP para '{e['logradouro']}' — ficou sem CEP", flush=True)
    print(f"  endereço: {texto}", flush=True)
    return e


def tem_conta_pedida(o):
    """Função PURA: uma conta foi PEDIDA para a obra — pela relação CONTA
    BANCÁRIA (`o["conta_exata"]`, ou a relação existe mas não se resolve:
    `o["conta_nao_resolvida"]`) ou pelo texto antigo da coluna CONTA
    (exceto vazio; "PESSOA FISICA" vira a conta CONTA_PESSOA_FISICA). Usada por `completar_no_mc` (decidir se
    abre a seção) e por `main` (decidir, no ramo "já existe no MC", se a
    obra precisa confirmar a conta antes de ser marcada "Criada")."""
    if o.get("conta_nao_resolvida"):
        return True
    conta_exata = (o.get("conta_exata") or "").strip()
    conta = (o.get("conta") or "").strip()
    return bool(conta_exata) or bool(conta)


def tentativas_busca(texto):
    """Função PURA: pedaços curtos de um texto de conta para a busca do combo
    do MC — ele busca por PEDAÇO do nome ("EMPRESA MODELO INCORPORACOES..."
    acha); a linha INTEIRA (que costuma trazer "- Conta corrente: 1234-5 -
    SICOOB" depois do nome) não acha nada."""
    texto = str(texto or "").strip()
    palavras = texto.split()
    tentativas = [texto.split(" - ")[0][:22], " ".join(palavras[:2]), palavras[0] if palavras else ""]
    vistos, unicos = set(), []
    for t in tentativas:
        if t and t not in vistos:
            vistos.add(t)
            unicos.append(t)
    return unicos


def preencher_conta(page, o):
    """Quem paga = Cliente; Conta = a exata, quando a obra tem a relação
    CONTA BANCÁRIA (`o["conta_exata"]`, montado em fila_de_obras/
    fila_atualizar via mapa_contas_por_id) — busca por PEDAÇO
    (`tentativas_busca`, a linha inteira costuma não achar nada no combo) e
    escolhe por igualdade OU prefixo, exigindo uma única candidata
    (`escolha_por_prefixo`, nunca "a mais parecida"); sem ela, o caminho
    antigo (texto livre da coluna CONTA, busca por pedaço, "mais parecida"
    como último recurso).

    Devolve False só quando uma conta foi PEDIDA (`tem_conta_pedida`) e não
    foi possível escolhê-la na lista — nada pedido, ou pedido e escolhido,
    devolve True. É esse sinal que `criar_no_mc`/`completar_no_mc`/`main`
    usam para NÃO marcar a obra como pronta quando ficou com a conta errada
    (ou nenhuma).

    NUNCA imprime nome/número de conta (repo público, log do Actions é
    público): todo `escolher_na_lista` daqui em diante usa `sigilo=True`."""
    try:
        escolher_na_lista(page, CAMPO["quem_paga"], "", alvo="Cliente", exato=True)
    except Exception as e:
        print(f"  ! 'Quem paga': {str(e)[:110]}", flush=True)

    if o.get("conta_nao_resolvida"):
        print("  ! conta bancária: marcada CRIAR CONTA/DÚVIDA (ou relação inválida) — não escolhida", flush=True)
        return False

    conta_exata = (o.get("conta_exata") or "").strip()
    if conta_exata:
        for t in tentativas_busca(conta_exata):
            try:
                escolher_na_lista(page, CAMPO["conta"], t, alvo=conta_exata, prefixo=True, sigilo=True,
                                  numero=o.get("conta_numero") or "")
                print("  conta bancária: escolhida (pela coluna CONTA)", flush=True)
                return True
            except Exception:
                continue
        print("  ! conta bancária pela coluna CONTA: não escolhida", flush=True)
        return False

    conta = (o.get("conta") or "").strip()
    if not conta:
        print("  conta bancária: obra sem CONTA no Notion — deixei em branco", flush=True)
        return True
    for t in tentativas_busca(conta):
        try:
            escolher_na_lista(page, CAMPO["conta"], t, alvo=conta, sigilo=True)
            print("  conta bancária: escolhida", flush=True)
            return True
        except Exception:
            continue
    print("  ! conta bancária: não foi escolhida — ficou em branco", flush=True)
    return False


def desmarcar_compras(page):
    """Terceiro interruptor de 'Exibir obra para' (Lançamentos, Faturamentos,
    Compras). Os dois primeiros têm name; o de Compras não, então vai pela ordem."""
    cxs = page.locator("input[type=checkbox]:visible")
    if cxs.count() >= 3:
        alvo = cxs.nth(2)
        if alvo.is_checked():
            alvo.click(force=True)
            print("  Exibir obra para: Compras desmarcado", flush=True)


def ja_existe_no_mc(page, titulo):
    """Confere AO VIVO na lista do MC antes de criar. A planilha do ERP (que a
    fila usa) só atualiza de tempos em tempos: se a rodada de ontem criou a
    obra e não conseguiu marcar "Criada" no Notion, sem esta conferência a
    obra nasceria de novo, duplicada."""
    try:
        busca = page.locator("input[placeholder*='Busque uma obra']").first
        busca.fill(titulo)
        page.wait_for_timeout(2000)
        linhas = page.locator("table tbody tr, [class*=row]").filter(has_text=titulo)
        for i in range(min(linhas.count(), 5)):
            if N(titulo) in N(linhas.nth(i).inner_text()):
                busca.fill("")
                return True
        busca.fill("")
    except Exception:
        pass
    return False


def criar_no_mc(page, o):
    if o.get("conta_nao_resolvida"):
        # relação CONTA BANCÁRIA que não se resolve (fora do banco de contas,
        # sem nome, ou 2+ contas): não cria — criar sem a conta e marcar
        # "Criada" deixaria a obra sem a conta pedida sem ninguém voltar a
        # olhar. Aviso sem nome de conta (repo público).
        print(f"  ! {o['titulo']}: conta bancária pedida pela relação não se resolve — não criei", flush=True)
        return "conta_nao_resolvida"
    ir_lista_obras(page)
    if ja_existe_no_mc(page, o["titulo"]):
        return "ja_existe"
    clicar_texto(page, "Nova Obra", exato=False)
    page.locator(CAMPO["nome"]).wait_for(state="visible", timeout=15000)

    nome_ok = escrever(page, CAMPO["nome"], o["titulo"])
    print(f"  nome da obra: '{nome_ok}'", flush=True)

    n = int(o["casas"]) if isinstance(o["casas"], (int, float)) else 0
    tipo = TIPOS.get(n, TIPO_PADRAO)
    try:
        escolher_na_lista(page, CAMPO["tipo"], "", alvo=tipo, exato=True)
        print(f"  tipo: {tipo}", flush=True)
    except Exception as e:
        print(f"  ! tipo '{tipo}': {str(e)[:110]}", flush=True)
    try:
        escolher_status(page)
        print(f"  status: {STATUS_OBRA}", flush=True)
    except Exception as e:
        print(f"  ! status: {str(e)[:110]}", flush=True)

    try:
        ajustar_visiveis(page, o.get("resp") or "")
    except Exception as e:
        print(f"  ! Visível para: {str(e)[:110]}", flush=True)

    abrir_secao(page, "Dados gerais")
    try:
        if o["area"]:
            escrever(page, CAMPO["area"], f"{float(o['area']):.2f}".replace(".", ","))
        if o["rt"]:
            escrever(page, CAMPO["rt"], o["rt"])
        if o["resp"]:
            escrever(page, CAMPO["resp"], o["resp"])
    except Exception as e:
        print(f"  ! dados gerais: {str(e)[:110]}", flush=True)

    abrir_secao(page, "Dados do cliente")
    cliente = escolher_cliente(page, o["cliente"])
    print(f"  cliente: {cliente}", flush=True)
    fechar_replicar(page)

    abrir_secao(page, "Endereço")
    try:
        preencher_endereco(page, o)
    except Exception as e:
        print(f"  ! endereço: {str(e)[:110]}", flush=True)
    abrir_secao(page, "Conta bancária padrão")
    conta_ok = True
    try:
        conta_ok = preencher_conta(page, o)
    except Exception as e:
        print(f"  ! conta: {str(e)[:110]}", flush=True)
        conta_ok = False
    abrir_secao(page, "Exibir obra para")
    try:
        m = ajustar_exibir(page)
        print(f"  Exibir obra para: Lançamento e Faturamento ativados, Compras desativado"
              + (f" ({', '.join(m)})" if m else ""), flush=True)
    except Exception as e:
        print(f"  ! Exibir obra para: {str(e)[:110]}", flush=True)

    # sensivel=True: a tela mostra a conta bancária escolhida, e o artefato
    # mc-evidencias do Actions é público (repo público) — só com DESCOBRIR=1
    foto(page, "antes_salvar_" + o["titulo"].replace(" ", "_"), sensivel=True)
    if not APLICAR:
        page.keyboard.press("Escape")
        page.wait_for_timeout(600)
        return "simulado"

    salvar = page.locator("button:visible").filter(has_text=re.compile(r"salvar\s+obra", re.I)).last
    salvar.scroll_into_view_if_needed()
    page.wait_for_timeout(400)
    try:
        page._rede.clear()
    except Exception:
        pass
    salvar.click(force=True)
    fechou = True
    try:
        # salvou = o painel fecha e o MC abre a página da obra (/work/<id>)
        page.wait_for_url(re.compile(r"/work/[0-9a-f-]{20,}"), timeout=30000)
    except Exception:
        try:
            page.locator(CAMPO["nome"]).wait_for(state="hidden", timeout=5000)
        except Exception:
            fechou = False
    # o que o MC respondeu: é isso que diz se a obra foi criada ou recusada
    rede = []
    try:
        rede = [x for x in (page._rede or []) if "/work" in x or "POST" in x][:12]
    except Exception:
        pass
    if not fechou:
        erro = ""
        try:
            erro = page.evaluate("""() => [...document.querySelectorAll('.Mui-error, .MuiFormHelperText-root, [role=alert], .Toastify__toast')]
                .filter(e => e.offsetWidth||e.offsetHeight)
                .map(e => e.innerText.trim()).filter(t => t && t.length > 3 && isNaN(Number(t)))
                .join(' | ').slice(0,400)""")
        except Exception:
            pass
        foto(page, "erro_salvar_" + o["titulo"].replace(" ", "_"), sensivel=True)
        raise RuntimeError(f"o painel continuou aberto depois de Salvar Obra. Erros na tela: {erro or '(nenhum)'} "
                           f"| rede: {rede or '(sem chamadas)'}")
    print(f"  salvou — rede: {rede or '(sem chamadas registradas)'}", flush=True)
    foto(page, "pos_salvar_" + o["titulo"].replace(" ", "_"), sensivel=True)
    orc_ok = True
    try:
        print(f"  orçamento: {garantir_orcamento(page, o)}", flush=True)
    except Exception as e:
        orc_ok = False
        o["_erro_orc"] = str(e)
        print(f"  ! orçamento: {str(e)[:140]}", flush=True)
    if not conta_ok:
        # havia conta pedida (relação CONTA BANCÁRIA ou texto em CONTA) e não
        # foi escolhida na lista — não marco "Criada" (o dono revisita pelo
        # painel); aviso SEM o nome da conta (repo público).
        print(f"  ! {o['titulo']}: obra criada, mas a conta bancária pedida não foi escolhida — não marco 'Criada'", flush=True)
        return "criada_sem_conta"
    return "criada" if orc_ok else "criada_sem_orcamento"


# =====================================================================
# COMPLETAR OBRAS QUE JÁ EXISTEM NO MC (set/26)
# ---------------------------------------------------------------------
# Para cada obra em andamento que existe no MC: abre "Editar Obra" (o mesmo
# formulário da criação, que vem PREENCHIDO com o que o MC já tem) e só
# completa o que estiver FALTANDO lá — nunca sobrescreve o que alguém
# preencheu no MC. O que entra:
#   tipo (Genérico/vazio -> pelo Nº DE CASAS), área total (averbada + pós
#   habite-se), responsável técnico, responsável da obra, cliente, endereço
#   (logradouro, complemento, estado, cidade), quem paga e conta.
# "Visível para" e "Compras" NÃO são mexidos aqui: são decisões da criação.
#
# Para não abrir 90 obras todo dia: a coluna MC ATUALIZADO EM guarda quando
# a obra foi conferida; ela só volta para a fila se for editada no Notion
# depois disso. Primeira rodada: no máximo LIMITE_POR_RODADA obras.
#
# 08/10/26 — CONFERÊNCIA DO QUE JÁ ESTÁ PREENCHIDO. Antes o robô só preenchia
# campo VAZIO no MC; valor errado ficava errado para sempre. Agora o Notion é
# a fonte: campo do MC diferente do Notion é CORRIGIDO (tipo, área, RT,
# responsável, cliente, logradouro/complemento/cidade, conta bancária). Campo
# vazio no Notion nunca apaga o que está no MC. Toda obra ativa volta para a
# fila a cada REVER_DIAS dias, mesmo sem edição no Notion (pega o que alguém
# mudou direto no MC); as editadas no Notion vêm primeiro.
# =====================================================================
COL_MC_DATA = "MC ATUALIZADO EM"
LIMITE_POR_RODADA = 35
REVER_DIAS = 7
FIM = ("FINALIZADO", "CANCELADO", "CONCLUIDO")


# ---- comparações PURAS (sem Playwright) — testadas em tests/ -------------
_SUFIXOS_EMPRESA = {"LTDA", "ME", "EPP", "EIRELI", "SA", "S/A", "S.A", "S.A."}


def mesmo_nome(a, b):
    """Nome do Notion x nome no MC: igual ignorando acento/caixa/espaço e os
    sufixos de empresa (LTDA, ME…), que o MC às vezes guarda sem."""
    def base(x):
        return [w for w in N(x).replace(",", " ").split() if w not in _SUFIXOS_EMPRESA]
    return bool(N(a)) and base(a) == base(b)


def numero_mc(texto):
    """'1.234,56' / '123,4' / '123.45' -> float; vazio/ilegível -> None."""
    t = re.sub(r"[^0-9,.\-]", "", str(texto or ""))
    if not t:
        return None
    if "," in t:
        t = t.replace(".", "").replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return None


def mesma_area(notion, mc):
    a, b = numero_mc(notion), numero_mc(mc)
    if a is None:
        return True                    # Notion vazio: não mexe
    return b is not None and abs(a - b) < 0.01


def partes_endereco(titulo):
    """'TB 15 QD 45 LT 39' -> ('TB 15', 'QD 45 LT 39')."""
    corte = titulo.find(" QD ")
    return (titulo[:corte].strip(), titulo[corte:].strip()) if corte > 0 else (titulo, "")


def conta_confere(valor_mc, o):
    """A conta escolhida no MC é a pedida no Notion? Sem conta pedida, qualquer
    uma serve (não mexe)."""
    if not tem_conta_pedida(o):
        return True
    if not str(valor_mc or "").strip():
        return False
    exata = (o.get("conta_exata") or "").strip()
    if exata:
        return escolha_por_prefixo([valor_mc], exata, o.get("conta_numero") or "") is not None
    texto = (o.get("conta") or "").strip()
    return bool(texto) and escolha_por_prefixo([valor_mc], texto) is not None


# 08/10/26 — todo problema do robô com uma obra vai para a coluna MC ERRO do
# Notion, que vira ALERTA na aba Obras do portal (com a explicação). Some
# sozinho quando a obra passa sem erro.
COL_MC_ERRO = "MC ERRO"


def explicar_erro(motivo, o=None):
    """Função PURA: texto curto, em português, do problema — o que aparece no
    alerta do portal. NUNCA leva nome/número de conta (o portal é público)."""
    o = o or {}
    m = str(motivo or "").strip()
    n = N(m)
    if m == "sem_proprietario":
        return "Proprietário vazio no Notion — preencha para o robô criar a obra no Mais Controle."
    if m == "conta_nao_resolvida":
        return ("Conta bancária ainda não definida (CONTA = CRIAR CONTA/DÚVIDA) — escolha a conta "
                "para o robô criar a obra.")
    if m == "conta_nao_escolhida":
        return ("A conta bancária do Notion não apareceu na lista do Mais Controle — confira se ela existe "
                "em Financeiro > Contas Bancárias com o mesmo nome. A obra fica sem conta até isso.")
    if m.startswith("orcamento:"):
        det = explicar_erro(m[len("orcamento:"):], o)
        return "Obra está no Mais Controle, mas o orçamento 'sem orça' não foi criado: " + det + \
               " O robô tenta de novo na próxima rodada."
    if "NAO APARECEU IGUAL NA LISTA DO MC" in n and "CLIENTE" in n:
        return (f"Cliente '{o.get('cliente') or ''}' não encontrado no Mais Controle (busquei pelo nome e "
                "pela razão social). Cadastre o cliente no MC ou corrija o Proprietário no Notion.").replace("'' ", "")
    if "PAINEL CONTINUOU ABERTO DEPOIS DE SALVAR OBRA" in n:
        tela = m.split("Erros na tela:", 1)[1].split("| rede:")[0].strip() if "Erros na tela:" in m else ""
        return "O Mais Controle não aceitou salvar a obra" + (f": {tela}" if tela and tela != "(nenhum)" else ".")
    if "EDIT_PLANNING" in n or "COMECAR DESABILITADO" in n:
        return "o usuário do robô está sem permissão para criar orçamento no Mais Controle."
    if "OBRA NAO APARECEU NA LISTA DO ORCAMENTO" in n:
        return "a obra não apareceu para escolher na tela de orçamento do Mais Controle."
    if "CODIGO" in n and ("NAO CONSEGUI" in n or "NAO APARECEU" in n):
        return "o Mais Controle não aceitou o código 'sem orça'."
    if "TIMEOUT" in n:
        return "o Mais Controle demorou a responder (tempo esgotado)."
    return re.sub(r"\s+", " ", m)[:200] or "erro sem detalhe."


def marcar_erro(o, motivo):
    texto = explicar_erro(motivo, o)
    agora = datetime.now(timezone(timedelta(hours=-3))).strftime("%d/%m %H:%M")
    print(f"  ALERTA {o['titulo']}: {texto}", flush=True)
    if APLICAR:
        try:
            api("PATCH", f"/pages/{o['id']}", {"properties": {COL_MC_ERRO: {"rich_text": [
                {"text": {"content": f"{texto} (robô, {agora})"[:1900]}}]}}})
            o["mc_erro"] = texto
        except (Exception, SystemExit) as e:
            print(f"  ! não gravei o alerta no Notion: {str(e)[:100]}", flush=True)


def limpar_erro(o):
    if o.get("mc_erro") and APLICAR:
        try:
            api("PATCH", f"/pages/{o['id']}", {"properties": {COL_MC_ERRO: {"rich_text": []}}})
            o["mc_erro"] = ""
            print(f"  {o['titulo']}: alerta do robô resolvido (MC ERRO limpo)", flush=True)
        except (Exception, SystemExit) as e:
            print(f"  ! não limpei o alerta no Notion: {str(e)[:100]}", flush=True)


def garantir_coluna_erro():
    esq = api("GET", f"/databases/{ID_OBRAS}").get("properties") or {}
    if any(N(k) == N(COL_MC_ERRO) for k in esq):
        return
    print(f"Coluna {COL_MC_ERRO} não existe — " + ("criando." if APLICAR else "seria criada."), flush=True)
    if APLICAR:
        api("PATCH", f"/databases/{ID_OBRAS}", {"properties": {COL_MC_ERRO: {"rich_text": {}}}})


def garantir_coluna_data():
    esq = api("GET", f"/databases/{ID_OBRAS}").get("properties") or {}
    if any(N(k) == N(COL_MC_DATA) for k in esq):
        return
    print(f"Coluna {COL_MC_DATA} não existe — " + ("criando." if APLICAR else "seria criada."), flush=True)
    if APLICAR:
        api("PATCH", f"/databases/{ID_OBRAS}", {"properties": {COL_MC_DATA: {"date": {}}}})


def marcar_conferida(pid):
    agora = datetime.now(timezone.utc).isoformat()
    api("PATCH", f"/pages/{pid}", {"properties": {COL_MC_DATA: {"date": {"start": agora}}}})


def marcar_para_rever(pid):
    """Apaga a data de conferência: a obra volta para a fila na próxima rodada
    (usado quando o orçamento não pôde ser criado)."""
    api("PATCH", f"/pages/{pid}", {"properties": {COL_MC_DATA: {"date": None}}})


def _dt(s):
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:
        return None


def fila_atualizar(no_mc, mapa_contas=None):
    mapa_contas = mapa_contas or {}
    fila = []
    for pg in ler_banco(ID_OBRAS, "OBRAS"):
        pr = pg.get("properties") or {}
        titulo = padronizar_endereco(txt(pega(pr, "Projeto")))
        if not titulo or titulo not in no_mc:
            continue
        if N(txt(pega(pr, "Status"))) in FIM:
            continue
        conf = (pega(pr, COL_MC_DATA) or {}).get("date") or {}
        conf = _dt(conf.get("start")) if conf else None
        editada = _dt(pg.get("last_edited_time"))
        # gravar a própria data mexe na última edição: 3 min de folga
        mudou_no_notion = not (conf and editada and (editada - conf).total_seconds() < 180)
        vencida = (not conf) or (datetime.now(timezone.utc) - conf).days >= REVER_DIAS
        if not mudou_no_notion and not vencida:
            continue
        a1, a2 = txt(pega(pr, "ÁREA CONSTRUÍDA AVERBADA")), txt(pega(pr, "ÁREA PÓS HABITE-SE"))
        conta_exata, conta_numero, nao_resolvida = resolver_conta(prop_conta(pr), mapa_contas)
        fila.append({
            "id": pg["id"], "titulo": titulo, "conferida": bool(conf),
            "mudou_no_notion": bool(conf) and mudou_no_notion, "conf_em": conf,
            "casas": txt(pega(pr, "Nº DE CASAS")),
            "area": ((a1 or 0) + (a2 or 0)) or None,
            "rt": txt(pega(pr, "ENGENHEIRO RT")),
            "resp": txt(pega(pr, "Responsável Pela Obra")),
            "cliente": txt(pega(pr, "Proprietário")),
            "cidade": txt(pega(pr, "Cidade")).split(",")[0].strip(),
            "setor": txt(pega(pr, "SETOR")),
            "conta": nome_conta_texto(txt(pega(pr, "CONTA"))),
            "mc_erro": txt(pega(pr, COL_MC_ERRO)) or "",
            "conta_exata": conta_exata,
            "conta_numero": conta_numero,
            "conta_nao_resolvida": nao_resolvida,
        })
    # ordem: 1) editadas no Notion depois da última conferência; 2) as que
    # nunca foram conferidas; 3) as conferidas há mais tempo (rodízio semanal)
    antigo = datetime(2000, 1, 1, tzinfo=timezone.utc)
    fila.sort(key=lambda o: (not o["mudou_no_notion"], o["conferida"], o["conf_em"] or antigo))
    return fila


def ir_lista_obras(page):
    """Vai para "Minhas Obras" pelo ENDEREÇO (#/work). Pelo menu não dá depois
    de abrir uma obra: o painel de edição/página da obra fica por cima do menu
    lateral, e da segunda obra em diante o robô não achava mais nada — foi o
    que aconteceu na simulação de 23/09 (1 obra conferida, 34 com erro)."""
    base = (MC_URL.split("#")[0] or "https://acessar.maiscontroleerp.com.br/").rstrip("/") + "/#/work"
    page.goto(base)
    page.locator("input[placeholder*='Busque uma obra']").first.wait_for(state="visible", timeout=25000)
    page.wait_for_timeout(800)


def abrir_edicao(page, titulo):
    ir_lista_obras(page)
    busca = page.locator("input[placeholder*='Busque uma obra']").first
    busca.fill(titulo)
    page.wait_for_timeout(2200)
    linha = page.locator("table tbody tr, [class*=row]").filter(has_text=titulo).first
    if not linha.count():
        raise RuntimeError("não achei a obra na lista do MC")
    linha.click()
    page.wait_for_url(re.compile(r"/work/[0-9a-f-]{20,}"), timeout=20000)
    page.wait_for_timeout(1200)
    page.locator("button:visible").filter(has_text=re.compile(r"editar\s+obra", re.I)).first.click()
    page.locator(CAMPO["nome"]).wait_for(state="visible", timeout=15000)
    # O formulário de edição abre VAZIO e o MC preenche os campos logo depois.
    # Ler cedo demais faz campo preenchido parecer vazio — e aí o robô tentaria
    # escrever por cima. Espera o nome chegar e mais um pouco para o resto.
    try:
        page.wait_for_function("() => { const e = document.querySelector('input[name=name]'); return e && e.value.trim().length > 0; }",
                               timeout=15000)
    except Exception:
        pass
    page.wait_for_timeout(2500)


def valor_campo(page, sel):
    """Valor atual do campo no MC. Se vier vazio, confere de novo depois de um
    instante: só é "vazio" se continuar vazio."""
    for tentativa in range(2):
        try:
            v = (page.locator(sel).first.input_value() or "").strip()
        except Exception:
            v = ""
        if v:
            return v
        if tentativa == 0:
            page.wait_for_timeout(900)
    return ""


def _orcamento_na_conferencia(page, o):
    """Devolve True se a obra ficou com orçamento (ou é simulação)."""
    try:
        r = garantir_orcamento(page, o)
        if r != "já tinha orçamento":
            print(f"  {o['titulo']}: orçamento {r}", flush=True)
        return True
    except Exception as e:
        o["_erro_orc"] = str(e)
        print(f"  ! {o['titulo']}: orçamento: {str(e)[:120]}", flush=True)
        return False


def completar_no_mc(page, o):
    """Abre a obra no MC e deixa cada campo IGUAL ao Notion: preenche o vazio
    e corrige o diferente (08/10/26). Campo vazio no Notion não mexe no MC.
    Conta bancária: nunca imprime nome/número (log público)."""
    abrir_edicao(page, o["titulo"])
    mudou = []

    # --- tipo da obra (pelo Nº DE CASAS)
    n = int(o["casas"]) if isinstance(o["casas"], (int, float)) else 0
    # o valor do input é um id (uuid); o NOME do tipo fica no quadro do select.
    tipo_atual = ""
    try:
        tipo_atual = page.locator(CAMPO["tipo"]).first.evaluate("""e => {
            const q = e.parentElement.querySelector('[role=combobox], .MuiSelect-select, .MuiSelect-root');
            return (q ? q.innerText : '').trim(); }""")
    except Exception:
        pass
    print(f"  {o['titulo']}: no MC hoje -> tipo '{tipo_atual or '(vazio)'}' | nº de casas no Notion: {n or '(vazio)'}", flush=True)
    if N(tipo_atual) in ("SELECIONE UM TIPO", ""):
        tipo_atual = ""                     # é só o texto de exemplo do campo vazio
    if n in TIPOS and N(tipo_atual) != N(TIPOS[n]):
        try:
            escolher_na_lista(page, CAMPO["tipo"], "", alvo=TIPOS[n], exato=True)
            mudou.append(f"tipo {tipo_atual or '(vazio)'} -> {TIPOS[n]}")
        except Exception as e:
            print(f"  ! tipo: {str(e)[:90]}", flush=True)

    # --- status: obra que ficou "Em orçamento" (padrão do MC) vira Em andamento.
    # Paralisada/Finalizada/A iniciar são decisões de alguém: não mexe.
    if N(status_atual(page)) in ("EM ORCAMENTO", ""):
        try:
            m = escolher_status(page)
            if m:
                mudou.append(m)
        except Exception as e:
            print(f"  ! status: {str(e)[:90]}", flush=True)

    # --- visível para (equipe do responsável)
    try:
        m = ajustar_visiveis(page, o.get("resp") or "")
        if m:
            mudou.append("visível para " + ", ".join(m))
    except Exception as e:
        print(f"  ! Visível para: {str(e)[:90]}", flush=True)

    # --- dados gerais: área, responsável técnico, responsável da obra
    area_atual = valor_campo(page, CAMPO["area"])
    rt_atual, resp_atual = valor_campo(page, CAMPO["rt"]), valor_campo(page, CAMPO["resp"])
    area_dif = bool(o["area"]) and not mesma_area(o["area"], area_atual)
    rt_dif = bool(o["rt"]) and N(rt_atual) != N(o["rt"])
    resp_dif = bool(o["resp"]) and N(resp_atual) != N(o["resp"])
    if area_dif or rt_dif or resp_dif:
        abrir_secao(page, "Dados gerais")
        if area_dif:
            escrever(page, CAMPO["area"], f"{float(o['area']):.2f}".replace(".", ","))
            mudou.append(f"área {area_atual or '(vazio)'} -> {o['area']}")
        if rt_dif:
            escrever(page, CAMPO["rt"], o["rt"])
            mudou.append(f"responsável técnico {rt_atual or '(vazio)'} -> {o['rt']}")
        if resp_dif:
            escrever(page, CAMPO["resp"], o["resp"])
            mudou.append(f"responsável da obra {resp_atual or '(vazio)'} -> {o['resp']}")

    # --- cliente (= Proprietário)
    cliente_atual = valor_campo(page, CAMPO["cliente"])
    if o["cliente"] and not mesmo_nome(o["cliente"], cliente_atual):
        abrir_secao(page, "Dados do cliente")
        try:
            c = escolher_cliente(page, o["cliente"])
            fechar_replicar(page)
            mudou.append(f"cliente {cliente_atual or '(vazio)'} -> {c}")
        except Exception as e:
            print(f"  ! cliente: {str(e)[:90]}", flush=True)

    # --- endereço completo (CEP, Rua, s/n, QD/LT, bairro, Goiás, cidade)
    try:
        alvo_end = endereco_da_obra(o, buscar_cep(partes_endereco(o["titulo"])[0], o.get("cidade"),
                                                   SETORES_END.get(N(o.get("setor")), "")))
        atual_end = ler_endereco_mc(page)
        dif = diferencas_endereco(alvo_end, atual_end)
        if dif:
            abrir_secao(page, "Endereço")
            preencher_endereco(page, o, so=dif)
            mudou.append("endereço (" + ", ".join(dif) + ")")
    except Exception as e:
        print(f"  ! endereço: {str(e)[:90]}", flush=True)

    # --- exibir obra para: NÃO mexe na conferência (08/10/26). "Só Lançamento
    # e Faturamento" vale apenas para obra NOVA (criar_no_mc); nas existentes,
    # Compras ligado/desligado é decisão de quem cuida da obra.

    # --- conta bancária
    conta_pendente = False
    if o.get("conta_nao_resolvida"):
        # relação que não se resolve: mesmo com a conta do MC preenchida, não
        # dá para conferir que é a pedida — não conta como conferida/Criada
        conta_pendente = True
        print(f"  ! {o['titulo']}: conta bancária pedida pela relação não se resolve — não conto como conferida", flush=True)
    elif tem_conta_pedida(o):
        conta_atual = valor_campo(page, CAMPO["conta"])
        if not conta_confere(conta_atual, o):
            print(f"  {o['titulo']}: conta bancária " + ("vazia" if not conta_atual else "diferente do Notion")
                  + " — vou escolher a do Notion", flush=True)
            abrir_secao(page, "Conta bancária padrão")
            try:
                if preencher_conta(page, o):     # escolhe só a opção que é a do Notion
                    mudou.append("conta bancária")
                else:
                    conta_pendente = True
                    print(f"  ! {o['titulo']}: conta bancária pedida não foi escolhida — não conto como conferida", flush=True)
            except Exception as e:
                print(f"  ! conta: {str(e)[:90]}", flush=True)
                conta_pendente = True

    if not mudou:
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)
        orc_ok = _orcamento_na_conferencia(page, o)
        if conta_pendente:
            return "conta não escolhida"
        # 08/10/26: sem orçamento não conta como conferida — a próxima rodada
        # tenta de novo (antes ficava 7 dias sem olhar).
        return "nada a completar" if orc_ok else "orçamento pendente"
    print(f"  {o['titulo']}: corrigindo " + " | ".join(mudou), flush=True)
    if not APLICAR:
        page.keyboard.press("Escape")
        return "simulado"
    salvar = page.locator("button:visible").filter(has_text=re.compile(r"salvar\s+obra", re.I)).last
    salvar.scroll_into_view_if_needed()
    salvar.click(force=True)
    try:
        page.locator(CAMPO["nome"]).wait_for(state="hidden", timeout=25000)
    except Exception:
        foto(page, "erro_completar_" + o["titulo"].replace(" ", "_"), sensivel=True)
        raise RuntimeError("o painel de edição continuou aberto depois de Salvar Obra")
    orc_ok = _orcamento_na_conferencia(page, o)
    # mesmo salvando os outros campos, a conta pedida (e não escolhida) não
    # pode "passar" como conferida — main() só marca conferida para
    # "completada"/"nada a completar", nunca para este status.
    if conta_pendente:
        return "conta não escolhida"
    return "completada" if orc_ok else "orçamento pendente"


def main():
    mapa_contas = mapa_contas_por_id()
    fila = fila_de_obras(mapa_contas)
    no_mc = obras_no_mc() or set()
    ja = [o for o in fila if o["titulo"] in no_mc]
    fazer = [o for o in fila if o["titulo"] not in no_mc]
    print(f"Fila: {len(fila)} obras marcadas 'Criar' — {len(ja)} já existem no MC, {len(fazer)} para criar", flush=True)
    # obra que já existe no MC mas ainda pede conta: marcar "Criada" direto
    # (como antes) deixaria a conta sem ninguém olhar de novo — passa pelo
    # completar_no_mc (abre a edição e tenta escolher) e só é marcada depois,
    # e só se a conta ficou preenchida.
    # 08/10/26: TODA obra "Criar" que já existe no MC passa pelo
    # completar_no_mc (conta, orçamento, demais campos) antes de virar Criada
    # — antes, a sem conta pedida era marcada direto e ficava sem orçamento.
    ja_com_conta = list(ja)
    if ja_com_conta:
        print(f"  {len(ja_com_conta)} já existem no MC — confiro (conta, orçamento) antes de marcar Criada", flush=True)
    garantir_coluna_data()
    garantir_coluna_erro()
    faltando = [o for o in fazer if not o["cliente"]]
    for o in faltando:
        print(f"  ! {o['titulo']}: sem Proprietário — pulei", flush=True)
        marcar_erro(o, "sem_proprietario")
    fazer = [o for o in fazer if o["cliente"]]

    completar = fila_atualizar(no_mc, mapa_contas)[:LIMITE_POR_RODADA]
    # obras do ja_com_conta já vão ser abertas no completar_no_mc abaixo —
    # tirar da lista de "completar" para não abrir a mesma obra duas vezes.
    ids_ja_com_conta = {o["id"] for o in ja_com_conta}
    completar = [o for o in completar if o["id"] not in ids_ja_com_conta]
    print(f"Completar: {len(completar)} obras do MC para conferir nesta rodada", flush=True)
    if not fazer and not completar and not ja_com_conta:
        return 0
    with sync_playwright() as p:
        b, page = abrir(p)
        try:
            login(page)
            # 08/10/26: Proprietário do Notion (razão social) -> nome fantasia do MC
            for o in ja_com_conta + completar + fazer:
                if o.get("cliente"):
                    o["cliente"] = nome_cliente_no_mc(page, o["cliente"])
            for o in ja_com_conta:
                try:
                    r = completar_no_mc(page, o)
                    print(f"  {o['titulo']} (já existe, conferindo): {r}", flush=True)
                    if r != "conta não escolhida" and APLICAR:
                        marcar_criada(o["id"])
                        if r in ("completada", "nada a completar"):
                            marcar_conferida(o["id"])
                        elif r == "orçamento pendente":
                            marcar_para_rever(o["id"])
                    _alerta_do_resultado(o, r)
                except Exception as e:
                    print(f"  ! {o['titulo']} (já existe, conferindo): {str(e)[:160]}", flush=True)
                    marcar_erro(o, str(e))
                    page.keyboard.press("Escape")
            for o in completar:
                try:
                    r = completar_no_mc(page, o)
                    print(f"  {o['titulo']}: {r}", flush=True)
                    if r in ("completada", "nada a completar") and APLICAR:
                        marcar_conferida(o["id"])
                    elif r == "orçamento pendente" and APLICAR:
                        marcar_para_rever(o["id"])
                    _alerta_do_resultado(o, r)
                except Exception as e:
                    print(f"  ! {o['titulo']} (completar): {str(e)[:160]}", flush=True)
                    marcar_erro(o, str(e))
                    page.keyboard.press("Escape")
            for o in fazer:
                try:
                    r = criar_no_mc(page, o)
                    # 08/10/26 — a planilha do ERP atrasa: obra criada numa
                    # rodada anterior SEM a conta volta como "para criar", a
                    # conferência ao vivo diz "ja_existe" e ela era marcada
                    # Criada sem ninguém escolher a conta. Agora, se pede
                    # conta, abre a edição e só marca se a conta entrar.
                    if r == "ja_existe":
                        r2 = completar_no_mc(page, o)
                        print(f"  {o['titulo']} (já existia, conferindo conta): {r2}", flush=True)
                        if r2 == "conta não escolhida":
                            r = "criada_sem_conta"
                        elif r2 == "orçamento pendente":
                            r = "ja_existe_sem_orcamento"
                    print(f"  {o['titulo']}: {r}", flush=True)
                    if r in ("criada", "ja_existe", "ja_existe_sem_orcamento", "criada_sem_orcamento") and APLICAR:
                        marcar_criada(o["id"])
                        try:
                            if r in ("ja_existe_sem_orcamento", "criada_sem_orcamento"):
                                marcar_para_rever(o["id"])
                            else:
                                marcar_conferida(o["id"])
                        except Exception:
                            pass
                    _alerta_do_resultado(o, r)
                except Exception as e:
                    print(f"  ! {o['titulo']}: {str(e)[:160]}", flush=True)
                    marcar_erro(o, str(e))
                    foto(page, "erro_" + o["titulo"].replace(" ", "_"), sensivel=True)
                    page.keyboard.press("Escape")
        finally:
            b.close()
    print("APLICADO" if APLICAR else "SIMULAÇÃO — nada foi salvo no MC nem no Notion", flush=True)
    return 0


def motivo_do_resultado(r, o):
    """Função PURA: resultado de criar/completar -> motivo do alerta (None = ok)."""
    if r in ("conta não escolhida", "criada_sem_conta"):
        return "conta_nao_escolhida"
    if r == "conta_nao_resolvida":
        return "conta_nao_resolvida"
    if r in ("orçamento pendente", "criada_sem_orcamento", "ja_existe_sem_orcamento"):
        return "orcamento:" + (o.get("_erro_orc") or "")
    return None


def _alerta_do_resultado(o, r):
    motivo = motivo_do_resultado(r, o)
    if motivo:
        marcar_erro(o, motivo)
    elif r != "simulado":
        limpar_erro(o)


if __name__ == "__main__":
    sys.exit(main())
