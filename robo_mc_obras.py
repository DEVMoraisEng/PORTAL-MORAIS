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

from robo_mc_comum import N, foto, abrir, login, ir_menu, clicar_texto, APLICAR
from fetch_vendas import ler_banco, api
from fetch_obras import obras_no_mc, padronizar_endereco

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


def fila_de_obras():
    fila = []
    for pg in ler_banco(ID_OBRAS, "OBRAS"):
        pr = pg.get("properties") or {}
        if N(txt(pega(pr, "MAIS CONTROLE"))) != "CRIAR":
            continue
        a1, a2 = txt(pega(pr, "ÁREA CONSTRUÍDA AVERBADA")), txt(pega(pr, "ÁREA PÓS HABITE-SE"))
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


def escolher_na_lista(page, campo_sel, texto_busca, alvo=None, exato=False):
    """Abre a lista do campo, digita (quando o campo aceita busca) e clica na
    opção. Devolve o texto da opção escolhida."""
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
    for i, t in enumerate(textos):
        if N(t) == N(alvo):
            escolha = i
            break
    if escolha is None and not exato:
        # melhor parecido: mais palavras em comum (o MC às vezes guarda o nome
        # sem o "LTDA" que existe no cadastro do Notion)
        pal = set(N(alvo).split())
        notas = [(len(pal & set(N(t).split())), i) for i, t in enumerate(textos)]
        notas.sort(reverse=True)
        if notas and notas[0][0] >= 2:
            escolha = notas[0][1]
    if escolha is None:
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


def preencher_conta(page, o):
    """Quem paga = Cliente; Conta = a CONTA da obra (vem do cadastro)."""
    try:
        escolher_na_lista(page, CAMPO["quem_paga"], "", alvo="Cliente", exato=True)
    except Exception as e:
        print(f"  ! 'Quem paga': {str(e)[:110]}", flush=True)
    conta = (o.get("conta") or "").strip()
    if not conta or N(conta) == "PESSOA FISICA":
        print("  conta bancária: obra sem CONTA no Notion — deixei em branco", flush=True)
        return
    # a busca do MC é por pedaço do nome: "MORAIS INCORPORACOES SENADOR..." acha,
    # a linha inteira da CONTA (com "- Conta corrente: 1234-5 - SICOOB") não acha
    tentativas = [conta.split(" - ")[0][:22], " ".join(conta.split()[:2]), conta.split()[0]]
    for t in [x for x in tentativas if x]:
        try:
            escolhida = escolher_na_lista(page, CAMPO["conta"], t, alvo=conta)
            print(f"  conta bancária: {escolhida}", flush=True)
            return
        except Exception as e:
            ultimo = str(e)[:110]
    print(f"  ! conta '{conta}' não foi escolhida ({ultimo}) — ficou em branco", flush=True)


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
    ir_menu(page, "Obras", "Minhas Obras")
    page.wait_for_timeout(1500)
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
    try:
        preencher_conta(page, o)
    except Exception as e:
        print(f"  ! conta: {str(e)[:110]}", flush=True)
    abrir_secao(page, "Exibir obra para")
    try:
        desmarcar_compras(page)
    except Exception as e:
        print(f"  ! Compras: {str(e)[:110]}", flush=True)

    foto(page, "antes_salvar_" + o["titulo"].replace(" ", "_"))
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
        foto(page, "erro_salvar_" + o["titulo"].replace(" ", "_"))
        raise RuntimeError(f"o painel continuou aberto depois de Salvar Obra. Erros na tela: {erro or '(nenhum)'} "
                           f"| rede: {rede or '(sem chamadas)'}")
    print(f"  salvou — rede: {rede or '(sem chamadas registradas)'}", flush=True)
    foto(page, "pos_salvar_" + o["titulo"].replace(" ", "_"))
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


def fila_atualizar(no_mc):
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
        fila.append({
            "id": pg["id"], "titulo": titulo, "conferida": bool(conf),
            "casas": txt(pega(pr, "Nº DE CASAS")),
            "area": ((a1 or 0) + (a2 or 0)) or None,
            "rt": txt(pega(pr, "ENGENHEIRO RT")),
            "resp": txt(pega(pr, "Responsável Pela Obra")),
            "cliente": txt(pega(pr, "Proprietário")),
            "cidade": txt(pega(pr, "Cidade")),
            "conta": txt(pega(pr, "CONTA")),
        })
    # as nunca conferidas por último: primeiro o que mudou de verdade
    fila.sort(key=lambda o: o["conferida"], reverse=True)
    return fila


def abrir_edicao(page, titulo):
    ir_menu(page, "Obras", "Minhas Obras")
    page.wait_for_timeout(1200)
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
    page.wait_for_timeout(800)


def valor_campo(page, sel):
    try:
        return (page.locator(sel).first.input_value() or "").strip()
    except Exception:
        return ""


def completar_no_mc(page, o):
    abrir_edicao(page, o["titulo"])
    mudou = []

    n = int(o["casas"]) if isinstance(o["casas"], (int, float)) else 0
    tipo_atual = ""
    try:
        tipo_atual = page.locator(CAMPO["tipo"]).first.locator("xpath=..").inner_text().strip()
    except Exception:
        pass
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

    conta = (o.get("conta") or "").strip()
    if conta and N(conta) != "PESSOA FISICA" and not valor_campo(page, CAMPO["conta"]):
        abrir_secao(page, "Conta bancária padrão")
        try:
            preencher_conta(page, o)
            mudou.append("conta bancária")
        except Exception as e:
            print(f"  ! conta: {str(e)[:90]}", flush=True)

    if not mudou:
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)
        return "nada a completar"
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
        foto(page, "erro_completar_" + o["titulo"].replace(" ", "_"))
        raise RuntimeError("o painel de edição continuou aberto depois de Salvar Obra")
    return "completada"


def main():
    fila = fila_de_obras()
    no_mc = obras_no_mc() or set()
    ja = [o for o in fila if o["titulo"] in no_mc]
    fazer = [o for o in fila if o["titulo"] not in no_mc]
    print(f"Fila: {len(fila)} obras marcadas 'Criar' — {len(ja)} já existem no MC, {len(fazer)} para criar", flush=True)
    for o in ja:
        print(f"  já existe no MC: {o['titulo']}" + (" -> marcada Criada" if APLICAR else ""), flush=True)
        if APLICAR:
            marcar_criada(o["id"])
    faltando = [o for o in fazer if not o["cliente"]]
    for o in faltando:
        print(f"  ! {o['titulo']}: sem Proprietário — pulei", flush=True)
    fazer = [o for o in fazer if o["cliente"]]

    garantir_coluna_data()
    completar = fila_atualizar(no_mc)[:LIMITE_POR_RODADA]
    print(f"Completar: {len(completar)} obras do MC para conferir nesta rodada", flush=True)
    if not fazer and not completar:
        return 0
    with sync_playwright() as p:
        b, page = abrir(p)
        try:
            login(page)
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
                    foto(page, "erro_" + o["titulo"].replace(" ", "_"))
                    page.keyboard.press("Escape")
        finally:
            b.close()
    print("APLICADO" if APLICAR else "SIMULAÇÃO — nada foi salvo no MC nem no Notion", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
