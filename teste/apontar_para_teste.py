"""Aponta o fork de TESTE (MoraisEng-Teste/PORTAL-MORAIS) para a BRAIN TESTE e
para o Apps Script PORTAL-TESTE. SÓ roda no fork; esta pasta nunca vai para a
produção. Rodar de novo depois de cada sincronização do fork com a produção.

Uso: python teste/apontar_para_teste.py --exec https://script.google.com/macros/s/<id>/exec
"""
import argparse
import pathlib
import re
import sys

IDS = {  # produção -> BRAIN TESTE (arquivo 06 da DOCUMENTACAO)
    "3bac5ab532d380d4968df15d5357f462": "b94c5ab532d382a2840a0128217d1ea0",  # LOGINS
    "33cc5ab532d38047ae3aee8b87ac1f4d": "f53c5ab532d38325aa4a0193011aad24",  # VENDAS
    "33dc5ab532d380abaa00fecd5c2d88c2": "88ac5ab532d383e980ee015b88826d8f",  # ATIVIDADES DE VENDAS
    "33dc5ab532d38091b927d7659f98612c": "eeac5ab532d383ddaa7981cc4c215231",  # DISPONIBILIDADES
    "32fc5ab532d380a0900dd7f4bfc619bd": "a74c5ab532d38374a4170155196788f9",  # DOCUMENTOS
    "330c5ab532d38009b6c2d5d6b77b6926": "96ac5ab532d38299bd2d01aa18016caf",  # ATIVIDADES DOCS
    "358c5ab532d3804fbcbfebc3656b1220": "e50c5ab532d382a188ad81a19cfb207b",  # METAS
    "313c5ab532d3801e974ced0bb656c9d5": "007c5ab532d383ac9ec081556377772d",  # LIGAÇÕES
    "3c9c5ab532d380a0b78bdb2f421bc9f5": "5bbc5ab532d383629c3f81fd4f521891",  # PÓS OBRA
    "3c9c5ab532d3800f8261fdab1e4ff621": "3a4c5ab532d38385b893811ad439d0fb",  # ATIVIDADES PÓS OBRA
    "bfdc5ab532d3833983fc0130cffb8bac": "3f1c5ab532d381d38ba0d495b1bc8123",  # VENDAS CONDOMÍNIO
    "3dbc5ab532d3803e9ce7e0440f30a353": "3f1c5ab532d3815e898cf52433e7bdf0",  # PROPOSTAS – RESERVA DOS IPÊS
    "3d9c5ab532d3808c8aa6e0c7625b174a": "3f1c5ab532d381038c07f4269f58fc3a",  # SIMULAÇÕES – RESERVA DOS IPÊS
    "3d8c5ab532d3800494c2cc0f184b4c03": "3f1c5ab532d38195be94d83b247094be",  # UNIDADES RESERVA DOS IPÊS
    "3e4c5ab532d380afbd3bf9f7af31d2a7": "3f1c5ab532d3812caaedf6c9a383aace",  # CONTAS BANCÁRIAS
    "3e2c5ab532d38055a241db35f74e7bbc": "3f1c5ab532d381c8bb86ef8eff482456",  # PROPRIETARIOS_PAI
}
# Simulador do Reserva dos Ipês (Apps Script próprio). Com --sim, as páginas que falam com
# ele (proposta, completar venda, simulações) passam a falar com o SIMULADOR-TESTE.
SIM_PROD = "https://script.google.com/macros/s/AKfycbzwUIApU5nKXi1vG3cEs_V2DWCdkLDwY_vo0zBxO59ZBLbEihIxuOqbHdNLm-8pVVwVJQ/exec"
MARCA_SIM = "@@URL-DO-SIMULADOR-TESTE@@"
REPO_PROD, REPO_TESTE = "DEVMoraisEng/PORTAL-MORAIS", "MoraisEng-Teste/PORTAL-MORAIS"
DOMINIO_PROD, DOMINIO_TESTE = "devmoraiseng.github.io/PORTAL-MORAIS", "moraiseng-teste.github.io/PORTAL-MORAIS"
# ids de produção conhecidos além dos 10 do IDS acima — ficam desligados no
# fork (os passos/robôs que os usariam já são desligados por PASSOS_DESLIGAR
# e pelo apagamento de robos-mc.yml), então só viram AVISO, não erro.
IDS_AVISO = {
    "306c5ab532d3812fa14fe9a281510128": "Obras",
}
EXTENSOES = {".gs", ".py", ".js", ".html", ".yml", ".yaml", ".md", ".json"}
PULAR = {".git", "venda", "teste", "dist", "img", ".superpowers"}
DESLIGADO = "if: ${{ false }}"
SEGREDO_PERMITIDO = "NOTION_TOKEN"  # único segredo que pode ficar ligado no fork
PASSO_INICIO_RE = re.compile(r"(?m)^([ \t]*)- name: [^\n]*(\r?\n)")


def desligar_passos_com_segredo(s):
    """Desliga (if: ${{ false }}) todo passo cujo próprio bloco referencie
    algum secrets.<NOME> diferente de NOTION_TOKEN — genérico, não depende
    de uma lista fixa de nomes de passo. Devolve (novo_texto, avisos)."""
    matches = list(PASSO_INICIO_RE.finditer(s))
    if not matches:
        return s, []
    avisos = []
    partes = [s[: matches[0].start()]]
    for i, m in enumerate(matches):
        fim = matches[i + 1].start() if i + 1 < len(matches) else len(s)
        bloco = s[m.start():fim]
        segredos = set(re.findall(r"secrets\.(\w+)", bloco))
        if segredos - {SEGREDO_PERMITIDO}:
            indent = m.group(1)
            linha_desligada = indent + "  " + DESLIGADO
            if_re = re.compile(r"(?m)^" + re.escape(indent + "  ") + r"if: .*$")
            if_match = if_re.search(bloco)
            if if_match:
                if if_match.group(0) != linha_desligada:
                    nome = m.group(0).strip()
                    avisos.append(f"pages.yml: passo '{nome}' já tinha uma condição if: própria "
                                  f"— substituída por {DESLIGADO} (usa segredo de produção)")
                    bloco = bloco[:if_match.start()] + linha_desligada + bloco[if_match.end():]
            else:
                pos = m.end() - m.start()
                bloco = bloco[:pos] + linha_desligada + m.group(2) + bloco[pos:]
        partes.append(bloco)
    return "".join(partes), avisos


URL_EXEC_RE = r"https://script\.google\.com/macros/s/[\w-]+/exec"
VENDA_DOSSIE = "venda-dossie.js"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--exec", required=True, dest="url_exec")
    ap.add_argument("--venda", required=True, dest="url_venda",
                     help="URL /exec do PORTAL-VENDA-TESTE (grava em venda-dossie.js; não entra na troca genérica)")
    ap.add_argument("--sim", default="", dest="url_sim",
                    help="URL /exec do SIMULADOR-TESTE (sem ela, o simulador vira a URL do PORTAL-TESTE e não funciona)")
    ap.add_argument("--raiz", default=".")
    a = ap.parse_args()
    if not re.fullmatch(URL_EXEC_RE, a.url_exec):
        sys.exit("URL do PORTAL-TESTE inválida: precisa ser https://script.google.com/macros/s/<id>/exec")
    if not re.fullmatch(URL_EXEC_RE, a.url_venda):
        sys.exit("URL do PORTAL-VENDA-TESTE inválida: precisa ser https://script.google.com/macros/s/<id>/exec")
    if a.url_sim and not re.fullmatch(URL_EXEC_RE, a.url_sim):
        sys.exit("URL do SIMULADOR-TESTE inválida: precisa ser https://script.google.com/macros/s/<id>/exec")
    raiz = pathlib.Path(a.raiz).resolve()
    alterados = []
    avisos = []
    for p in sorted(raiz.rglob("*")):
        rel = p.relative_to(raiz)
        if p.is_dir() or rel.parts[0] in PULAR or p.suffix.lower() not in EXTENSOES:
            continue
        antes = p.read_bytes().decode("utf-8")
        s = antes
        for prod, teste in IDS.items():
            s = s.replace(prod, teste)
        s = s.replace(REPO_PROD, REPO_TESTE)
        s = s.replace(DOMINIO_PROD, DOMINIO_TESTE)
        if str(rel) == VENDA_DOSSIE:
            # venda-dossie.js fala com um Apps Script SEPARADO (PORTAL-VENDA);
            # a troca genérica da URL /exec de baixo pularia este arquivo e
            # gravaria a URL errada aqui numa segunda sincronização.
            s = re.sub(r'var URL_PORTAL_VENDA = "[^"]*";', 'var URL_PORTAL_VENDA = "' + a.url_venda + '";', s)
        else:
            if a.url_sim:   # protege o simulador da troca genérica e põe o de teste
                s = s.replace(SIM_PROD, MARCA_SIM)
            s = re.sub(URL_EXEC_RE, a.url_exec, s)
            if a.url_sim:
                s = s.replace(MARCA_SIM, a.url_sim)
        if p.name == "pages.yml":
            s, avisos_passo = desligar_passos_com_segredo(s)
            avisos.extend(avisos_passo)
        if s != antes:
            p.write_bytes(s.encode("utf-8"))
            alterados.append(str(rel))
    workflows = raiz / ".github" / "workflows"
    if workflows.is_dir():
        for f in sorted(workflows.iterdir()):
            # mc-venda.yml fica: é o robô do "Lançar no Mais Controle", e no fork
            # ele só grava com a variável MC_APLICAR=1 (sem ela, roda como prévia).
            # mc-indices.yml fica: índices mensais (grava só com MC_INDICES=1)
            if f.is_file() and f.name not in ("pages.yml", "mc-venda.yml", "mc-indices.yml"):
                rel = f.relative_to(raiz)
                f.unlink()
                alterados.append(f"{rel} (apagado)")
    sobras = []
    urls_sobras = []
    for p in raiz.rglob("*"):
        rel = p.relative_to(raiz)
        if p.is_file() and rel.parts[0] not in PULAR and p.suffix.lower() in EXTENSOES:
            t = p.read_bytes().decode("utf-8")
            sobras += [f"{rel}: {i}" for i in IDS if i in t]
            urls = re.findall(URL_EXEC_RE, t)
            for url in urls:
                # a checagem de sobras aceita só --exec em qualquer arquivo, e
                # --venda apenas dentro de venda-dossie.js (é o único lugar
                # onde essa URL deveria aparecer).
                permitido = (url == a.url_exec or (str(rel) == VENDA_DOSSIE and url == a.url_venda)
                             or (a.url_sim and url == a.url_sim))
                if not permitido:
                    urls_sobras.append(f"{rel}: {url}")
            for i, nome in IDS_AVISO.items():
                if i in t:
                    avisos.append(f"{rel}: {i} ({nome}) — desligado no fork (passos/robôs desligados)")
            for m in re.finditer(r"DEVMoraisEng/[\w.-]+", t):
                avisos.append(f"{rel}: {m.group(0)} — repositório de produção fora do PORTAL-MORAIS")
    print("alterados:", len(alterados))
    for x in alterados:
        print("  ", x)
    if avisos:
        print("AVISO:", *avisos, sep="\n  ")
    if sobras:
        print("ID DE PRODUÇÃO SOBROU:", *sobras, sep="\n  ")
        sys.exit(1)
    if urls_sobras:
        print("URL DE APPS SCRIPT DE PRODUÇÃO SOBROU:", *urls_sobras, sep="\n  ")
        sys.exit(1)


if __name__ == "__main__":
    main()
