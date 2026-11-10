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

import ast
import datetime as dt
import json
import os
import pathlib
import re
import subprocess
import sys

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
_RE_NA_FILA = re.compile(r"^\s*(EQUATORIAL|SANESC|SANEAGO(?: ESGOTO)?): (\d+) na fila")
_RE_POR_CONC = re.compile(r"por concessionária: (\{.*\})")
COM_PENDENCIAS = 5            # as N rodadas mais novas levam as pendências casa a casa (com os links)
SEM_JANELA = getattr(subprocess, "CREATE_NO_WINDOW", 0)

#: 04/11 (2ª versão, pedido do dono: "falar qual a obra, qual a UC, linkar com o Mais Controle"): as pendências
#: casa a casa saem das REGRAS DO PRÓPRIO ROBÔ — coletor/email_rodada.py (resumir + agrupar, os mesmos blocos do
#: e-mail) e coletor/relatorio_pdf.py (link da casa no Notion e da parcela no Mais Controle, como no PDF). Roda em
#: outro processo, na pasta do coletor: os módulos dele (caminhos, saude, vendas…) não se misturam com os do portal.
_SCRIPT_PENDENCIAS = r"""
import json, re, sys
from pathlib import Path
coletor = Path(sys.argv[1]); sys.path.insert(0, str(coletor))
import email_rodada as E
try:
    import relatorio_pdf as P
    idx = P.indice_notion(coletor.parent); parcelas = P.carregar_parcelas(coletor.parent)
except Exception as e:
    P, idx, parcelas = None, ({}, {}), {}
_, por_chave = idx
CONC = lambda t: next((c for c in ("EQUATORIAL", "SANESC", "SANEAGO") if c in str(t or "").upper()), "")
def conc_da_chave(ch):
    l = por_chave.get(str(ch or "").lstrip("0")) or []
    return CONC(l[0]["conc"]) if l else ""
GRUPO_CONC = {"taxa": "SANESC", "pago": "SANESC", "nao_ligado": "EQUATORIAL"}
def conc_do_motivo(m):
    m = " " + str(m or "").lower()
    if "matrícula" in m or "matricula" in m or "taxa" in m or "cadastro divergente" in m or "instalação" in m:
        return "SANESC"
    return "EQUATORIAL" if " uc" in m or "equatorial" in m else ""
saida = []
for arq in sys.argv[2:]:
    texto = Path(arq).read_text(encoding="utf-8", errors="replace")
    r = E.resumir(texto)
    grupos = E.agrupar(r)
    do_motivo = {}
    for pr in r["problemas"]:
        c = conc_do_motivo(pr["motivo"])
        if c:
            do_motivo.setdefault(pr["obra"], set()).add(c)
    for ln in texto.splitlines():                       # "problema na base: CASA (EQUATORIAL): motivo"
        mm = re.match(r"^\s*problema na base:\s*(.+?)\s*\(([^)]+)\):", ln)
        if mm and CONC(mm.group(2)):
            do_motivo.setdefault(mm.group(1), set()).add(CONC(mm.group(2)))
    out = []
    for g in grupos:
        itens = []
        for t in g["itens"]:
            obra, detalhe, links = P._casa(t, idx) if P else (t, "", [])
            m = re.search(r"\((\d{5,12})\)", t)
            chave = m.group(1).lstrip("0") if m else ""
            dm = do_motivo.get(obra) or set()
            concs = {CONC(l["conc"]) for l in links} - {""}
            conc = (GRUPO_CONC.get(g["chave"]) or CONC(t.split(" ")[0]) or conc_da_chave(chave)
                    or (next(iter(dm)) if len(dm) == 1 else "") or (next(iter(concs)) if len(concs) == 1 else ""))
            if conc:                                    # a base tem uma linha por ligação: o link é o da concessionária
                links = [l for l in links if CONC(l["conc"]) == conc] or links
            mc = []
            if chave and parcelas.get(chave):
                mc.append(P.URL_PARCELA.format(parcelas[chave]["id"]))
            elif P:
                for l in links:
                    q = parcelas.get(l.get("chave") or "")
                    if q:
                        mc.append(P.URL_PARCELA.format(q["id"]))
            itens.append({"texto": t, "obra": obra, "detalhe": detalhe, "chave": chave or (links[0].get("chave", "") if len(links) == 1 else ""),
                          "conc": conc, "mc": list(dict.fromkeys(mc))[:3],
                          "notion": [{"conc": CONC(l["conc"]) or l["conc"], "url": l["url"], "obra": l["obra"], "uc": l.get("chave", "")} for l in links][:4]})
        out.append({"chave": g["chave"], "titulo": g["titulo"], "quem": g["quem"], "fazer": g["fazer"],
                    "so_aviso": g["chave"] in E.SO_AVISO, "itens": itens})
    falhas = []
    for f in r["falhas"]:
        causa, fazer = E.explicar_falha(f["texto"])
        falhas.append({"passo": f["passo"], "texto": f["texto"][:240], "causa": causa, "fazer": fazer})
    conta = lambda lista: {c: sum(1 for x in lista if (CONC(x.get("conc")) or conc_da_chave(x.get("chave"))) == c) for c in ("EQUATORIAL", "SANESC", "SANEAGO")}
    saida.append({"arquivo": Path(arq).name, "grupos": out, "falhas": falhas, "pendencias": E.pendencias(grupos),
                  "baixadas": len(r["baixadas"]), "baixadas_por": conta(r["baixadas"]),
                  "lancadas": len(r["lancamentos"]), "lancadas_por": conta(r["lancamentos"]),
                  "ja_lancadas": r["ja_lancadas"], "recorrencias": r["recorrencias"], "renovadas": r["renovadas"],
                  "avista": r["avista"], "sem_fatura": r["sem_fatura"]})
# REPETIDAS na base do Notion (do retrato mais novo, a base inteira): a mesma casa com mais de uma linha da mesma
# concessionária, e a mesma UC/matrícula em mais de uma casa (o robô não lança nem cria recorrência até corrigir)
por_obra, _pc = idx
dup = []
for chave_obra, ls in por_obra.items():
    por_c = {}
    for l in ls:
        por_c.setdefault(l["conc"] or "?", {})[l["url"]] = l      # "SANEAGO" e "SANEAGO ESGOTO" são ligações diferentes
    for c, us in por_c.items():
        if len(us) > 1:
            l0 = next(iter(us.values()))
            dup.append({"tipo": "casa", "obra": l0["obra"], "conc": CONC(c) or c, "ligacao": c, "uc": ", ".join(sorted({x.get("chave") or "sem UC" for x in us.values()})),
                        "notion": [{"url": u, "obra": x["obra"], "uc": x.get("chave", "")} for u, x in us.items()][:6]})
for ch, ls in _pc.items():
    casas = {}
    for l in ls:
        casas.setdefault(P._norm(l["obra"]) if P else l["obra"], l)
    if len(casas) > 1:
        dup.append({"tipo": "uc", "obra": " · ".join(sorted(x["obra"] for x in casas.values()))[:200], "conc": CONC(ls[0]["conc"]),
                    "uc": ch, "notion": [{"url": x["url"], "obra": x["obra"], "uc": ch} for x in casas.values()][:6]})
print(json.dumps({"rodadas": saida, "duplicadas": dup[:200]}, ensure_ascii=False))
"""


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
    #: 04/11: o que o e-mail do robô de fato mandou (a rodada e as tarefas de reenvio das 10:00 e 14:00 anotam aqui).
    #: Sem isto, a rodada que disse "e-mail NÃO enviado" ficava vermelha mesmo depois de o reenvio mandar.
    enviados = set()
    try:
        enviados = {x.strip() for x in (rel / "emails_enviados.txt").read_text(encoding="utf-8", errors="replace").splitlines()
                    if x.strip()}
    except FileNotFoundError:
        pass
    except Exception as e:
        avisos.append("emails_enviados.txt: %s" % type(e).__name__)
    rodadas = []
    for i, f in enumerate(arquivos[:MAX_RODADAS]):
        try:
            texto = f.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            avisos.append("%s: %s" % (f.name, type(e).__name__))
            continue
        r = ler_rodada(texto, f.name)
        r["conc"] = concessionarias(texto)
        r["email_enviado"] = f.name in enviados
        pdf = f.with_suffix(".pdf")
        r["pdf"] = pdf.name if pdf.exists() else None
        if i < COM_TEXTO:
            r["texto"] = texto[-60000:]
        rodadas.append(r)
    pend = pendencias_do_robo(pasta, [f for f in arquivos[:COM_PENDENCIAS]], avisos)
    for r in rodadas:
        if r["arquivo"] in (pend.get("rodadas") or {}):
            r["pend"] = pend["rodadas"][r["arquivo"]]
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
            "rodadas": rodadas, "duplicadas": pend.get("duplicadas"), "avisos": avisos}


def pendencias_do_robo(pasta: pathlib.Path, arquivos: list, avisos: list | None = None) -> dict:
    """{"rodadas": {nome do .txt: pendências casa a casa}, "duplicadas": [...]} pelas regras do próprio robô (ver
    _SCRIPT_PENDENCIAS). Falhar aqui
    só tira os detalhes — a sala continua com o resumo."""
    coletor = pasta / "coletor"
    if not arquivos or not (coletor / "email_rodada.py").exists():
        return {}
    try:
        r = subprocess.run([sys.executable, "-c", _SCRIPT_PENDENCIAS, str(coletor)] + [str(f) for f in arquivos],
                           cwd=str(coletor), capture_output=True, text=True, encoding="utf-8", errors="replace",
                           timeout=120, creationflags=SEM_JANELA, env=dict(os.environ, PYTHONIOENCODING="utf-8"))
        if r.returncode != 0:
            raise RuntimeError((r.stderr or "").strip().splitlines()[-1:] or ["código %s" % r.returncode])
        j = json.loads(r.stdout or "{}")
        return {"rodadas": {x["arquivo"]: x for x in j.get("rodadas") or []}, "duplicadas": j.get("duplicadas") or []}
    except Exception as e:
        if avisos is not None:
            avisos.append("pendências casa a casa: %s %s" % (type(e).__name__, str(e)[:160]))
        return {}


def concessionarias(texto: str) -> dict:
    """Do resumo: quantas casas cada concessionária tem na base do Notion e quantas entraram na fila do mês."""
    out = {}
    for ln in texto.splitlines():
        m = _RE_POR_CONC.search(ln)
        if m and "base" not in out:
            try:
                out["base"] = {str(k): int(v) for k, v in ast.literal_eval(m.group(1)).items()}
            except Exception:
                pass
        m = _RE_NA_FILA.match(ln)
        if m:
            out.setdefault("fila", {})[m.group(1)] = int(m.group(2))
    return out


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


# ------------------------------------------------------------- 04/11: problemas para a aba de Ligações
#: Vai para o dist/ do site (PÚBLICO): só casa, concessionária, UC/matrícula, o motivo SEM valores e os ids das linhas do
#: Notion / links do Mais Controle (que só abrem logado). Nada de CPF, nome de cliente ou R$.
_RE_VALOR = re.compile(r"\s*R\$\s*[\d.]+(,\d\d)?")
_RE_ID_NOTION = re.compile(r"([0-9a-f]{32})(?:\?|$)")
_RE_DOC = re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}\b")


def _id_notion(url: str) -> str | None:
    m = _RE_ID_NOTION.search(str(url or "").replace("-", ""))
    return m.group(1) if m else None


def _limpo(t: str) -> str:
    return _RE_DOC.sub("•••", _RE_VALOR.sub("", str(t or ""))).strip(" —-·")[:240]


#: 09/11/2026 (dono): a aba CONTROLE DE CONTAS VENCIDAS ganha STATUS (✓ em dia · ⚠ alerta · ⏳ aguardando a fatura do
#: mês) e o robô passa a contar nas OBSERVAÇÕES o que fez em cada UC (lançou, mês de referência e link; ou por que não
#: lançou). O robô nunca grava no Notion: o histórico dele sai dos registros que ele já grava na pasta dele e vai num
#: arquivo público (dist/agua_contas.json) — sem CPF, sem valor, sem nome de cliente. A tela mistura com o histórico das
#: pessoas (que continua no Notion), no mesmo formato "▸ data hora · quem".
URL_PARCELA_MC = "https://acessar.maiscontroleerp.com.br/#/payable-installments/{}"
MESES_CONTAS = 3              # o mês de hoje e os 2 anteriores
MAX_HIST = 8                  # registros do robô por UC
_MES_ABREV = {m: i for i, m in enumerate(["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"], 1)}
_RE_REF = re.compile(r"\bREF\s+((?:[A-Za-z]{3}\s+A\s+)?[A-Za-z]{3}\s+\d{4})\b", re.I)
_TXT_RESULTADO = {
    "DUVIDA": "Não lançado — dúvida: {det}",
    "PULADO": "Não lançado — pulado: {det}",
    "SEM_PLACEHOLDER": "Não lançado — há parcela aberta no mês, mas nenhuma é a reservada para a conta: conferir no Mais Controle",
    "SEM_RECORRENCIA_CRIAR": "Não lançado — o mês não tem parcela: o robô lança à vista na etapa de contas novas",
}


def _ler_csv(arq: pathlib.Path) -> list[dict]:
    import csv
    try:
        with open(arq, encoding="utf-8-sig", newline="") as f:
            return list(csv.DictReader(f, delimiter=";"))
    except Exception:
        return []


def _chave_uc(v) -> str:
    return re.sub(r"[^0-9A-Za-z]", "", str(v or "")).upper().lstrip("0")


def _mes_da_ref(ref: str) -> tuple[int, int] | None:
    """'OUT 2026' / 'JUL A AGO 2026' → (2026, 10) / (2026, 8) — vale o último mês."""
    p = str(ref or "").upper().split()
    if len(p) >= 2 and p[-1].isdigit() and p[-2] in _MES_ABREV:
        return int(p[-1]), _MES_ABREV[p[-2]]
    return None


def _quando(v: str) -> str:
    return str(v or "").strip()[:16]


def _venc(v: str) -> str:
    m = re.match(r"^(\d{4})-(\d\d)-(\d\d)", str(v or ""))
    return f"{m.group(3)}/{m.group(2)}/{m.group(1)}" if m else ""


def _evento_lancamento(r: dict) -> dict | None:
    res = str(r.get("resultado") or "").strip().upper()
    ref = str(r.get("ref") or "").strip().upper()
    if not res or res == "DRY_RUN":
        return None
    det = _limpo(r.get("detalhe"))
    if res == "LANCADO":
        v = _venc(r.get("vencimento"))
        return {"tipo": "fatura", "st": "ok", "ref": ref, "link": True,
                "t": f"Lançado no Mais Controle — REF {ref}" + (f", vence {v}" if v else "")}
    if res == "JA_LANCADO":
        return {"tipo": "fatura", "st": "ok", "ref": ref, "link": True, "t": f"Já estava lançado no Mais Controle — REF {ref}"}
    t = _TXT_RESULTADO.get(res, "Não lançado — " + res.lower().replace("_", " ") + ": {det}").format(det=det)
    return {"tipo": "fatura", "st": "alerta", "ref": ref, "t": t + (f" (REF {ref})" if ref and ref not in t else "")}


def _evento_criacao(r: dict) -> dict | None:
    acao = str(r.get("acao") or "").strip().lower()
    res = str(r.get("resultado") or "").strip().upper()
    det = _limpo(r.get("detalhe"))
    m = _RE_REF.search(str(r.get("detalhe") or ""))
    ref = m.group(1).upper() if m else ""
    if res == "DRY_RUN" or acao == "plano":
        return None
    if acao == "atrasado":
        if res == "LANCADO":
            return {"tipo": "fatura", "st": "ok", "ref": ref, "link": True,
                    "t": "Lançado à vista no Mais Controle (mês sem parcela)" + (f" — REF {ref}" if ref else "")}
        return {"tipo": "fatura", "st": "alerta", "ref": ref, "t": f"Erro ao lançar à vista: {det}"}
    if acao == "avaliar" and res == "CASA_DO_CLIENTE":
        return {"tipo": "fatura", "st": "ok", "ref": ref, "t": "Conta do cliente — não se paga"}
    if acao in ("recorrencia", "renovacao"):
        nome = "criada" if acao == "recorrencia" else "renovada"
        if res == "CRIADA":
            return {"tipo": "criacao", "st": "ok", "t": f"Recorrência mensal {nome} no Mais Controle", "link": True}
        return {"tipo": "criacao", "st": "alerta", "t": f"Recorrência não {nome} ({res.lower()}): {det}"}
    if acao == "avaliar":
        return {"tipo": "criacao", "st": "alerta", "t": f"Ligação nova em dúvida: {det}"}
    return None


def contas_publicas(pasta: pathlib.Path = PASTA, hoje: dt.date | None = None,
                    agora: dt.datetime | None = None) -> dict:
    """O que a aba CONTROLE DE CONTAS VENCIDAS do ligacoes.html lê (dist/agua_contas.json): por UC/matrícula, o
    STATUS e o histórico do robô (o mais novo primeiro). Só lê a pasta do robô."""
    hoje = hoje or dt.date.today()
    agora = agora or dt.datetime.now(dt.timezone.utc)
    dados = pathlib.Path(pasta) / "dados"
    if not dados.is_dir():
        return {"ok": False, "contas": {}}
    meses, a, m = [], hoje.year, hoje.month
    for _ in range(MESES_CONTAS):
        meses.append(f"{a:04d}-{m:02d}")
        a, m = (a, m - 1) if m > 1 else (a - 1, 12)
    eventos: dict[str, list] = {}
    info: dict[str, dict] = {}

    def junta(r: dict, ev: dict | None, quando: str):
        ch = _chave_uc(r.get("chave"))
        if not ev or not ch:
            return
        ev["q"] = quando
        eventos.setdefault(ch, []).append(ev)
        info[ch] = {"obra": str(r.get("obra") or "").strip(), "conc": str(r.get("concessionaria") or "").strip().upper()}

    for mes in sorted(meses):
        for arq in sorted(dados.glob(f"lancamentos_mc_*_{mes}.csv")):
            for r in _ler_csv(arq):
                junta(r, _evento_lancamento(r), _quando(r.get("quando")))
        for r in _ler_csv(dados / f"criacoes_mc_{mes}.csv"):
            junta(r, _evento_criacao(r), _quando(r.get("quando")))
    for r in _ler_csv(pathlib.Path(pasta) / "relatorios" / "casas_do_cliente.csv"):
        if str(r.get("data") or "")[:7] in meses and str(r.get("decisao") or "").upper() == "CLIENTE":
            ref = str(r.get("ref") or "").upper()
            junta(r, {"tipo": "fatura", "st": "ok", "ref": ref, "t": "Conta do cliente — não se paga" + (f" (REF {ref})" if ref else "")},
                  _quando(r.get("data")))
    try:
        parcelas = json.loads((dados / "mc_parcelas.json").read_text(encoding="utf-8"))
        parcelas = {_chave_uc(k): v for k, v in parcelas.items()}
    except Exception:
        parcelas = {}

    # a fatura "do mês" é a referência mais nova que o robô já viu NAQUELA concessionária (a Sanesc cobra com 2 meses
    # de atraso: REF SET vence em novembro; a Equatorial com 1). UC com referência mais velha = aguardando a fatura.
    ref_atual: dict[str, tuple] = {}
    for ch, evs in eventos.items():
        for e in evs:
            mr = _mes_da_ref(e.get("ref")) if e["tipo"] == "fatura" else None
            if mr and mr > ref_atual.get(info[ch]["conc"], (0, 0)):
                ref_atual[info[ch]["conc"]] = mr

    contas = {}
    for ch, evs in eventos.items():
        evs.sort(key=lambda e: e["q"])
        link = URL_PARCELA_MC.format(parcelas[ch]["id"]) if (parcelas.get(ch) or {}).get("id") else None
        hist, vistos = [], set()
        for e in evs:                                   # o mesmo texto no mesmo dia (rodada + lotes) = um registro só
            if (hist and hist[-1]["t"] == e["t"]) or (e["q"][:10], e["t"]) in vistos:
                continue
            vistos.add((e["q"][:10], e["t"]))
            hist.append({"q": e["q"], "t": e["t"], "st": e["st"], "mc": link if e.get("link") else None})
        fat = [e for e in evs if e["tipo"] == "fatura"]
        cri = [e for e in evs if e["tipo"] == "criacao"]
        ult = fat[-1] if fat else None
        if ult and ult["st"] == "alerta":
            st = "alerta"
        elif ult:
            mr = _mes_da_ref(ult.get("ref"))
            if mr:
                velha = mr < ref_atual.get(info[ch]["conc"], mr)
            else:
                velha = str(ult["q"])[:10] < (hoje - dt.timedelta(days=45)).isoformat()
            st = "aguardando" if velha else "ok"
        else:
            st = "aguardando"
        if cri and cri[-1]["st"] == "alerta":            # recorrência em dúvida segura o alerta até resolver
            st = "alerta"
        hist.reverse()
        # o link é da parcela que o Mais Controle tem HOJE para a UC: só no registro mais novo que tem link
        com_link = [h for h in hist if h["mc"]]
        for h in com_link[1:]:
            h["mc"] = None
        contas[ch] = dict(info[ch], st=st, ref=(ult or {}).get("ref") or "", mc=link, hist=hist[:MAX_HIST])
    return {"ok": True, "updated_at": agora.isoformat(timespec="seconds"), "meses": meses, "contas": contas}


def problemas_publicos(sala: dict | None, agora: dt.datetime | None = None) -> dict:
    """O que a aba "PROBLEMAS COM AS LIGAÇÕES" do ligacoes.html lê (dist/agua_problemas.json)."""
    agora = agora or dt.datetime.now(dt.timezone.utc)
    if not sala or not sala.get("rodadas"):
        return {"ok": False, "itens": [], "duplicadas": []}
    r = next((x for x in sala["rodadas"] if x.get("pend")), sala["rodadas"][0])
    itens = []
    for g in ((r.get("pend") or {}).get("grupos") or []):
        if g.get("so_aviso"):
            continue
        for it in g.get("itens") or []:
            itens.append({"grupo": g.get("chave"), "titulo": g.get("titulo"), "quem": g.get("quem"), "fazer": g.get("fazer"),
                          "obra": it.get("obra"), "conc": it.get("conc") or "", "motivo": _limpo(it.get("detalhe") or ""),
                          "uc": ", ".join(sorted({str(n.get("uc") or "") for n in it.get("notion") or [] if n.get("uc")}))[:80],
                          "notion": [i for i in (_id_notion(n.get("url")) for n in it.get("notion") or []) if i][:4],
                          "mc": [u for u in (it.get("mc") or []) if str(u).startswith("https://")][:3]})
    dup = [{"tipo": d.get("tipo"), "obra": d.get("obra"), "conc": d.get("conc"), "uc": d.get("uc"),
            "notion": [i for i in (_id_notion(n.get("url")) for n in d.get("notion") or []) if i][:6]}
           for d in sala.get("duplicadas") or []]
    return {"ok": True, "updated_at": agora.isoformat(timespec="seconds"), "rodada": r.get("arquivo"),
            "rodada_inicio": r.get("inicio"), "itens": itens, "duplicadas": dup}
