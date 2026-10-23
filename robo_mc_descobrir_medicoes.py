#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
robo_mc_descobrir_medicoes.py — PORTAL-MORAIS · SÓ LEITURA (23/10/26)

Levantamento para o Mapa de Obras mostrar as medições de TODOS os contratos em
aberto de cada obra (mestre, pintor, eletricista…), e não só do MESTRE da base
DOCUMENTOS. Entra no Mais Controle como os outros robôs, abre Obras > Medição
de Contratos e registra QUAIS chamadas de API a tela faz e o FORMATO das
respostas (nomes de campos, quantidade de itens). Não grava nada e não imprime
valores (o log e o ramo de resultado deste repositório são públicos).
"""
import json
import re
import sys
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

import robo_mc_comum as mc

RX_ID = re.compile(r"/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|/\d{2,}", re.I)
VISTOS = {}


def estrutura(v, nivel=0):
    if isinstance(v, dict):
        if nivel >= 3:
            return "{%d campos}" % len(v)
        return {k: estrutura(x, nivel + 1) for k, x in list(v.items())[:50]}
    if isinstance(v, list):
        return ["lista[%d]" % len(v)] + ([estrutura(v[0], nivel + 1)] if v else [])
    return type(v).__name__


def ligar(page):
    def _resp(r):
        try:
            u = urlparse(r.url)
            if "maiscontroleerp.com.br" not in u.netloc or u.netloc.startswith("acessar"):
                return
            if r.request.resource_type not in ("xhr", "fetch"):
                return
            chave = f"{r.request.method} {u.netloc.split('.')[0]} {RX_ID.sub('/{id}', u.path)}"
            params = sorted(set(re.findall(r"([A-Za-z_]+)=", u.query or "")))
            info = VISTOS.setdefault(chave, {"n": 0, "status": set(), "params": set(), "corpo": None})
            info["n"] += 1
            info["status"].add(r.status)
            info["params"].update(params)
            if info["corpo"] is None and r.ok and "json" in (r.headers.get("content-type") or ""):
                try:
                    info["corpo"] = estrutura(r.json())
                except Exception:
                    info["corpo"] = "(json ilegível)"
        except Exception:
            pass
    page.on("response", _resp)


def despejar(titulo):
    print(f"\n===== {titulo} — {len(VISTOS)} chamadas distintas =====", flush=True)
    for k in sorted(VISTOS):
        i = VISTOS[k]
        print(f"{k}  x{i['n']}  status={sorted(i['status'])}  params={sorted(i['params'])}")
        if i["corpo"] is not None:
            print("    " + json.dumps(i["corpo"], ensure_ascii=False)[:2500])
    VISTOS.clear()


def cabecalhos(page):
    try:
        ths = page.locator("th:visible, [role=columnheader]:visible").all_inner_texts()
        print("colunas visíveis:", [t.strip() for t in ths if t.strip()][:30])
        abas = page.locator("[role=tab]:visible").all_inner_texts()
        print("abas visíveis:", [t.strip() for t in abas if t.strip()][:20])
        print("url:", page.url.split("?")[0])
    except Exception as e:
        print("sem cabeçalhos:", str(e)[:100])


def main():
    with sync_playwright() as p:
        b, page = mc.abrir(p)
        try:
            mc.login(page)
            print("login ok", flush=True)
            ligar(page)
            VISTOS.clear()
            # a tela abre por rota (o menu lateral não responde na tela de onboarding)
            for rota in ("#/work-measurements", "#/contracts", "#/measurements", "#/work-contracts",
                         "#/contract-measurements", "#/work-measurement"):
                try:
                    page.evaluate("h => { location.hash = h }", rota)
                    page.wait_for_timeout(6000)
                    print(f"\n--- rota {rota} -> {page.url.split('#')[-1][:80]}", flush=True)
                    cabecalhos(page)
                    despejar(f"rota {rota}")
                    if page.locator("th:visible, [role=columnheader]:visible").count():
                        break
                except Exception as e:
                    print(f"rota {rota}: {str(e)[:100]}")
            try:
                mc.ir_menu(page, "Obras", "Medição de Contratos")
                page.wait_for_timeout(6000)
                cabecalhos(page)
                despejar("LISTA de Medição de Contratos (menu)")
            except Exception as e:
                print("menu Obras > Medição de Contratos:", str(e)[:120])

            # abre o primeiro contrato da lista
            alvo = page.locator("tbody tr:visible, [role=row]:visible").nth(1)
            try:
                alvo.click(timeout=8000)
            except Exception:
                try:
                    page.locator("a:visible").filter(has_text=re.compile(r"\d")).first.click(timeout=5000)
                except Exception as e:
                    print("não consegui abrir um contrato:", str(e)[:120])
            page.wait_for_timeout(6000)
            cabecalhos(page)
            despejar("CONTRATO aberto (aba Serviços)")
            for aba in ("Medições", "Pagamentos"):
                try:
                    page.get_by_text(aba, exact=True).first.click(timeout=5000)
                    page.wait_for_timeout(4000)
                    cabecalhos(page)
                    despejar(f"CONTRATO — aba {aba}")
                except Exception as e:
                    print(f"aba {aba} não abriu:", str(e)[:100])
        finally:
            b.close()


if __name__ == "__main__":
    sys.exit(main())
