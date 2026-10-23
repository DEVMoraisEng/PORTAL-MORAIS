# -*- coding: utf-8 -*-
"""Só LEITURA — descobre como o Mais Controle entrega a tela Obras > Medição de Contratos.

1) baixa o código do site (acessar.maiscontroleerp.com.br) e lista os caminhos de API que
   falam de contrato / medição;
2) com o login do robô, testa esses caminhos e mostra SÓ a estrutura da resposta
   (status HTTP, nomes dos campos e quantidade de itens) — nenhum valor é impresso,
   porque o log deste repositório é público.

    python -m venda.mc.descobrir_medicoes
"""
import json
import os
import re
import sys

import requests

from .erp import CORE, LEGACY, ORIGEM, USER_AGENT, Erp, ErpErro

PALAVRAS = ("contract", "measur", "medic", "medi")


def baixar_codigo() -> str:
    h = {"user-agent": USER_AGENT}
    html = requests.get(ORIGEM + "/", headers=h, timeout=60).text
    scripts = set(re.findall(r'src="([^"]+\.js)"', html)) | set(re.findall(r"src='([^']+\.js)'", html))
    print("scripts:", len(scripts))
    texto = ""
    vistos = set()
    fila = [s if s.startswith("http") else ORIGEM + "/" + s.lstrip("/") for s in scripts]
    while fila and len(vistos) < 80:
        u = fila.pop(0)
        if u in vistos:
            continue
        vistos.add(u)
        try:
            t = requests.get(u, headers=h, timeout=90).text
        except requests.RequestException as e:
            print("  ! não baixou", u.split("/")[-1], str(e)[:80])
            continue
        texto += "\n" + t
        # pedaços carregados sob demanda (webpack/vite)
        for m in re.findall(r'["\']((?:static/js/|assets/|js/)?[\w.\-]+\.chunk\.js)["\']', t):
            fila.append(ORIGEM + "/" + m.lstrip("/"))
        for m in re.findall(r'["\'](assets/[\w.\-]+\.js)["\']', t):
            fila.append(ORIGEM + "/" + m)
    print("arquivos JS lidos:", len(vistos), "· tamanho:", len(texto))
    return texto


def caminhos(texto: str) -> list[str]:
    achados = set()
    for m in re.finditer(r'["`\']((?:/|\$\{[^}]{0,40}\}/)?[A-Za-z0-9_\-${}./]{3,120})["`\']', texto):
        s = m.group(1)
        b = s.lower()
        if any(p in b for p in PALAVRAS) and "/" in s and " " not in s and not b.endswith((".js", ".css", ".png", ".svg")):
            achados.add(s)
    return sorted(achados)


def estrutura(v, nivel=0):
    if isinstance(v, dict):
        if nivel >= 2:
            return "{…%d campos}" % len(v)
        return {k: estrutura(x, nivel + 1) for k, x in list(v.items())[:40]}
    if isinstance(v, list):
        return ["lista com %d itens" % len(v)] + ([estrutura(v[0], nivel + 1)] if v else [])
    return type(v).__name__


def testar(erp: Erp, caminho: str, core=False):
    try:
        r = (erp.pedir_core if core else erp.pedir)("GET", caminho, params={"page": 0, "size": 5})
        print("  OK  ", ("CORE " if core else "LEG  ") + caminho)
        print("       ", json.dumps(estrutura(r), ensure_ascii=False)[:1500])
        return r
    except ErpErro as e:
        msg = str(e)
        cod = re.search(r"HTTP (\d+)", msg)
        print("  --  ", ("CORE " if core else "LEG  ") + caminho, "->", cod.group(1) if cod else msg[:80])
        return None


def main() -> int:
    texto = ""
    try:
        texto = baixar_codigo()
    except Exception as e:
        print("não consegui baixar o código do site:", str(e)[:200])
    lista = caminhos(texto) if texto else []
    print("\n=== caminhos no código do site com contrato/medição (%d) ===" % len(lista))
    for c in lista[:400]:
        print("  ", c)

    erp = Erp((os.environ.get("MC_ROBO_EMAIL") or "").strip(), (os.environ.get("MC_ROBO_SENHA") or "").strip("\r\n"),
              aparelho=os.environ.get("MC_ROBO_APARELHO", "").strip())
    erp.logar()
    print("\n=== testes (só estrutura) ===")
    candidatos = [c for c in lista if "${" not in c and c.startswith("/")][:60]
    candidatos += ["/contracts", "/work-contracts", "/service-contracts", "/contract-measurements",
                   "/measurements", "/works/contracts", "/supplier-contracts"]
    feitos = set()
    for c in candidatos:
        c = c.split("?")[0]
        if c in feitos:
            continue
        feitos.add(c)
        testar(erp, c)
        testar(erp, c, core=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
