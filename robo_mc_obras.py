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

from robo_mc_comum import (N, foto, esperar, abrir, login, ir_menu, clicar_texto, input_por_rotulo, APLICAR)
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
    if t == "people":
        return ", ".join(x.get("name") or "" for x in v or [])
    if t == "number":
        return v
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
        fila.append({
            "id": pg["id"],
            "titulo": padronizar_endereco(txt(pega(pr, "Projeto"))),
            "casas": txt(pega(pr, "Nº DE CASAS")),
            # área do MC = averbada + pós habite-se (decidido em set/26)
            "area": (lambda a, b: (a or 0) + (b or 0) if (a or b) else None)(
                txt(pega(pr, "ÁREA CONSTRUÍDA AVERBADA")), txt(pega(pr, "ÁREA PÓS HABITE-SE"))),
            "rt": txt(pega(pr, "ENGENHEIRO RT")),
            "resp": txt(pega(pr, "Responsável Pela Obra")),
            "cliente": txt(pega(pr, "Proprietário")),
            "cidade": txt(pega(pr, "Cidade")),
            "conta": txt(pega(pr, "CONTA")),
        })
    return fila


def marcar_criada(pid):
    api("PATCH", f"/pages/{pid}", {"properties": {"MAIS CONTROLE": {"select": {"name": "Criada"}}}})


def escolher_opcao(page, gatilho_texto, opcao):
    """Abre um select/dropdown pelo texto que ele mostra e clica a opção."""
    page.get_by_text(gatilho_texto, exact=True).first.click()
    page.wait_for_timeout(500)
    page.get_by_text(opcao, exact=True).last.click()
    page.wait_for_timeout(400)


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
    campo = page.locator("#participants")
    (campo if campo.count() else page.locator("xpath=(//*[normalize-space(translate(text(),'*:',''))='Visível para']/following::input[1])[1]")).first.click()
    page.wait_for_timeout(700)
    busca = page.locator("input[placeholder*=usuário i]:visible, input[placeholder*=usuario i]:visible").first
    tirados = []
    for nome in fora:
        try:
            if busca.count():
                busca.fill(nome)
                page.wait_for_timeout(600)
            linha = page.locator("label:visible, li:visible").filter(has_text=nome).first
            cx = linha.locator("input[type=checkbox]")
            if cx.count() and cx.first.is_checked():
                linha.click(force=True)
                tirados.append(nome)
                page.wait_for_timeout(300)
        except Exception:
            continue
    if busca.count():
        busca.fill("")
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    print(f"  Visível para: mantive {manter or '(equipe não identificada)'}, tirei {tirados}", flush=True)


def preencher_endereco(page, o):
    """Logradouro = rua (o que vem antes do QD); complemento = QD/LT."""
    titulo = o["titulo"]
    corte = titulo.find(" QD ")
    rua = titulo[:corte].strip() if corte > 0 else titulo
    compl = titulo[corte:].strip() if corte > 0 else ""
    clicar_texto(page, "Endereço")
    page.wait_for_timeout(500)
    if rua:
        input_por_rotulo(page, "Logradouro").fill(rua)
    if compl:
        input_por_rotulo(page, "Complemento").fill(compl)
    try:
        estado = page.locator("#state:visible").first
        estado.click()
        estado.press_sequentially("Goi", delay=40)
        page.wait_for_timeout(1200)
        op = page.locator("li:visible, [role=option]:visible").filter(has_text="Goiás")
        (op.first if op.count() else page.get_by_text("Goiás", exact=False).last).click()
        page.wait_for_timeout(900)
        if o.get("cidade"):
            cid = page.locator("#city:visible").first
            cid.click()
            cid.press_sequentially(o["cidade"][:10], delay=40)
            page.wait_for_timeout(1200)
            opc = page.locator("li:visible, [role=option]:visible").filter(has_text=o["cidade"][:8])
            if opc.count():
                opc.first.click()
    except Exception as e:
        print(f"  ! estado/cidade não escolhidos: {str(e)[:90]}", flush=True)
    print(f"  endereço: logradouro='{rua}' complemento='{compl}'", flush=True)


def preencher_conta(page, o):
    """Quem paga = Cliente; Conta = a CONTA da obra (vem do cadastro)."""
    clicar_texto(page, "Conta bancária padrão")
    page.wait_for_timeout(500)
    try:
        escolher_opcao(page, "Selecione quem paga", "Cliente")
    except Exception as e:
        print(f"  ! 'Quem paga' não escolhido: {str(e)[:80]}", flush=True)
    conta = (o.get("conta") or "").strip()
    if not conta or N(conta) == "PESSOA FISICA":
        print("  conta bancária: obra sem CONTA no Notion — deixei em branco", flush=True)
        return
    campo = page.locator("#select-single-account-visible:visible").first
    if not campo.count():
        campo = page.locator("xpath=(//*[normalize-space(translate(text(),'*:',''))='Conta']/following::input[1])[1]")
    campo.first.click()
    campo.first.press_sequentially(conta[:25], delay=35)
    page.wait_for_timeout(1500)
    op = page.locator("li:visible, [role=option]:visible").filter(has_text=conta.split()[0])
    if op.count():
        op.first.click()
        print(f"  conta bancária: {conta}", flush=True)
    else:
        print(f"  ! conta '{conta}' não apareceu na busca do MC", flush=True)


def criar_no_mc(page, o):
    ir_menu(page, "Obras", "Minhas Obras")
    clicar_texto(page, "Nova Obra", exato=False)
    page.wait_for_timeout(1200)
    input_por_rotulo(page, "Nome da obra").fill(o["titulo"])

    n = int(o["casas"]) if isinstance(o["casas"], (int, float)) else 0
    if n not in TIPOS:
        # sem Nº DE CASAS: entra como genérico e a rotina de atualização
        # troca pelo tipo certo quando o número for preenchido no portal
        try:
            escolher_opcao(page, "Selecione um tipo", TIPO_PADRAO)
        except Exception as e:
            print(f"  ! tipo genérico não escolhido: {str(e)[:80]}", flush=True)
    if n in TIPOS:
        try:
            escolher_opcao(page, "Selecione um tipo", TIPOS[n])
        except Exception:
            # tipo que ainda não existe no MC (ex.: "5 casas"): cria pelo
            # "+ Novo tipo" do próprio formulário
            try:
                print(f"  tipo '{TIPOS[n]}' não existe no MC — criando", flush=True)
                page.keyboard.press("Escape")
                clicar_texto(page, "Novo tipo", exato=False)
                page.wait_for_timeout(700)
                novo = page.locator("input:visible").last
                novo.press_sequentially(TIPOS[n], delay=30)
                for rot in ["Salvar", "Adicionar", "Confirmar", "OK"]:
                    bt = page.get_by_text(rot, exact=False)
                    if bt.count():
                        bt.last.click()
                        break
                page.wait_for_timeout(1200)
            except Exception as e2:
                print(f"  ! tipo da obra não escolhido ({TIPOS[n]}): {str(e2)[:100]}", flush=True)

    # ---- Visível para: tira quem não é da equipe do responsável ----
    try:
        ajustar_visiveis(page, o.get("resp") or "")
    except Exception as e:
        print(f"  ! Visível para não ajustado: {str(e)[:110]}", flush=True)

    try:
        clicar_texto(page, "Dados gerais")
        if o["area"]:
            input_por_rotulo(page, "Área total").fill(f"{float(o['area']):.2f}".replace(".", ","))
        if o["rt"]:
            input_por_rotulo(page, "Responsável técnico").fill(o["rt"])
        if o["resp"]:
            input_por_rotulo(page, "Responsável da obra").fill(o["resp"])
    except Exception as e:
        print(f"  ! dados gerais não preenchidos: {str(e)[:100]}", flush=True)

    clicar_texto(page, "Dados do cliente")
    page.wait_for_timeout(800)
    try:
        campos = page.evaluate("""() => [...document.querySelectorAll("input,select,textarea")]
            .filter(e => e.offsetWidth || e.offsetHeight)
            .map(e => `${e.tagName.toLowerCase()}#${e.id||"-"} ph="${e.placeholder||""}"${e.disabled?" DESABILITADO":""}`)""")
        print(f"  campos visíveis no formulário: {campos}", flush=True)
    except Exception:
        pass
    # O campo "Cliente" é um combobox: o <input> fica DESABILITADO até alguém
    # clicar na caixa — era nele que a primeira versão tentava digitar.
    # O campo CERTO é o que vem logo depois do rótulo "Cliente". Pegar o
    # último "Digite para buscar" da tela era errado: esse mesmo texto está no
    # "Visível para" (#participants), no endereço e na conta bancária — e
    # escrever no "Visível para", que é obrigatório, é o que fazia o MC
    # recusar o cadastro sem dizer nada.
    campo = page.locator(
        "xpath=(//*[normalize-space(translate(text(),'*:',''))='Cliente']/following::input[1])[1]")
    if not campo.count():
        campo = page.locator("input[placeholder*=buscar i]").last
    try:
        print(f"  campo do Cliente: #{campo.get_attribute('id') or '-'}", flush=True)
    except Exception:
        pass
    ativo = None
    if campo.count() and not campo.is_disabled():
        ativo = campo
    else:
        # combobox fechado: clica do elemento mais próximo do input para fora,
        # até o campo de busca ficar habilitado
        ancestrais = campo.locator("xpath=ancestor::*[position()<=4]")
        for i in range(ancestrais.count() - 1, -1, -1):
            try:
                ancestrais.nth(i).click(force=True)
            except Exception:
                continue
            page.wait_for_timeout(600)
            livre = page.locator("input[placeholder*=buscar i]:not([disabled]):visible")
            if livre.count():
                ativo = livre.last
                break
        if ativo is None:   # última tentativa: clicar no rótulo "Cliente"
            try:
                page.locator("xpath=//*[normalize-space(text())='Cliente']/following::*[1]").first.click(force=True)
                page.wait_for_timeout(600)
                livre = page.locator("input[placeholder*=buscar i]:not([disabled]):visible")
                ativo = livre.last if livre.count() else None
            except Exception:
                ativo = None
    if ativo is None:
        foto(page, "cliente_sem_campo")
        raise RuntimeError("não consegui abrir a caixa de busca do Cliente — veja o print cliente_sem_campo")
    ativo.click()
    ativo.press_sequentially(o["cliente"][:25], delay=35)
    page.wait_for_timeout(1800)
    # o que apareceu de opção na tela (vai para o log — ajuda a acertar o seletor)
    try:
        vis = page.evaluate("""() => [...document.querySelectorAll("li,[role=option],.ui-select-choices-row,.dropdown-item,.md-autocomplete-suggestions li,mat-option")]
            .filter(e => e.offsetWidth || e.offsetHeight).map(e => e.innerText.trim()).filter(Boolean).slice(0, 12)""")
        print(f"  opções visíveis depois de digitar: {vis}", flush=True)
    except Exception:
        pass
    opc = page.get_by_text(o["cliente"], exact=True).locator("visible=true")
    if not opc.count():
        # mesmo nome com acento/caixa/espaço diferente: só opções VISÍVEIS
        opc = page.locator("li:visible, [role=option]:visible, .ui-select-choices-row:visible, .dropdown-item:visible, mat-option:visible")
        for palavra in o["cliente"].split()[:3]:
            if opc.count() > 1:
                opc = opc.filter(has_text=palavra)
    if not opc.count():
        foto(page, "cliente_nao_achado")
        raise RuntimeError(f"cliente '{o['cliente']}' não apareceu na busca do MC — o robô de clientes "
                           "precisa rodar com aplicar antes (o Proprietário tem que estar com o nome do MC)")
    opc.first.click()
    page.wait_for_timeout(600)
    # confere que o "Visível para" (obrigatório) continua preenchido
    try:
        vp = page.locator("#participants")
        if vp.count():
            print(f"  Visível para: {(vp.first.input_value() or '(vazio)')[:60]}", flush=True)
    except Exception:
        pass
    foto(page, "nova_obra_" + o["titulo"].replace(" ", "_"))

    # ---- Endereço: logradouro + complemento (QD/LT) + estado/cidade ----
    try:
        preencher_endereco(page, o)
    except Exception as e:
        print(f"  ! endereço não preenchido: {str(e)[:110]}", flush=True)

    # ---- Conta bancária padrão: quem paga = Cliente, conta = a do Notion ----
    try:
        preencher_conta(page, o)
    except Exception as e:
        print(f"  ! conta bancária não preenchida: {str(e)[:110]}", flush=True)

    # ---- Exibir obra para: desmarca "Compras" ----
    try:
        clicar_texto(page, "Exibir obra para")
        page.wait_for_timeout(500)
        alvo = page.locator("xpath=(//*[normalize-space(text())='Compras']/following::input[@type='checkbox'][1])[1]")
        if alvo.count() and alvo.first.is_checked():
            alvo.first.click(force=True)
        else:
            bt = page.locator("xpath=(//*[normalize-space(text())='Compras']/following::*[self::button or @role='switch'][1])[1]")
            if bt.count():
                bt.first.click(force=True)
        page.wait_for_timeout(400)
    except Exception as e:
        print(f"  ! 'Compras' não desmarcado: {str(e)[:110]}", flush=True)

    foto(page, "antes_salvar_" + o["titulo"].replace(" ", "_"))
    if not APLICAR:
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)
        return "simulado"

    # "Salvar Obra" é o botão do rodapé do painel: precisa rolar até ele e
    # clicar à força (o rodapé fica fixo e às vezes cobre o alvo).
    import re as _re
    salvar = page.locator("button:visible, a:visible").filter(has_text=_re.compile(r"salvar\s+obra", _re.I)).last
    if not salvar.count():
        salvar = page.get_by_text("Salvar Obra", exact=False).last
    salvar.scroll_into_view_if_needed()
    page.wait_for_timeout(400)
    salvar.click(force=True)
    esperar(page, 20000)
    page.wait_for_timeout(2000)
    foto(page, "pos_salvar_" + o["titulo"].replace(" ", "_"))
    # O painel "Nova Obra" fechar é o sinal de que o MC aceitou o cadastro.
    fechou = True
    try:
        page.wait_for_selector("text=Salvar Obra", state="hidden", timeout=20000)
    except Exception:
        fechou = False
    # a lista às vezes demora a mostrar a obra nova; serve de confirmação extra
    achou = False
    try:
        busca = page.locator("input[placeholder*=Busque i]:visible, input[placeholder*=busca i]:visible").first
        for _ in range(3):
            busca.fill(o["titulo"])
            page.wait_for_timeout(2500)
            if page.get_by_text(o["titulo"], exact=False).count():
                achou = True
                break
    except Exception:
        pass
    if fechou:
        print(f"  {o['titulo']}: painel fechou (salvo)" + ("" if achou else " — ainda não apareceu na busca da lista"), flush=True)
        return "criada"
    raise RuntimeError("cliquei em Salvar Obra mas o painel continuou aberto — confira no MC e veja o print pos_salvar")


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
