# -*- coding: utf-8 -*-
"""ESCRITÓRIO DE ROBÔS (03/11/2026) — o que a aba do portal mostra sobre os robôs do servidor.

Junta, num arquivo só (escritorio.json), três coisas que hoje só existem no servidor:
  1. as tarefas agendadas "MoraisEng - …" (quando cada robô trabalha, a última e a próxima vez, o resultado);
  2. as rodadas relatadas pelo _central\\rodar_e_relatar.py — o MESMO conteúdo do PDF que vai por e-mail
     (o que rodou, o que deu certo e errado, o que fazer, fim da saída), guardado num .json ao lado do PDF;
  3. a saúde da fila do portal (_central\\robos-portal-saude.json, escrita a cada minuto pelo robo_fila.py).

E sobe o arquivo para o bucket PRIVADO "analise" do Supabase ORÇADO/REALIZADO (robos/escritorio.json).
A página escritorio-robos.html pede ao Apps Script (ação escritorioBoot) um link assinado de 15 min —
a service key nunca vai para o navegador e o arquivo não fica no GitHub Pages público.

Quem chama:
  - rodar_e_relatar.py, depois de cada rodada:  escritorio_robos.depois_da_rodada(r, pdf, explicar, log)
  - robo_fila.py, a cada 5 min (a fila roda de minuto em minuto): escritorio_robos.publicar_se_passou(5)
  - à mão:  python servidor\\escritorio_robos.py            (monta e sobe)
            python servidor\\escritorio_robos.py --so-montar (só imprime o resumo, não sobe)

Só LÊ o servidor e GRAVA só no Supabase — nada no Mais Controle nem no Notion. Nunca lança erro para quem
chama: o robô e o relatório continuam valendo mesmo se a publicação falhar.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import unicodedata
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))      # reorganizar.py mora ao lado

CENTRAL = pathlib.Path(os.environ.get("MC_CENTRAL") or r"C:\AUTOMAÇÕES MAIS CONTROLE\_central")
CONFIG = CENTRAL / "robos-portal.json"
SAUDE = CENTRAL / "robos-portal-saude.json"
RELATORIOS = CENTRAL / "relatorios-robos"
MARCA = CENTRAL / "escritorio-publicado.txt"      # hora da última publicação (para o robo_fila não subir a cada minuto)
LOGS = CENTRAL / "logs"
PORTEIRO_LOG = CENTRAL / "porteiro.log"
TAREFAS_CACHE = CENTRAL / "escritorio-tarefas.json"   # 04/11: última leitura boa do Agendador (às vezes ele não responde)
PDFS_ENVIADOS = CENTRAL / "escritorio-pdfs.txt"       # 04/11: PDFs de relatório que já subiram para o bucket
PASTA_PDF = "robos/pdf"
MAX_LOG = 80                # linhas do log por robô (últimos DIAS_LOG dias)
DIAS_LOG = 3
MAX_PDF_POR_VEZ = 40
BUCKET, CAMINHO = "analise", "robos/escritorio.json"
PREFIXO = "MoraisEng - "
MAX_RODADAS = 30            # por robô, as mais novas
MAX_DIAS = 45               # rodadas mais velhas que isto saem do arquivo
VERSAO = 1

SEM_JANELA = getattr(subprocess, "CREATE_NO_WINDOW", 0)
_RE_PDF = re.compile(r"^(\d{4}-\d\d-\d\d)_(\d{4})_(.+)_(ok|FALHOU)\.pdf$")


def slug(nome: str) -> str:
    s = unicodedata.normalize("NFKD", str(nome or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-") or "automacao"


# ------------------------------------------------------------------ 1. rodada → .json ao lado do PDF
def _iso(v):
    return v.isoformat(timespec="seconds") if isinstance(v, (dt.datetime, dt.date)) else v


def registro_da_rodada(r: dict, pdf: pathlib.Path | None, explicar=None) -> dict:
    """O dicionário do relatório (montar() do rodar_e_relatar.py) em forma de JSON, com o 'o que fazer' pronto."""
    atencao, vistos = [], set()
    falhas = r.get("falhas") or []
    for i in falhas or ([] if r.get("ok") else [{"parte": r.get("nome"), "texto": ""}]):
        oque, fazer = (explicar(i.get("texto") or "") if explicar else ("", ""))
        if (oque, fazer) in vistos:
            continue
        vistos.add((oque, fazer))
        atencao.append({"parte": i.get("parte") or "", "oque": oque or "falhou.", "fazer": fazer or ""})
    porteiro = str(r.get("porteiro") or "")
    if porteiro and not porteiro.startswith("porteiro: logado"):
        atencao.append({"parte": "Porteiro", "oque": "a sessão do Mais Controle está fora.",
                        "fazer": "entrar pela janela do Chrome central no servidor."})
    rep = r.get("repeticao")
    return {
        "robo": r.get("robo"), "nome": r.get("nome"), "inicio": _iso(r.get("inicio")), "fim": _iso(r.get("fim")),
        "ok": bool(r.get("ok")), "codigo": r.get("codigo"), "porteiro": porteiro, "gravando": r.get("gravando"),
        "itens": [{"hora": i.get("hora"), "parte": i.get("parte"), "codigo": i.get("codigo"),
                   "texto": str(i.get("texto") or "")[:600]} for i in (r.get("itens") or [])],
        "atencao": atencao,
        "indices": r.get("indices") or [],
        "evidencias": len(r.get("evidencias") or []),
        "saida": [str(l)[:300] for l in (r.get("saida") or [])][-30:],
        "repeticao": ({"motivo": str(rep.get("motivo") or "")[:300],
                       "itens": [{"hora": i.get("hora"), "parte": i.get("parte"), "codigo": i.get("codigo"),
                                  "texto": str(i.get("texto") or "")[:300]}
                                 for i in (rep.get("itens") or []) if i.get("codigo")]} if rep else None),
        "pdf": pdf.name if pdf else None,
    }


def salvar_rodada(r: dict, pdf: pathlib.Path, explicar=None) -> pathlib.Path:
    destino = pdf.with_suffix(".json")
    destino.write_text(json.dumps(registro_da_rodada(r, pdf, explicar), ensure_ascii=False, indent=1),
                       encoding="utf-8")
    return destino


# ------------------------------------------------------------------ 1b. rodada antiga: o motivo lido do próprio PDF (04/11)
def ler_pdf(caminho: pathlib.Path) -> str:
    """Texto do PDF do relatório (pypdf, que o servidor já tem pelo app do porteiro). "" se não der."""
    try:
        import pypdf
        r = pypdf.PdfReader(str(caminho))
        return "\n".join((p.extract_text() or "") for p in r.pages)
    except Exception:
        return ""


def do_texto_do_pdf(texto: str) -> dict:
    """Do texto do PDF do rodar_e_relatar.py tira o que a página precisa para dizer o MOTIVO: o bloco
    "O que precisa de atenção" (parte, o que aconteceu, o que fazer), a linha do porteiro e a da rodada."""
    t = (texto or "").replace("n\ufffdo", "não").replace("est\ufffd", "está").replace(" \ufffd ", " — ").replace("\ufffd", "-")
    linhas = [l.strip() for l in t.splitlines() if l.strip()]
    out = {"pdf_texto": "\n".join(linhas)[:4000]}
    for l in linhas:
        if l.startswith("Rodada de "):
            out["pdf_meta"] = l[:300]
        if l.startswith("porteiro:"):
            i = linhas.index(l)
            junto = l + (" " + linhas[i + 1] if i + 1 < len(linhas) and not linhas[i + 1].startswith(("Precisou", "O que")) else "")
            out["porteiro"] = junto[:300]
            break
    try:
        ini = linhas.index("O que precisa de atenção") + 1
    except ValueError:
        return out
    fim = next((i for i in range(ini, len(linhas)) if linhas[i].startswith("O que rodou") or linhas[i].startswith("Índices depois")), len(linhas))
    itens, atual = [], None
    for l in linhas[ini:fim]:
        if l.startswith("Nada. Rodada completa"):
            break
        if l.startswith("O que fazer:"):
            if atual is not None:
                atual["fazer"] = l[len("O que fazer:"):].strip()
            continue
        m = re.match(r"^([^:]{2,60}):\s*(.*)$", l)
        if m and not (atual is not None and atual.get("fazer") is None and not atual["oque"].endswith((".", "!", "?", ")"))):
            atual = {"parte": m.group(1).strip(), "oque": m.group(2).strip(), "fazer": None}
            itens.append(atual)
        elif atual is not None:                    # linha que quebrou: continua o campo de antes
            if atual["fazer"] is None:
                atual["oque"] = (atual["oque"] + " " + l).strip()
            else:
                atual["fazer"] = (atual["fazer"] + " " + l).strip()
    out["atencao"] = [{"parte": i["parte"], "oque": i["oque"][:300], "fazer": (i["fazer"] or "")[:300]} for i in itens]
    return out


# ------------------------------------------------------------------ 2. histórico das rodadas
def rodadas(pasta: pathlib.Path = RELATORIOS, hoje: dt.date | None = None) -> dict:
    """{robô: [rodada mais nova primeiro]}. PDF sem .json (antes de 03/11) entra só com data, hora e ok/falhou."""
    hoje = hoje or dt.date.today()
    limite = (hoje - dt.timedelta(days=MAX_DIAS)).isoformat()
    por_robo: dict[str, list] = {}
    if not pasta.exists():
        return por_robo
    for pdf in pasta.rglob("*.pdf"):
        m = _RE_PDF.match(pdf.name)
        if not m or m.group(1) < limite:
            continue
        js = pdf.with_suffix(".json")
        reg = None
        if js.exists():
            try:
                reg = json.loads(js.read_text(encoding="utf-8"))
            except Exception:
                reg = None
        if not reg:
            d, h = m.group(1), m.group(2)
            reg = {"robo": m.group(3), "inicio": "%sT%s:%s:00" % (d, h[:2], h[2:]), "ok": m.group(4) == "ok",
                   "so_pdf": True, "pdf": pdf.name}
            texto = ler_pdf(pdf) if not reg["ok"] else ""   # 04/11: o motivo sai do próprio PDF (só das que falharam)
            if texto.strip():
                reg.update(do_texto_do_pdf(texto))
        por_robo.setdefault(reg.get("robo") or m.group(3), []).append(reg)
    for k in por_robo:
        por_robo[k].sort(key=lambda x: x.get("inicio") or "", reverse=True)
        por_robo[k] = por_robo[k][:MAX_RODADAS]
    return por_robo


# ------------------------------------------------------------------ 3. tarefas agendadas
_PS = r"""
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'
$lista = foreach ($t in (Get-ScheduledTask -TaskName 'MoraisEng*')) {
  $i = $t | Get-ScheduledTaskInfo
  [pscustomobject]@{
    nome = $t.TaskName; estado = [string]$t.State
    ultima = $(if ($i.LastRunTime -and $i.LastRunTime.Year -gt 2000) { $i.LastRunTime.ToString('s') } else { $null })
    proxima = $(if ($i.NextRunTime -and $i.NextRunTime.Year -gt 2000) { $i.NextRunTime.ToString('s') } else { $null })
    resultado = $i.LastTaskResult
    acoes = @($t.Actions | ForEach-Object { [string]$_.Execute + ' ' + [string]$_.Arguments })
    gatilhos = @($t.Triggers | ForEach-Object { [pscustomobject]@{
      tipo = [string]$_.CimClass.CimClassName; inicio = [string]$_.StartBoundary; ativo = $_.Enabled
      dias = $_.DaysOfWeek; cadaDias = $_.DaysInterval; cadaSemanas = $_.WeeksInterval
      repetir = [string]$_.Repetition.Interval; duracao = [string]$_.Repetition.Duration } })
  }
}
ConvertTo-Json -InputObject @($lista) -Depth 5 -Compress
"""

RESULTADOS = {0: "terminou bem", 267009: "trabalhando agora", 267011: "ainda não rodou",
              267014: "foi interrompida", 2147750687: "já estava rodando (pulou)", 1: "terminou com erro"}
DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"]


def _duracao_min(iso: str) -> int:
    """PT2H → 120, PT1M → 1, P1D → 1440, '' → 0."""
    m = re.match(r"^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$", str(iso or ""))
    if not m:
        return 0
    d, h, mi, _s = (int(x or 0) for x in m.groups())
    return d * 1440 + h * 60 + mi


def _cada(minutos: int) -> str:
    if minutos % 60 == 0:
        h = minutos // 60
        return "de hora em hora" if h == 1 else "de %d em %d h" % (h, h)
    return "a cada minuto" if minutos == 1 else "a cada %d min" % minutos


def _dias_texto(mascara: int) -> str:
    """Bits do Windows: domingo=1, segunda=2 … sábado=64. Seguidos viram 'seg a sex'."""
    marcados = [i for i in range(7) if mascara & (1 << i)]
    if len(marcados) == 7:
        return "todo dia"
    ordem = [(i + 1) % 7 for i in range(7)]               # segunda primeiro
    seq = [i for i in ordem if i in marcados]
    blocos, atual = [], []
    for i in seq:
        if atual and ordem.index(i) != ordem.index(atual[-1]) + 1:
            blocos.append(atual)
            atual = []
        atual.append(i)
    if atual:
        blocos.append(atual)
    partes = [DIAS[b[0]] if len(b) == 1 else ("%s e %s" % (DIAS[b[0]], DIAS[b[1]]) if len(b) == 2
                                               else "%s a %s" % (DIAS[b[0]], DIAS[b[-1]])) for b in blocos]
    return ", ".join(partes)


def horario_texto(g: dict) -> str:
    tipo = str(g.get("tipo") or "")
    inicio = str(g.get("inicio") or "")
    hora = inicio[11:16] if len(inicio) >= 16 else ""
    rep = _duracao_min(g.get("repetir"))
    dur = _duracao_min(g.get("duracao"))
    faixa = ""
    if rep:
        if dur and hora:
            h0 = int(hora[:2]) * 60 + int(hora[3:5])
            fim = (h0 + dur) % 1440
            faixa = "das %s às %02d:%02d, %s" % (hora, fim // 60, fim % 60, _cada(rep))
        else:
            faixa = _cada(rep) + (" (desde %s)" % hora if hora and rep >= 60 else "")
    if "Logon" in tipo:
        return "quando o usuário do servidor entra" + (" e " + faixa if faixa else "")
    if "Boot" in tipo:
        return "quando o servidor liga" + (" e " + faixa if faixa else "")
    if "Weekly" in tipo:
        dias = _dias_texto(int(g.get("dias") or 0))
        return "%s, %s" % (dias, faixa) if faixa else "%s às %s" % (dias, hora)
    if "Daily" in tipo:
        n = int(g.get("cadaDias") or 1)
        base = "todo dia" if n <= 1 else "a cada %d dias" % n
        return "%s, %s" % (base, faixa) if faixa else "%s às %s" % (base, hora)
    if "Time" in tipo:
        return faixa or ("uma vez, %s %s" % (inicio[8:10] + "/" + inicio[5:7], hora) if hora else "uma vez")
    return tipo.replace("MSFT_Task", "").replace("Trigger", "") or "?"


def chave_da_tarefa(nome: str, acoes: list) -> str:
    cmd = " ".join(acoes or [])
    m = re.search(r"--robo\s+\"?(\w+)", cmd)
    if m:
        return m.group(1)
    if "--indices" in cmd:
        return "indices"
    m = re.search(r"--nome\s+\"([^\"]+)\"", cmd)
    if m:
        return slug(m.group(1))
    n = nome[len(PREFIXO):] if nome.startswith(PREFIXO) else nome
    if "porteiro" in n.lower():
        return "porteiro"
    if "fila" in n.lower() or (cmd.strip().endswith("robo_fila.py") or cmd.strip().endswith('robo_fila.py"')):
        return "fila"
    return slug(n)


def montar_tarefas(cruas: list) -> list:
    out = []
    for t in cruas or []:
        nome = str(t.get("nome") or "")
        gat = [g for g in (t.get("gatilhos") or []) if g and g.get("ativo") is not False]
        res = t.get("resultado")
        try:
            res = int(res) if res is not None else None
        except (TypeError, ValueError):
            res = None
        if res is not None and res < 0:
            res += 1 << 32
        out.append({
            "nome": nome, "titulo": nome[len(PREFIXO):] if nome.startswith(PREFIXO) else nome,
            "chave": chave_da_tarefa(nome, t.get("acoes") or []),
            "estado": {"Ready": "pronta", "Running": "trabalhando", "Disabled": "desligada",
                       "Queued": "na fila"}.get(str(t.get("estado")), str(t.get("estado") or "").lower()),
            "ultima": t.get("ultima"), "proxima": t.get("proxima"), "resultado": res,
            "resultado_texto": (RESULTADOS.get(res) or ("terminou com código %s" % res)) if res is not None else "",
            "horario": [horario_texto(g) for g in gat] or ["sem horário (só à mão)"],
            # 04/11: os gatilhos crus (para a Agenda de hoje: quais horários caem no dia)
            "gat": [{k: g.get(k) for k in ("tipo", "inicio", "dias", "cadaDias", "repetir", "duracao")} for g in gat],
        })
    out.sort(key=lambda x: x["nome"])
    return out


def horarios_do_dia(gatilhos: list, dia: dt.date, maximo: int = 24) -> list:
    """Horários ("HH:MM") em que as tarefas caem no `dia`, pelos gatilhos do Agendador. Repetição de menos de
    30 min (a fila, de minuto em minuto) não entra: vira agenda contínua, não lista de horários."""
    horas = set()
    for g in gatilhos or []:
        tipo, ini = str(g.get("tipo") or ""), str(g.get("inicio") or "")
        if len(ini) < 16 or not ("Daily" in tipo or "Weekly" in tipo or "Time" in tipo):
            continue
        try:
            d0 = dt.date.fromisoformat(ini[:10])
            h0 = int(ini[11:13]) * 60 + int(ini[14:16])
        except ValueError:
            continue
        if dia < d0:
            continue
        if "Daily" in tipo and (dia - d0).days % max(1, int(g.get("cadaDias") or 1)):
            continue
        if "Weekly" in tipo and not (int(g.get("dias") or 0) & (1 << ((dia.weekday() + 1) % 7))):
            continue
        rep_ = _duracao_min(g.get("repetir"))
        if "Time" in tipo and not rep_ and dia != d0:
            continue
        if rep_ and rep_ < 30:
            continue
        dur = _duracao_min(g.get("duracao")) if rep_ else 0
        if rep_ and not dur:
            dur = 1440 - h0 - 1
        m = h0
        while m <= h0 + dur and m < 1440 and len(horas) < maximo:
            horas.add("%02d:%02d" % (m // 60, m % 60))
            if not rep_:
                break
            m += rep_
    return sorted(horas)


def ler_tarefas() -> list:
    if os.name != "nt":
        return []
    r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", _PS],
                       capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=90,
                       creationflags=SEM_JANELA)
    texto = (r.stdout or "").strip()
    if not texto or texto == "[]":
        raise RuntimeError("o Agendador não devolveu as tarefas (código %s) %s" % (
            r.returncode, " ".join((r.stderr or "").split())[:160]))
    dados = json.loads(texto[texto.index("["):] if "[" in texto else texto)
    return montar_tarefas(dados if isinstance(dados, list) else [dados])


# ------------------------------------------------------------------ 4. log do servidor (04/11)
_RE_LOG = re.compile(r"^(\d\d:\d\d:\d\d) \[([\w-]+)\] (.*)$")


def linhas_do_log(pasta: pathlib.Path | None = None, hoje: dt.date | None = None, dias: int = DIAS_LOG) -> dict:
    """{robô: [{"em", "de", "texto"}]} das linhas do _central\\logs dos últimos `dias`. O log é curto de propósito
    (código, contagens e o motivo do erro — nunca nome, CPF ou valor). [relatorio-X] vai junto do robô X."""
    pasta, hoje = pasta or LOGS, hoje or dt.date.today()
    por: dict[str, list] = {}
    for i in range(dias - 1, -1, -1):
        d = hoje - dt.timedelta(days=i)
        arq = pasta / ("robos-portal-%s.log" % d.isoformat())
        if not arq.exists():
            continue
        for linha in arq.read_text(encoding="utf-8", errors="replace").splitlines():
            m = _RE_LOG.match(linha.strip())
            if not m or m.group(2) == "escritorio":
                continue
            tag = m.group(2)
            robo = tag[len("relatorio-"):] if tag.startswith("relatorio-") else ("fila" if tag in ("producao", "teste") else tag)
            por.setdefault(robo, []).append({"em": "%sT%s" % (d.isoformat(), m.group(1)),
                                             "de": "relatório" if tag.startswith("relatorio-") else tag,
                                             "texto": m.group(3).replace("\ufffd", "-")[:400]})
    return {k: v[-MAX_LOG:] for k, v in por.items()}


def anexar_log(rods: dict, log: dict) -> None:
    """Cada rodada ganha as linhas do log entre o começo dela e a rodada seguinte (no máx. 50 min) — é o que
    explica o erro de uma rodada que só tem PDF (antes do .json) e o que o robô escreveu além do relatório."""
    for robo, lista in rods.items():
        linhas = log.get(robo) or []
        if not linhas:
            continue
        ordem = sorted(lista, key=lambda x: x.get("inicio") or "")
        for i, r in enumerate(ordem):
            ini = dt.datetime.fromisoformat(str(r.get("inicio"))[:19])
            fim = ini + dt.timedelta(minutes=50)
            if i + 1 < len(ordem):
                fim = min(fim, dt.datetime.fromisoformat(str(ordem[i + 1].get("inicio"))[:19]))
            r["log"] = [l for l in linhas if ini - dt.timedelta(minutes=1) <= dt.datetime.fromisoformat(l["em"]) < fim][:40]


# ------------------------------------------------------------------ 5. porteiro de verdade (04/11)
PROBLEMAS_PORTEIRO = ("não está logado", "não responde na porta", "porteiro: PROBLEMA", "SEM LOGIN")


def porteiro_estado(log: dict, rods: dict, porteiro_log: pathlib.Path | None = None, agora: dt.datetime | None = None) -> dict:
    """04/11: o porteiro.log dizia "ok" enquanto os robôs davam com a tela de login (o Chrome central reiniciou
    às 06:31). Vale o que os ROBÔS viram por último (últimas 12 h); sem isso, o porteiro.log."""
    agora = agora or dt.datetime.now()
    ev = []
    for robo, linhas in log.items():
        if robo == "fila":
            continue
        for l in linhas:
            t = l["texto"]
            if any(p in t for p in PROBLEMAS_PORTEIRO):
                ev.append((l["em"], False, t))
            elif "porteiro: logado" in t:
                ev.append((l["em"], True, t))
    for lista in rods.values():
        for r in lista:
            if r.get("porteiro"):
                ev.append((str(r.get("fim") or r.get("inicio"))[:19], r["porteiro"].startswith("porteiro: logado"), r["porteiro"]))
    limite = (agora - dt.timedelta(hours=12)).isoformat(timespec="seconds")
    ev = sorted(e for e in ev if e[0] >= limite)
    ultima_pl = ""
    try:
        if (porteiro_log or PORTEIRO_LOG).exists():
            ultima_pl = [l.strip() for l in (porteiro_log or PORTEIRO_LOG).read_text(encoding="utf-8", errors="replace").splitlines() if l.strip()][-1]
    except Exception:
        pass
    if ev:
        em, ok, texto = ev[-1]
        return {"estado": "ok" if ok else "fora", "em": em, "texto": texto[:300], "fonte": "robôs",
                "porteiro_log": ultima_pl[:200]}
    if ultima_pl:
        ok = ultima_pl.endswith(" ok") or ultima_pl.endswith("; ok")
        em = ultima_pl[:19].replace(" ", "T")
        return {"estado": "ok" if ok else "fora", "em": em, "texto": ultima_pl[24:][:300], "fonte": "porteiro.log",
                "porteiro_log": ultima_pl[:200]}
    return {"estado": "?", "em": None, "texto": "", "fonte": "", "porteiro_log": ""}


def conferir_porteiro(espera: float = 45.0) -> tuple[bool | None, str]:
    """04/11: confere DE VERDADE, como um robô faria: abre uma aba no Chrome central e vê se a tela entra logada
    (a mesma conferência do robo_fila.py --verificar). Assim a mesa do porteiro fica vermelha em até 5 min, mesmo
    sem nenhum robô rodando. Só no servidor. (None, motivo) se não deu para conferir."""
    if os.name != "nt":
        return None, ""
    try:
        raiz = str(pathlib.Path(__file__).resolve().parent.parent)
        if raiz not in sys.path:
            sys.path.insert(0, raiz)
        from venda.mc.porteiro import AbaPorteiro, PorteiroErro
    except Exception as e:
        return None, "sem o código do porteiro (%s)" % type(e).__name__
    try:
        aba = AbaPorteiro.abrir(espera=espera)
    except PorteiroErro as e:
        return False, str(e)[:300]
    except Exception as e:
        return None, "%s: %s" % (type(e).__name__, str(e)[:200])
    try:
        aba.fechar()
    except Exception:
        pass
    return True, "porteiro: logado no Mais Controle (conferido pelo Escritório)"


# ------------------------------------------------------------------ montar e subir
def tarefas_com_reserva(erros: list) -> list:
    """O Agendador às vezes não responde (a página ficava sem os horários): usa a última leitura boa."""
    try:
        tarefas = ler_tarefas()
        TAREFAS_CACHE.write_text(json.dumps({"em": dt.datetime.now().isoformat(timespec="seconds"), "tarefas": tarefas},
                                            ensure_ascii=False), encoding="utf-8")
        return tarefas
    except Exception as e:
        motivo = "%s %s" % (type(e).__name__, str(e)[:150])
    try:
        c = json.loads(TAREFAS_CACHE.read_text(encoding="utf-8"))
        erros.append("horários da leitura de %s (agora: %s)" % (str(c.get("em"))[11:16], motivo))
        return c.get("tarefas") or []
    except Exception:
        erros.append("tarefas: " + motivo)
        return []


def montar(hoje: dt.date | None = None, conferir: bool = True) -> dict:
    erros = []
    tarefas = tarefas_com_reserva(erros) if os.name == "nt" else []
    dia = hoje or dt.date.today()
    for t in tarefas:
        t["hoje"] = horarios_do_dia(t.get("gat") or [], dia)
    try:
        saude = json.loads(SAUDE.read_text(encoding="utf-8")) if SAUDE.exists() else {}
    except Exception as e:
        saude, _ = {}, erros.append("saúde: %s" % type(e).__name__)
    rods = rodadas(hoje=hoje)
    try:
        log = linhas_do_log(hoje=hoje)
    except Exception as e:
        log, _ = {}, erros.append("log: %s" % type(e).__name__)
    try:
        anexar_log(rods, log)
    except Exception as e:
        erros.append("log das rodadas: %s" % type(e).__name__)
    porteiro = porteiro_estado(log, rods)
    if conferir:
        ok, texto = conferir_porteiro()
        if ok is not None:          # a conferência de agora vale mais que qualquer linha antiga
            porteiro.update({"estado": "ok" if ok else "fora", "em": dt.datetime.now().isoformat(timespec="seconds"),
                             "texto": texto, "fonte": "conferência"})
        elif texto:
            erros.append("porteiro: não deu para conferir agora (%s)" % texto)
    try:
        import reorganizar as RZ          # 04/11: o plano do Coordenador da fila, se houver
        coordenador = RZ.ler()
    except Exception:
        coordenador = None
    return {"versao": VERSAO, "gerado": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
            "tarefas": tarefas, "rodadas": rods, "saude": saude, "log": log,
            "porteiro": porteiro, "coordenador": coordenador, "avisos": erros}


def subir_pdfs(dados: dict, log=print) -> int:
    """04/11: o PDF de cada rodada (o mesmo do e-mail) sobe uma vez para analise/robos/pdf/AAAA-MM/… e a rodada
    ganha "pdf_caminho" — a página pede ao Apps Script (escritorioPdf) um link de 15 min e mostra o PDF ali."""
    try:
        enviados = set(PDFS_ENVIADOS.read_text(encoding="utf-8").split()) if PDFS_ENVIADOS.exists() else set()
    except Exception:
        enviados = set()
    url = chave = None
    novos = 0
    for lista in (dados.get("rodadas") or {}).values():
        for r in lista:
            nome = r.get("pdf")
            m = _RE_PDF.match(str(nome or ""))
            if not m:
                continue
            caminho = "%s/%s/%s" % (PASTA_PDF, m.group(1)[:7], nome)
            if caminho not in enviados:
                if novos >= MAX_PDF_POR_VEZ:
                    continue
                local = RELATORIOS / m.group(1)[:7] / nome
                if not local.exists():
                    continue
                try:
                    if url is None:
                        url, chave = _cfg_supabase()
                    req = urllib.request.Request("%s/storage/v1/object/%s/%s" % (url, BUCKET, caminho), data=local.read_bytes(),
                                                 method="POST", headers={"apikey": chave, "Authorization": "Bearer " + chave,
                                                                         "Content-Type": "application/pdf", "x-upsert": "true"})
                    urllib.request.urlopen(req, timeout=60).read()
                    enviados.add(caminho)
                    novos += 1
                except Exception as e:
                    log("escritório: PDF %s não subiu (%s)" % (nome, type(e).__name__))
                    continue
            r["pdf_caminho"] = caminho
    if novos:
        PDFS_ENVIADOS.write_text("\n".join(sorted(enviados)) + "\n", encoding="utf-8")
    return novos


def _cfg_supabase() -> tuple[str, str]:
    cfg = (json.loads(CONFIG.read_text(encoding="utf-8")).get("robos") or {})
    url = str((cfg.get("vars") or {}).get("SUPABASE_URL") or os.environ.get("SUPABASE_URL") or "").rstrip("/")
    arq = cfg.get("supabase_key_arquivo")
    chave = pathlib.Path(arq).read_text(encoding="utf-8").strip() if arq and pathlib.Path(arq).exists() \
        else os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    if not (url and chave):
        raise RuntimeError("falta SUPABASE_URL / supabase_key_arquivo em robos-portal.json › robos")
    return url, chave


def subir(dados: dict) -> int:
    url, chave = _cfg_supabase()
    corpo = json.dumps(dados, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8")
    req = urllib.request.Request("%s/storage/v1/object/%s/%s" % (url, BUCKET, CAMINHO), data=corpo, method="POST",
                                 headers={"apikey": chave, "Authorization": "Bearer " + chave,
                                          "Content-Type": "application/json", "x-upsert": "true",
                                          "Cache-Control": "no-cache"})
    urllib.request.urlopen(req, timeout=60).read()
    MARCA.write_text(dt.datetime.now().isoformat(timespec="seconds"), encoding="utf-8")
    return len(corpo)


def publicar(log=print) -> bool:
    try:
        dados = montar()
        pdfs = subir_pdfs(dados, log)
        n = subir(dados)
        log("escritório publicado: %d tarefas, %d robôs com rodadas, %d PDF novo(s), porteiro %s, %d KB" % (
            len(dados["tarefas"]), len(dados["rodadas"]), pdfs, (dados.get("porteiro") or {}).get("estado"), n // 1024))
        return True
    except Exception as e:
        log("escritório FALHOU %s: %s" % (type(e).__name__, str(e)[:200]))
        return False


def publicar_se_passou(minutos: int = 15, log=print) -> bool | None:
    """Para o robo_fila.py (roda a cada minuto): só publica se a última foi há mais de `minutos`."""
    try:
        if MARCA.exists() and time.time() - MARCA.stat().st_mtime < minutos * 60:
            return None
    except Exception:
        pass
    return publicar(log)


def depois_da_rodada(r: dict, pdf: pathlib.Path, explicar=None, log=print) -> None:
    """Chamado pelo rodar_e_relatar.py depois de gerar o PDF. Nunca lança erro."""
    try:
        salvar_rodada(r, pdf, explicar)
    except Exception as e:
        log("escritório: não gravei o .json da rodada (%s: %s)" % (type(e).__name__, str(e)[:150]))
    publicar(log)


if __name__ == "__main__":
    if "--so-montar" in sys.argv:
        d = montar()
        print(json.dumps({"tarefas": [(t["titulo"], t["chave"], t["estado"], t["horario"]) for t in d["tarefas"]],
                          "rodadas": {k: len(v) for k, v in d["rodadas"].items()}, "avisos": d["avisos"]},
                         ensure_ascii=False, indent=1))
        sys.exit(0)
    sys.exit(0 if publicar() else 1)
