# -*- coding: utf-8 -*-
"""COORDENADOR DA FILA (04/11/2026) — "reorganizar" os robôs quando vários falharam.

Pedido do dono: quando der vários erros, um robô que, com um clique no Escritório de Robôs, põe quem falhou numa
fila e roda UM DE CADA VEZ, na ordem certa, sem um passar por cima do outro.

Como funciona (sem prender a fila do portal: um passo por minuto, dentro do robo_fila.py):
  1. O botão do portal manda o pedido robo-rodar com a tarefa especial "MoraisEng - Reorganizar" (o Apps Script
     não muda). O robo_fila.py chama criar_plano(): olha as tarefas agendadas e as rodadas e monta a fila com quem
     falhou nas últimas 26 h, na ordem ORDEM (contas → bases → medições → índices → retratos → anexos → medidores → documentos).
     O plano fica em _central\\reorganizar.json.
  2. A cada minuto o robo_fila.py chama passo():
       - o robô da vez ainda está rodando → espera (no máx. PRAZO_MIN por robô);
       - terminou → anota deu certo / deu errado (o resultado da tarefa) e passa para o próximo;
       - antes de soltar o próximo: nenhum outro robô do MC pode estar rodando (nem um do horário) e o porteiro
         tem que estar logado — senão espera (porteiro fora por mais de 2 h: cancela, com o motivo);
       - solta o próximo com schtasks /Run (a MESMA tarefa do horário: relatório, e-mail e Escritório inclusos).
  3. Acabou a fila → "terminado". O Escritório mostra o plano e o andamento na mesa do Coordenador.

Nunca o porteiro nem a fila do portal. Os robôs já podem rodar duas vezes sem estragar nada (regra da pasta).
"""
from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import subprocess

CENTRAL = pathlib.Path(os.environ.get("MC_CENTRAL") or r"C:\AUTOMAÇÕES MAIS CONTROLE\_central")
PLANO = CENTRAL / "reorganizar.json"
TAREFA_ESPECIAL = "MoraisEng - Reorganizar"
ORDEM = ["contas", "bases", "medicoes", "indices", "retratos", "anexos", "medidores", "documentos"]
FORA = ("porteiro", "fila")
OK_RES = (0, 267009, 267011)          # terminou bem, rodando agora, ainda não rodou
JANELA_H = 26
PRAZO_MIN = 60                         # um robô rodando há mais que isto: segue para o próximo
ESPERA_PORTEIRO_H = 2
CARENCIA_S = 90                        # logo depois do /Run o Agendador ainda não marcou "rodando"
SEM_JANELA = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def agora() -> dt.datetime:
    return dt.datetime.now().replace(microsecond=0)


def _iso(d: dt.datetime) -> str:
    return d.isoformat(timespec="seconds")


def falharam(tarefas: list, rods: dict, ref: dt.datetime | None = None) -> list:
    """[(chave, nome da tarefa)] de quem falhou nas últimas JANELA_H horas, na ORDEM. Pela rodada relatada (o PDF/
    .json do rodar_e_relatar) e, para quem não relata, pelo resultado da tarefa no Agendador."""
    ref = ref or agora()
    limite = _iso(ref - dt.timedelta(hours=JANELA_H))
    por_chave: dict[str, dict] = {}
    for t in tarefas or []:
        ch = t.get("chave")
        # 04/11: só os robôs que entram pelo porteiro (ORDEM); o de água e energia ainda pode logar sozinho no ERP
        if not ch or ch in FORA or ch not in ORDEM or t.get("estado") == "desligada" or ch in por_chave:
            continue
        por_chave[ch] = t
    saida = []
    for ch, t in por_chave.items():
        ult = (rods.get(ch) or [None])[0]
        if ult and str(ult.get("inicio") or "") >= limite:
            ruim = not ult.get("ok")
        else:
            res = t.get("resultado")
            ruim = res is not None and res not in OK_RES and str(t.get("ultima") or "") >= limite
        if ruim:
            saida.append((ch, t["nome"]))
    saida.sort(key=lambda x: (ORDEM.index(x[0]) if x[0] in ORDEM else 99, x[0]))
    return saida


def ler() -> dict | None:
    try:
        return json.loads(PLANO.read_text(encoding="utf-8")) if PLANO.exists() else None
    except Exception:
        return None


def gravar(plano: dict) -> None:
    PLANO.write_text(json.dumps(plano, ensure_ascii=False, indent=1), encoding="utf-8")


def ativo(plano: dict | None) -> bool:
    return bool(plano) and plano.get("status") not in ("terminado", "cancelado")


def criar_plano(tarefas: list, rods: dict, quem: str = "") -> tuple[dict | None, str]:
    """Monta a fila. (plano, "") ou (None, motivo)."""
    atual = ler()
    if ativo(atual):
        return None, "já tem uma reorganização andando (%d na fila)" % sum(1 for i in atual["fila"] if i["estado"] == "esperando")
    lista = falharam(tarefas, rods)
    if not lista:
        return None, "ninguém falhou nas últimas %d h — nada a reorganizar" % JANELA_H
    plano = {"criado": _iso(agora()), "quem": quem[:40], "status": "andando", "msg": "",
             "fila": [{"chave": ch, "tarefa": nome, "estado": "esperando", "inicio": None, "fim": None, "resultado": ""}
                      for ch, nome in lista]}
    gravar(plano)
    return plano, ""


def _rodar(nome: str) -> tuple[bool, str]:
    r = subprocess.run(["schtasks", "/Run", "/TN", nome], capture_output=True, text=True, errors="replace",
                       timeout=60, creationflags=SEM_JANELA)
    return r.returncode == 0, " ".join(((r.stdout or "") + " " + (r.stderr or "")).split())[:200]


def passo(tarefas: list, porteiro_ok, rodar=_rodar, ref: dt.datetime | None = None) -> str | None:
    """Um passo (o robo_fila.py chama a cada minuto). Devolve o que mudou (para o log) ou None se nada.
    `tarefas` = escritorio_robos.ler_tarefas(); `porteiro_ok()` -> (True/False/None, texto)."""
    plano = ler()
    if not ativo(plano):
        return None
    ref = ref or agora()
    por_nome = {t.get("nome"): t for t in tarefas or []}
    fila = plano["fila"]
    vez = next((i for i in fila if i["estado"] == "rodando"), None)
    if vez:
        t = por_nome.get(vez["tarefa"]) or {}
        desde = dt.datetime.fromisoformat(vez["inicio"])
        if (ref - desde).total_seconds() < CARENCIA_S:
            return None
        if t.get("estado") == "trabalhando":
            if ref - desde < dt.timedelta(minutes=PRAZO_MIN):
                return None
            vez.update(estado="falhou", fim=_iso(ref), resultado="passou de %d min rodando — segui para o próximo" % PRAZO_MIN)
        else:
            res = t.get("resultado")
            vez.update(estado="feito" if res == 0 else "falhou", fim=_iso(ref),
                       resultado=t.get("resultado_texto") or ("código %s" % res))
        gravar(plano)
        return "%s: %s (%s)" % (vez["chave"], vez["estado"], vez["resultado"])
    prox = next((i for i in fila if i["estado"] == "esperando"), None)
    if not prox:
        plano.update(status="terminado", msg="%d deram certo, %d deram errado" % (
            sum(1 for i in fila if i["estado"] == "feito"), sum(1 for i in fila if i["estado"] == "falhou")), fim=_iso(ref))
        gravar(plano)
        return "terminado: " + plano["msg"]
    outro = next((t for t in tarefas or [] if t.get("estado") == "trabalhando" and t.get("chave") not in FORA), None)
    if outro:
        msg = "esperando %s terminar (rodando no horário dele)" % outro.get("titulo", outro.get("nome"))
        mudou = plano.get("msg") != msg
        plano.update(status="esperando", msg=msg)
        gravar(plano)
        return msg if mudou else None
    ok, texto = porteiro_ok()
    if ok is False:
        desde = plano.get("porteiro_fora_desde") or _iso(ref)
        plano["porteiro_fora_desde"] = desde
        if ref - dt.datetime.fromisoformat(desde) > dt.timedelta(hours=ESPERA_PORTEIRO_H):
            plano.update(status="cancelado", msg="o porteiro ficou fora do Mais Controle por mais de %d h — cancelei" % ESPERA_PORTEIRO_H, fim=_iso(ref))
            gravar(plano)
            return plano["msg"]
        msg = "esperando o porteiro entrar no Mais Controle (%s)" % texto[:120]
        mudou = plano.get("msg") != msg
        plano.update(status="esperando", msg=msg)
        gravar(plano)
        return msg if mudou else None
    plano.pop("porteiro_fora_desde", None)
    certo, msg = rodar(prox["tarefa"])
    if certo:
        prox.update(estado="rodando", inicio=_iso(ref))
        plano.update(status="andando", msg="rodando %s (%d de %d)" % (prox["chave"], fila.index(prox) + 1, len(fila)))
    else:
        prox.update(estado="falhou", inicio=_iso(ref), fim=_iso(ref), resultado="não disparou: " + msg)
    gravar(plano)
    return "%s: %s" % (prox["chave"], "disparado" if certo else "não disparou " + msg)
