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
from datetime import datetime, timezone

from robo_mc_comum import N, foto, abrir, login, ir_menu, clicar_texto, APLICAR, MC_URL
from fetch_vendas import ler_banco, api
from fetch_obras import obras_no_mc, padronizar_endereco
import robo_mc_contas as rc  # reaproveita _achar_filho_banco/txt/pega do banco de contas (sem playwright no topo dele)

ID_OBRAS = "306c5ab532d3812fa14fe9a281510128"
TIPOS = {1: "Casa", 2: "2 casas", 3: "3 casas", 4: "4 casas", 5: "5 casas"}
TIPO_PADRAO = "Genérico"     # sem Nº DE CASAS ainda: entra como genérico

# "Visível para": ficam só os engenheiros de execução (e o estagiário deles)
# que são os responsáveis da obra. Os demais são desmarcados.
EQUIPES = {
    "GUILHERME GOUVEIA": ["Guilherme", "alefe"],
    "JOAO MARCOS VIEIRA CABRAL MENEZES": ["João Marcos", "Ian"],
    "ISAAC NATAN": ["Isaac", "Icaro"],
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
        valor = str(txt(prop_relacao) or "").strip()
        if not valor or N(valor) == "PESSOA FISICA":
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
            "cidade": txt(pega(pr, "Cidade")),
            "conta": txt(pega(pr, "CONTA")),
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


def escolher_na_lista(page, campo_sel, texto_busca, alvo=None, exato=False, prefixo=False, sigilo=False, numero=""):
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
    textos = [(opcoes.nth(i).inner_text() or "").strip() for i in range(min(n, 40))]
    escolha = None
    alvo = alvo or texto_busca or ""
    if prefixo:
        escolha = escolha_por_prefixo(textos, alvo, numero)
    else:
        for i, t in enumerate(textos):
            if N(t) == N(alvo):
                escolha = i
                break
    if escolha is None and not prefixo and not exato:
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
    opcoes.nth(escolha).click()
    page.wait_for_timeout(600)
    return textos[escolha]


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


def ajustar_visiveis(page, resp):
    """Deixa marcados só os usuários da equipe do responsável pela obra."""
    manter = []
    for eng, nomes in EQUIPES.items():
        if N(eng) in N(resp) or N(resp) in N(eng):
            manter = nomes
    if not manter:
        # responsável que não é engenheiro de execução (ex.: obra lançada por
        # outra pessoa): não dá para saber qual equipe fica — não tira ninguém
        print(f"  Visível para: '{resp or '(vazio)'}' não é engenheiro de execução — deixei todo mundo", flush=True)
        return
    fora = [n for eng, nomes in EQUIPES.items() for n in nomes if n not in manter]
    # a caixa é um select com lista de checkboxes (label id=select-checkbox-list-label)
    page.locator("xpath=//label[@id='select-checkbox-list-label']/following-sibling::div[1]").first.click(force=True)
    page.wait_for_timeout(900)
    tirados = []
    busca = page.locator("input[placeholder='Busque um usuário']")
    for nome in fora:
        try:
            if busca.count():
                busca.first.evaluate(JS_SET, nome)
                page.wait_for_timeout(700)
            linha = page.locator("li, label").filter(has_text=nome).first
            cx = linha.locator("input[type=checkbox]").first
            if cx.count() and cx.is_checked():
                linha.click()
                tirados.append(nome)
                page.wait_for_timeout(300)
        except Exception:
            continue
    if busca.count():
        busca.first.evaluate(JS_SET, "")
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    print(f"  Visível para: mantive {manter}, tirei {tirados}", flush=True)


def preencher_endereco(page, o):
    """Logradouro = rua (o que vem antes do QD); complemento = QD/LT."""
    titulo = o["titulo"]
    corte = titulo.find(" QD ")
    rua = titulo[:corte].strip() if corte > 0 else titulo
    compl = titulo[corte:].strip() if corte > 0 else ""
    if rua:
        escrever(page, CAMPO["logradouro"], rua)
    if compl:
        escrever(page, CAMPO["complemento"], compl)
    try:
        escolher_na_lista(page, "#state", "Goi", alvo="Goiás")
        if o.get("cidade"):
            page.wait_for_timeout(900)
            escolher_na_lista(page, "#city", o["cidade"][:12], alvo=o["cidade"])
    except Exception as e:
        print(f"  ! estado/cidade: {str(e)[:110]}", flush=True)
    print(f"  endereço: logradouro='{rua}' complemento='{compl}'", flush=True)


def tem_conta_pedida(o):
    """Função PURA: uma conta foi PEDIDA para a obra — pela relação CONTA
    BANCÁRIA (`o["conta_exata"]`, ou a relação existe mas não se resolve:
    `o["conta_nao_resolvida"]`) ou pelo texto antigo da coluna CONTA
    (exceto vazio/"PESSOA FISICA"). Usada por `completar_no_mc` (decidir se
    abre a seção) e por `main` (decidir, no ramo "já existe no MC", se a
    obra precisa confirmar a conta antes de ser marcada "Criada")."""
    if o.get("conta_nao_resolvida"):
        return True
    conta_exata = (o.get("conta_exata") or "").strip()
    conta = (o.get("conta") or "").strip()
    return bool(conta_exata) or bool(conta and N(conta) != "PESSOA FISICA")


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
    if not conta or N(conta) == "PESSOA FISICA":
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
    cliente = escolher_na_lista(page, CAMPO["cliente"], o["cliente"][:25], alvo=o["cliente"])
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
        desmarcar_compras(page)
    except Exception as e:
        print(f"  ! Compras: {str(e)[:110]}", flush=True)

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
    if not conta_ok:
        # havia conta pedida (relação CONTA BANCÁRIA ou texto em CONTA) e não
        # foi escolhida na lista — não marco "Criada" (o dono revisita pelo
        # painel); aviso SEM o nome da conta (repo público).
        print(f"  ! {o['titulo']}: obra criada, mas a conta bancária pedida não foi escolhida — não marco 'Criada'", flush=True)
        return "criada_sem_conta"
    return "criada"


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
# =====================================================================
COL_MC_DATA = "MC ATUALIZADO EM"
LIMITE_POR_RODADA = 35
FIM = ("FINALIZADO", "CANCELADO", "CONCLUIDO")


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
        if conf and editada and (editada - conf).total_seconds() < 180:
            continue
        a1, a2 = txt(pega(pr, "ÁREA CONSTRUÍDA AVERBADA")), txt(pega(pr, "ÁREA PÓS HABITE-SE"))
        conta_exata, conta_numero, nao_resolvida = resolver_conta(prop_conta(pr), mapa_contas)
        fila.append({
            "id": pg["id"], "titulo": titulo, "conferida": bool(conf),
            "casas": txt(pega(pr, "Nº DE CASAS")),
            "area": ((a1 or 0) + (a2 or 0)) or None,
            "rt": txt(pega(pr, "ENGENHEIRO RT")),
            "resp": txt(pega(pr, "Responsável Pela Obra")),
            "cliente": txt(pega(pr, "Proprietário")),
            "cidade": txt(pega(pr, "Cidade")),
            "conta": txt(pega(pr, "CONTA")),
            "conta_exata": conta_exata,
            "conta_numero": conta_numero,
            "conta_nao_resolvida": nao_resolvida,
        })
    # as nunca conferidas por último: primeiro o que mudou de verdade
    fila.sort(key=lambda o: o["conferida"], reverse=True)
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


def completar_no_mc(page, o):
    abrir_edicao(page, o["titulo"])
    mudou = []

    n = int(o["casas"]) if isinstance(o["casas"], (int, float)) else 0
    # o valor do input é um id (uuid); o NOME do tipo fica no quadro do select.
    # Ler o "pai" inteiro trazia junto o rótulo "Tipo da obra", e a comparação
    # com "Genérico" nunca batia — por isso a PARAISO não teve o tipo trocado.
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
    if n in TIPOS and N(tipo_atual) != N(TIPOS[n]) and (not tipo_atual or N(tipo_atual) == N(TIPO_PADRAO)):
        try:
            escolher_na_lista(page, CAMPO["tipo"], "", alvo=TIPOS[n], exato=True)
            mudou.append(f"tipo {tipo_atual or '(vazio)'} -> {TIPOS[n]}")
        except Exception as e:
            print(f"  ! tipo: {str(e)[:90]}", flush=True)

    area_atual = valor_campo(page, CAMPO["area"])
    rt_atual, resp_atual = valor_campo(page, CAMPO["rt"]), valor_campo(page, CAMPO["resp"])
    if (o["area"] and area_atual in ("", "0", "0,00")) or (o["rt"] and not rt_atual) or (o["resp"] and not resp_atual):
        abrir_secao(page, "Dados gerais")
        if o["area"] and area_atual in ("", "0", "0,00"):
            escrever(page, CAMPO["area"], f"{float(o['area']):.2f}".replace(".", ","))
            mudou.append(f"área {o['area']}")
        if o["rt"] and not rt_atual:
            escrever(page, CAMPO["rt"], o["rt"]); mudou.append("responsável técnico")
        if o["resp"] and not resp_atual:
            escrever(page, CAMPO["resp"], o["resp"]); mudou.append("responsável da obra")

    if o["cliente"] and not valor_campo(page, CAMPO["cliente"]):
        abrir_secao(page, "Dados do cliente")
        try:
            c = escolher_na_lista(page, CAMPO["cliente"], o["cliente"][:25], alvo=o["cliente"])
            fechar_replicar(page)
            mudou.append(f"cliente {c}")
        except Exception as e:
            print(f"  ! cliente: {str(e)[:90]}", flush=True)

    if not valor_campo(page, CAMPO["logradouro"]) or not valor_campo(page, "#state"):
        abrir_secao(page, "Endereço")
        try:
            if not valor_campo(page, CAMPO["logradouro"]):
                preencher_endereco(page, o)
                mudou.append("endereço")
            elif not valor_campo(page, "#state"):
                escolher_na_lista(page, "#state", "Goi", alvo="Goiás")
                if o.get("cidade"):
                    page.wait_for_timeout(900)
                    escolher_na_lista(page, "#city", o["cidade"][:12], alvo=o["cidade"])
                mudou.append("estado/cidade")
        except Exception as e:
            print(f"  ! endereço: {str(e)[:90]}", flush=True)

    conta_pendente = False
    if o.get("conta_nao_resolvida"):
        # relação que não se resolve: mesmo com a conta do MC preenchida, não
        # dá para conferir que é a pedida — não conta como conferida/Criada
        conta_pendente = True
        print(f"  ! {o['titulo']}: conta bancária pedida pela relação não se resolve — não conto como conferida", flush=True)
    elif tem_conta_pedida(o) and not valor_campo(page, CAMPO["conta"]):
        abrir_secao(page, "Conta bancária padrão")
        try:
            if preencher_conta(page, o):
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
        return "conta não escolhida" if conta_pendente else "nada a completar"
    print(f"  {o['titulo']}: completando {', '.join(mudou)}", flush=True)
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
    # mesmo salvando os outros campos, a conta pedida (e não escolhida) não
    # pode "passar" como conferida — main() só marca conferida para
    # "completada"/"nada a completar", nunca para este status.
    return "conta não escolhida" if conta_pendente else "completada"


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
    ja_sem_conta = [o for o in ja if not tem_conta_pedida(o)]
    ja_com_conta = [o for o in ja if tem_conta_pedida(o)]
    for o in ja_sem_conta:
        print(f"  já existe no MC: {o['titulo']}" + (" -> marcada Criada" if APLICAR else ""), flush=True)
        if APLICAR:
            marcar_criada(o["id"])
    if ja_com_conta:
        print(f"  {len(ja_com_conta)} já existem no MC e pedem conta bancária — confiro antes de marcar Criada", flush=True)
    faltando = [o for o in fazer if not o["cliente"]]
    for o in faltando:
        print(f"  ! {o['titulo']}: sem Proprietário — pulei", flush=True)
    fazer = [o for o in fazer if o["cliente"]]

    garantir_coluna_data()
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
            for o in ja_com_conta:
                try:
                    r = completar_no_mc(page, o)
                    print(f"  {o['titulo']} (já existe, conferindo conta): {r}", flush=True)
                    if r != "conta não escolhida" and APLICAR:
                        marcar_criada(o["id"])
                        if r in ("completada", "nada a completar"):
                            marcar_conferida(o["id"])
                except Exception as e:
                    print(f"  ! {o['titulo']} (já existe, conferindo conta): {str(e)[:160]}", flush=True)
                    page.keyboard.press("Escape")
            for o in completar:
                try:
                    r = completar_no_mc(page, o)
                    print(f"  {o['titulo']}: {r}", flush=True)
                    if r in ("completada", "nada a completar") and APLICAR:
                        marcar_conferida(o["id"])
                except Exception as e:
                    print(f"  ! {o['titulo']} (completar): {str(e)[:160]}", flush=True)
                    page.keyboard.press("Escape")
            for o in fazer:
                try:
                    r = criar_no_mc(page, o)
                    print(f"  {o['titulo']}: {r}", flush=True)
                    if r in ("criada", "ja_existe") and APLICAR:
                        marcar_criada(o["id"])
                        try:
                            marcar_conferida(o["id"])
                        except Exception:
                            pass
                except Exception as e:
                    print(f"  ! {o['titulo']}: {str(e)[:160]}", flush=True)
                    foto(page, "erro_" + o["titulo"].replace(" ", "_"), sensivel=True)
                    page.keyboard.press("Escape")
        finally:
            b.close()
    print("APLICADO" if APLICAR else "SIMULAÇÃO — nada foi salvo no MC nem no Notion", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
