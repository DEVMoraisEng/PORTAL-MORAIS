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
TIPOS = {1: "Casa", 2: "2 casas", 3: "3 casas", 4: "4 casas"}


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
            "area": txt(pega(pr, "ÁREA CONSTRUÍDA AVERBADA")),
            "rt": txt(pega(pr, "ENGENHEIRO RT")),
            "resp": txt(pega(pr, "Responsável Pela Obra")),
            "cliente": txt(pega(pr, "Proprietário")),
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


def criar_no_mc(page, o):
    ir_menu(page, "Obras", "Minhas Obras")
    clicar_texto(page, "Nova Obra", exato=False)
    page.wait_for_timeout(1200)
    input_por_rotulo(page, "Nome da obra").fill(o["titulo"])

    n = int(o["casas"]) if isinstance(o["casas"], (int, float)) else 0
    if n in TIPOS:
        try:
            escolher_opcao(page, "Selecione um tipo", TIPOS[n])
        except Exception as e:
            print(f"  ! tipo da obra não escolhido ({TIPOS[n]}): {str(e)[:80]}", flush=True)

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
    page.wait_for_timeout(600)
    # O campo "Cliente" é um combobox: o <input> fica DESABILITADO até alguém
    # clicar na caixa — era nele que a primeira versão tentava digitar.
    campo = page.locator("input[placeholder*=buscar i]").last
    if campo.is_disabled():
        caixa = campo.locator("xpath=ancestor::*[contains(@class,'select') or contains(@class,'combo') "
                              "or contains(@class,'autocomplete') or @role='combobox'][1]")
        (caixa if caixa.count() else campo.locator("xpath=..")).first.click(force=True)
        page.wait_for_timeout(700)
        ativo = page.locator("input[placeholder*=buscar i]:not([disabled])").last
        if ativo.count():
            ativo.press_sequentially(o["cliente"][:25], delay=30)
        else:
            page.keyboard.type(o["cliente"][:25], delay=30)
    else:
        campo.press_sequentially(o["cliente"][:25], delay=30)
    page.wait_for_timeout(1800)
    opc = page.get_by_text(o["cliente"], exact=True)
    if not opc.count():
        # mesmo nome com acento/caixa diferente
        opc = page.locator("li, [role=option], .ui-select-choices-row, .dropdown-item").filter(
            has_text=o["cliente"].split()[0])
        opc = opc.filter(has_text=o["cliente"].split()[-1]) if opc.count() > 1 else opc
    if not opc.count():
        foto(page, "cliente_nao_achado")
        raise RuntimeError(f"cliente '{o['cliente']}' não apareceu na busca do MC — o robô de clientes "
                           "precisa rodar com aplicar antes (o Proprietário tem que estar com o nome do MC)")
    opc.last.click()
    page.wait_for_timeout(500)
    foto(page, "nova_obra_" + o["titulo"].replace(" ", "_"))

    if not APLICAR:
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)
        return "simulado"

    clicar_texto(page, "Salvar Obra")
    esperar(page, 20000)
    page.wait_for_timeout(2000)
    foto(page, "pos_salvar_" + o["titulo"].replace(" ", "_"))
    # confere na lista
    busca = page.locator("input[placeholder*=Busque i], input[placeholder*=busca i]").first
    busca.fill(o["titulo"])
    page.wait_for_timeout(2000)
    if page.get_by_text(o["titulo"], exact=True).count():
        return "criada"
    raise RuntimeError("salvou, mas a obra não apareceu na lista — confira no MC")


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
