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
    """Escreve num campo do formulário. O MC cobre os campos com camadas do
    Material UI, e o clique normal do Playwright fica esperando o campo ficar
    "livre" até estourar o tempo — escrever pelo próprio DOM, disparando os
    eventos que o React escuta, funciona sempre."""
    el = page.locator(sel).first
    el.scroll_into_view_if_needed()
    el.evaluate(JS_SET, valor)
    page.wait_for_timeout(250)


def escolher_na_lista(page, campo_sel, texto_busca, alvo=None, exato=False):
    """Abre a lista do campo, digita (quando o campo aceita busca) e clica na
    opção. Devolve o texto da opção escolhida."""
    campo = page.locator(campo_sel).first
    campo.scroll_into_view_if_needed()
    try:
        campo.click(force=True, timeout=8000)      # abre a lista (selects)
    except Exception:
        pass
    page.wait_for_timeout(600)
    if texto_busca:
        campo.evaluate(JS_SET, texto_busca)        # busca (autocompletes)
        page.wait_for_timeout(1600)
    opcoes = page.locator("[role=listbox] [role=option], [role=listbox] li")
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


def ajustar_visiveis(page, resp):
    """Deixa marcados só os usuários da equipe do responsável pela obra."""
    manter = []
    for eng, nomes in EQUIPES.items():
        if N(eng) in N(resp) or N(resp) in N(eng):
            manter = nomes
    fora = [n for eng, nomes in EQUIPES.items() for n in nomes if n not in manter]
    if not fora:
        print("  Visível para: responsável fora das equipes conhecidas — deixei como está", flush=True)
        return
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
    escolhida = escolher_na_lista(page, CAMPO["conta"], conta[:25], alvo=conta)
    print(f"  conta bancária: {escolhida}", flush=True)


def desmarcar_compras(page):
    """Terceiro interruptor de 'Exibir obra para' (Lançamentos, Faturamentos,
    Compras). Os dois primeiros têm name; o de Compras não, então vai pela ordem."""
    cxs = page.locator("input[type=checkbox]:visible")
    if cxs.count() >= 3:
        alvo = cxs.nth(2)
        if alvo.is_checked():
            alvo.click(force=True)
            print("  Exibir obra para: Compras desmarcado", flush=True)


def criar_no_mc(page, o):
    ir_menu(page, "Obras", "Minhas Obras")
    page.wait_for_timeout(1500)
    clicar_texto(page, "Nova Obra", exato=False)
    page.locator(CAMPO["nome"]).wait_for(state="visible", timeout=15000)

    escrever(page, CAMPO["nome"], o["titulo"])

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

    try:
        if o["area"]:
            escrever(page, CAMPO["area"], f"{float(o['area']):.2f}".replace(".", ","))
        if o["rt"]:
            escrever(page, CAMPO["rt"], o["rt"])
        if o["resp"]:
            escrever(page, CAMPO["resp"], o["resp"])
    except Exception as e:
        print(f"  ! dados gerais: {str(e)[:110]}", flush=True)

    cliente = escolher_na_lista(page, CAMPO["cliente"], o["cliente"][:25], alvo=o["cliente"])
    print(f"  cliente: {cliente}", flush=True)

    try:
        preencher_endereco(page, o)
    except Exception as e:
        print(f"  ! endereço: {str(e)[:110]}", flush=True)
    try:
        preencher_conta(page, o)
    except Exception as e:
        print(f"  ! conta: {str(e)[:110]}", flush=True)
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
    salvar.click(force=True)
    try:
        page.locator(CAMPO["nome"]).wait_for(state="hidden", timeout=25000)
    except Exception:
        erro = ""
        try:
            erro = page.evaluate("""() => [...document.querySelectorAll('.Mui-error,[class*=error i],[role=alert]')]
                .filter(e => e.offsetWidth||e.offsetHeight).map(e => e.innerText.trim()).filter(Boolean).join(' | ').slice(0,300)""")
        except Exception:
            pass
        foto(page, "erro_salvar_" + o["titulo"].replace(" ", "_"))
        raise RuntimeError(f"o painel continuou aberto depois de Salvar Obra. Erros na tela: {erro or '(nenhum)'}")
    foto(page, "pos_salvar_" + o["titulo"].replace(" ", "_"))
    return "criada"


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
    if not fazer:
        return 0
    with sync_playwright() as p:
        b, page = abrir(p)
        try:
            login(page)
            for o in fazer:
                try:
                    r = criar_no_mc(page, o)
                    print(f"  {o['titulo']}: {r}", flush=True)
                    if r == "criada":
                        marcar_criada(o["id"])
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
