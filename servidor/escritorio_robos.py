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
  - robo_fila.py, a cada 15 min (a fila roda de minuto em minuto): escritorio_robos.publicar_se_passou(15)
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

CENTRAL = pathlib.Path(os.environ.get("MC_CENTRAL") or r"C:\AUTOMAÇÕES MAIS CONTROLE\_central")
CONFIG = CENTRAL / "robos-portal.json"
SAUDE = CENTRAL / "robos-portal-saude.json"
RELATORIOS = CENTRAL / "relatorios-robos"
MARCA = CENTRAL / "escritorio-publicado.txt"      # hora da última publicação (para o robo_fila não subir a cada minuto)
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
        })
    out.sort(key=lambda x: x["nome"])
    return out


def ler_tarefas() -> list:
    if os.name != "nt":
        return []
    r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", _PS],
                       capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=90,
                       creationflags=SEM_JANELA)
    texto = (r.stdout or "").strip()
    if not texto:
        return []
    dados = json.loads(texto[texto.index("["):] if "[" in texto else texto)
    return montar_tarefas(dados if isinstance(dados, list) else [dados])


# ------------------------------------------------------------------ montar e subir
def montar(hoje: dt.date | None = None) -> dict:
    erros = []
    try:
        tarefas = ler_tarefas()
    except Exception as e:
        tarefas, _ = [], erros.append("tarefas: %s %s" % (type(e).__name__, str(e)[:150]))
    try:
        saude = json.loads(SAUDE.read_text(encoding="utf-8")) if SAUDE.exists() else {}
    except Exception as e:
        saude, _ = {}, erros.append("saúde: %s" % type(e).__name__)
    return {"versao": VERSAO, "gerado": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
            "tarefas": tarefas, "rodadas": rodadas(hoje=hoje), "saude": saude, "avisos": erros}


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
        n = subir(dados)
        log("escritório publicado: %d tarefas, %d robôs com rodadas, %d KB" % (
            len(dados["tarefas"]), len(dados["rodadas"]), n // 1024))
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
