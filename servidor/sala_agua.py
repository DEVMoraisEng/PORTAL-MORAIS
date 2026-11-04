# -*- coding: utf-8 -*-
"""SALA DA ÁGUA E ENERGIA no Escritório de Robôs (04/11/2026).

Pedido do dono: o robô das contas de água e energia roda diferente dos outros (é outro programa, na pasta
agua_energia, numa tarefa às 07:30 seg–sex, e não pelo rodar_e_relatar) — então ganha uma SALA PRÓPRIA, com os
relatórios dele: o que deu erro, as pendências de cadastro e o que está repetido (duplicado) no Notion.

Este módulo só LÊ o que o próprio robô já grava (nunca roda nada, nunca mexe na pasta dele):
    agua_energia\\relatorios\\ULTIMA_SAUDE.json                     a saúde da última rodada (passos e alertas)
    agua_energia\\relatorios\\ALERTA.txt                            os alertas da última rodada
    agua_energia\\relatorios\\rodadas\\AAAA-MM\\rodada_*.txt / .pdf    o resumo de cada rodada (o mesmo do e-mail)
e devolve o pedaço "agua" do robos/escritorio.json. O PDF de cada rodada sobe uma vez para o bucket com o nome que
o Apps Script já aceita (robos/pdf/AAAA-MM/AAAA-MM-DD_HHMM_agua_ok|FALHOU.pdf) — sem mudar o EscritorioRobos.gs.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import re

PASTA = pathlib.Path(os.environ.get("AGUA_PASTA") or r"C:\AUTOMAÇÕES MAIS CONTROLE\agua_energia")
MAX_RODADAS = 20
MAX_DIAS = 45
COM_TEXTO = 3                 # as N rodadas mais novas levam o texto inteiro (a gaveta mostra)
MAX_LINHAS_PASSO = 400

#: os passos da rodada, na ordem em que o robô os roda: chave, nome do passo na ULTIMA_SAUDE.json, como achar o
#: título da seção "[n/m] …" no resumo
PASSOS = [
    ("notion", "notion_base", r"notion"),
    ("filas", "gerar_fila", r"filas?\b"),
    ("equatorial", "coletar", r"equatorial"),
    ("sanesc", "coletar_sanesc", r"sanesc"),
    ("lancar", "lancar_mc", r"lan[cç]ar"),
    ("contas", "criar_contas", r"liga[cç][õo]es novas|criar_contas"),
    ("recorrencias", "renovar_recorrencias", r"recorr"),
]
_RE_CAB = re.compile(r"^=== RODADA (\d\d)/(\d\d)/(\d{4}) (\d\d):(\d\d)(?: \(mês (\d{4}-\d\d)\))? ===")
_RE_SECAO = re.compile(r"^\[(\d+[a-z]?)/(\d+)\]\s*(.+?):?\s*$")
_RE_ARQ = re.compile(r"^rodada_(\d{4}-\d\d-\d\d)_(\d{4})\.txt$")
_RE_PROBLEMA = re.compile(r"^\s*problema na base:\s*(.+?)\s*\(([^)]+)\):\s*(.+?)\s*$")
_RE_DUPLICADO = re.compile(r"repetid|duplic|mais de uma casa|em dobro", re.I)
_RE_ERRO = re.compile(r"^\s*ERRO \(([^)]+)\)\s*:?\s*(.*)$")


#: ordem de procura do título: o mais específico antes ("Lançar no Mais Controle (Equatorial + Sanesc)" é o lançar,
#: "Ligações novas: … recorrências (criar_contas.py)" é o das ligações novas)
_PROCURA = ("lancar", "contas", "recorrencias", "notion", "filas", "equatorial", "sanesc")
_RE_FIM_BOM = re.compile(r"encerrad|nada a lan|lidas \d+|na fila|regravada|restam|lançad|renovad|criad", re.I)
_RE_DETALHE = re.compile(r"\[X\]|\b\w+(Error|Exception)\b:|não capturei|recusou|bloquead", re.I)


def _chave_da_secao(titulo: str) -> str | None:
    t = titulo.lower()
    if "lembrete" in t:
        return None
    padroes = {ch: pd for ch, _n, pd in PASSOS}
    for ch in _PROCURA:
        padrao = padroes[ch]
        if re.search(padrao, t):
            return ch
    return None


def ler_rodada(texto: str, nome: str = "") -> dict:
    """O resumo de uma rodada (rodada_AAAA-MM-DD_HHMM.txt) em partes que a sala mostra."""
    linhas = texto.splitlines()
    r = {"arquivo": nome, "inicio": None, "mes": None, "duracao": None, "email": None,
         "passos": {}, "alertas": [], "problemas": [], "duplicados": [], "erros": []}
    m = _RE_ARQ.match(nome or "")
    if m:
        r["inicio"] = "%sT%s:%s:00" % (m.group(1), m.group(2)[:2], m.group(2)[2:])
    atual = None
    no_alerta = False
    vistos: dict[tuple, dict] = {}
    for bruta in linhas:
        ln = bruta.rstrip()
        c = _RE_CAB.match(ln)
        if c:
            r["inicio"] = "%s-%s-%sT%s:%s:00" % (c.group(3), c.group(2), c.group(1), c.group(4), c.group(5))
            r["mes"] = c.group(6)
            continue
        s = _RE_SECAO.match(ln)
        if s:
            no_alerta = False
            ch = _chave_da_secao(s.group(3))
            atual = None
            if ch:
                atual = r["passos"].setdefault(ch, {"titulo": s.group(3).strip(), "linhas": [], "erro": ""})
            continue
        if ln.strip() == "ALERTA:":
            no_alerta, atual = True, None
            continue
        if no_alerta and ln.strip().startswith("- "):
            r["alertas"].append(ln.strip()[2:].strip())
            continue
        if ln.startswith("duração:"):
            r["duracao"] = ln.split(":", 1)[1].strip()
            atual = None
            continue
        if ln.startswith("e-mail "):
            r["email"] = ln.strip()[:240]
            continue
        if ln.startswith("resumo salvo em") or ln.startswith("python:"):
            continue
        if atual is not None and ln.strip() and len(atual["linhas"]) < MAX_LINHAS_PASSO:
            atual["linhas"].append(ln.strip()[:300])
        e = _RE_ERRO.match(ln)
        if e and atual is not None:
            atual["erro"] = e.group(1).strip()[:120]
        elif atual is not None and _RE_DETALHE.search(ln):
            atual["detalhe"] = re.sub(r"^.*?\b(\w+(?:Error|Exception)\b:)", r"\1", ln.strip())[:220]
        p = _RE_PROBLEMA.match(ln)
        if p:
            chave = (p.group(1), p.group(2), p.group(3))
            if chave in vistos:
                vistos[chave]["n"] += 1
            else:
                vistos[chave] = {"casa": p.group(1), "conc": p.group(2), "motivo": p.group(3), "n": 1}
        elif _RE_DUPLICADO.search(ln) and not ln.strip().startswith("ALERTA"):
            r["duplicados"].append({"casa": "", "conc": "", "motivo": ln.strip()[:240], "n": 1})
    r["problemas"] = list(vistos.values())
    # a mesma casa com o mesmo problema duas vezes = a linha está repetida no Notion
    r["duplicados"] = [dict(x, motivo="aparece %d vezes na base do Notion (%s)" % (x["n"], x["motivo"]))
                       for x in r["problemas"] if x["n"] > 1] + r["duplicados"]
    for ch, p in r["passos"].items():
        if p["erro"]:
            if p.get("detalhe"):
                p["erro"] = "%s — %s" % (p["erro"], p["detalhe"])
            r["erros"].append({"passo": ch, "texto": p["erro"]})
    r["ok"] = not r["erros"] and not r["alertas"]
    return r


def _estado_do_passo(ch: str, rod: dict, saude: dict | None) -> tuple[str, str]:
    """(ok|erro|aviso|off, frase) de um passo numa rodada."""
    p = (rod.get("passos") or {}).get(ch)
    if p is None:
        return "off", "não rodou nesta rodada"
    nome = dict((c, n) for c, n, _ in PASSOS)[ch]
    cod = ((saude or {}).get("passos") or {}).get(nome)
    if p.get("erro") or (cod not in (None, 0)):
        return "erro", p.get("erro") or "terminou com código %s" % cod
    al = [a for a in rod.get("alertas") or [] if ch in a.lower() or (ch == "equatorial" and a.lower().startswith("equatorial"))]
    if al:
        return "erro", al[0]
    bons = [x for x in p.get("linhas") or [] if _RE_FIM_BOM.search(x)]
    return "ok", (bons[-1] if bons else (p["linhas"][-1] if p.get("linhas") else "ok"))[:200]


def montar_sala(pasta: pathlib.Path = PASTA, hoje: dt.date | None = None) -> dict | None:
    """O pedaço "agua" do escritorio.json, ou None se a pasta do robô não existe nesta máquina."""
    rel = pasta / "relatorios"
    if not rel.exists():
        return None
    hoje = hoje or dt.date.today()
    avisos = []
    saude = None
    try:
        saude = json.loads((rel / "ULTIMA_SAUDE.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        pass
    except Exception as e:
        avisos.append("ULTIMA_SAUDE.json: %s" % type(e).__name__)
    alerta, alerta_em = [], None
    try:
        a = rel / "ALERTA.txt"
        alerta = [x.strip() for x in a.read_text(encoding="utf-8", errors="replace").splitlines() if x.strip()][:30]
        alerta_em = dt.datetime.fromtimestamp(a.stat().st_mtime).isoformat(timespec="seconds")
    except FileNotFoundError:
        pass
    except Exception as e:
        avisos.append("ALERTA.txt: %s" % type(e).__name__)
    limite = (hoje - dt.timedelta(days=MAX_DIAS)).isoformat()
    arquivos = []
    pasta_rod = rel / "rodadas"
    if pasta_rod.exists():
        for mes in sorted(pasta_rod.iterdir(), reverse=True):
            if not mes.is_dir() or not re.fullmatch(r"\d{4}-\d\d", mes.name):
                continue
            for f in mes.glob("rodada_*.txt"):
                m = _RE_ARQ.match(f.name)
                if m and m.group(1) >= limite:
                    arquivos.append(f)
            if len(arquivos) >= MAX_RODADAS * 2:
                break
    arquivos.sort(key=lambda f: f.name, reverse=True)
    rodadas = []
    for i, f in enumerate(arquivos[:MAX_RODADAS]):
        try:
            texto = f.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            avisos.append("%s: %s" % (f.name, type(e).__name__))
            continue
        r = ler_rodada(texto, f.name)
        pdf = f.with_suffix(".pdf")
        r["pdf"] = pdf.name if pdf.exists() else None
        if i < COM_TEXTO:
            r["texto"] = texto[-60000:]
        rodadas.append(r)
    # a saúde vale só para a rodada que ela descreve (a mais nova, se bater a data)
    if rodadas and saude:
        if str(saude.get("quando") or "")[:10] == str(rodadas[0].get("inicio") or "")[:10]:
            if saude.get("codigo_saida") not in (None, 0):
                rodadas[0]["ok"] = False
        else:
            saude = dict(saude, de_outra_rodada=True)
    for k, r in enumerate(rodadas):
        r["estados"] = {ch: dict(zip(("st", "texto"), _estado_do_passo(ch, r, saude if k == 0 and not (saude or {}).get("de_outra_rodada") else None)))
                        for ch, _n, _p in PASSOS}
        if k >= COM_TEXTO:                    # as mais velhas: só o resultado de cada passo (o arquivo fica leve)
            for p in (r.get("passos") or {}).values():
                p.pop("linhas", None)
    return {"pasta": str(pasta), "saude": saude, "alerta": alerta, "alerta_em": alerta_em,
            "rodadas": rodadas, "avisos": avisos}


def caminho_do_pdf(r: dict) -> str | None:
    """robos/pdf/AAAA-MM/AAAA-MM-DD_HHMM_agua_ok|FALHOU.pdf — o formato que o escritorioPdf aceita."""
    m = re.match(r"^rodada_(\d{4}-\d\d-\d\d)_(\d{4})\.pdf$", str(r.get("pdf") or ""))
    if not m:
        return None
    return "robos/pdf/%s/%s_%s_agua_%s.pdf" % (m.group(1)[:7], m.group(1), m.group(2), "ok" if r.get("ok") else "FALHOU")


def arquivo_local_do_pdf(r: dict, pasta: pathlib.Path = PASTA) -> pathlib.Path | None:
    m = re.match(r"^rodada_(\d{4}-\d\d)-\d\d_\d{4}\.pdf$", str(r.get("pdf") or ""))
    return pasta / "relatorios" / "rodadas" / m.group(1) / r["pdf"] if m else None


if __name__ == "__main__":
    import sys
    sala = montar_sala()
    if sala is None:
        print("pasta do água e energia não encontrada:", PASTA)
        sys.exit(1)
    print("rodadas:", len(sala["rodadas"]), "· alertas:", len(sala["alerta"]))
    for r in sala["rodadas"][:5]:
        print(r["inicio"], "ok" if r["ok"] else "COM PROBLEMA", "·", len(r["problemas"]), "pendência(s) de cadastro ·",
              len(r["duplicados"]), "repetida(s) ·", ", ".join("%s=%s" % (k, v["st"]) for k, v in r["estados"].items()))
