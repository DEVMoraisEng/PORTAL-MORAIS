#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
robo_mc_medicoes.py — PORTAL-MORAIS · SÓ LEITURA no Mais Controle (23/10/26)

O Mapa de Obras mostrava UMA medição por obra, presa ao MESTRE da base
DOCUMENTOS. Mas cada obra tem vários empreiteiros (mestre, pintor,
eletricista…) e o mestre pode mudar no meio da obra. Este robô lê, no Mais
Controle, Obras > Medição de Contratos: TODOS os contratos de cada obra (28/10:
também paralisados, finalizados e rascunhos — só o cancelado fica de fora), com
o STATUS DO CONTRATO, o fornecedor, o tipo de serviço e a última medição.

Grava dist/mc_medicoes/contratos.json (servido pelo GitHub Pages; o Mapa de
Obras lê dali). Vai a público: obra, fornecedor, tipo de serviço, título e
status do contrato, data/status/% da última medição. NÃO vai nenhum valor em R$.

Como entra no MC: igual ao robo_mc_bases.py — login pelo navegador (com o
código que chega por e-mail) e, depois, as mesmas chamadas de API que a tela
#/contracts faz, com os cabeçalhos que o próprio site usa.

DESCOBRIR=1 imprime também os valores distintos de status e os campos do
resumo de medição de cada contrato (sem dados de pessoas nem valores).
"""
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

import robo_mc_comum as mc

ERP_API = "https://prod-erp-api.maiscontroleerp.com.br"
CABECALHOS_MC = {"authorization", "organization-unit-id", "user-id", "company-id", "accept"}
SAIDA = Path("dist/mc_medicoes/contratos.json")
DESCOBRIR = os.environ.get("DESCOBRIR", "").strip().lower() in ("1", "true", "sim")
RESUMO = {}

# 28/10/26: o arquivo leva TODOS os contratos (rascunho, a iniciar, em
# andamento, paralisado e finalizado) com o STATUS DO CONTRATO. Quem decide é o
# Mapa de Obras: rascunho / a iniciar / em andamento aparecem nas medições;
# paralisado, finalizado e 100% medido ficam no filtro "Paralisados /
# finalizados". Só o cancelado fica de fora.
FECHADOS = {"CANCELED", "CANCELLED", "CANCELADO", "INACTIVE"}
ROTULO_STATUS = {"DRAFT": "Rascunho", "TO_START": "A iniciar", "IN_PROGRESS": "Em andamento", "PARALYZED": "Paralisado",
                 "FINISHED": "Finalizado", "CANCELED": "Cancelado", "CANCELLED": "Cancelado"}


def log(*a):
    print(*a, flush=True)


def limpo(s):
    return re.sub(r"\s+", " ", str(s or "")).strip()


def estrutura(v, nivel=0):
    if isinstance(v, dict):
        if nivel >= 2:
            return "{%d campos}" % len(v)
        return {k: estrutura(x, nivel + 1) for k, x in list(v.items())[:40]}
    if isinstance(v, list):
        return ["lista[%d]" % len(v)] + ([estrutura(v[0], nivel + 1)] if v else [])
    return type(v).__name__


def capturar_erp(page):
    """Abre #/contracts e guarda os cabeçalhos que o site manda para a API nova."""
    for tent in range(3):
        try:
            with page.expect_request(lambda r: "prod-erp-api." in r.url and "/plannings/contracts" in r.url,
                                     timeout=60000) as ri:
                if tent == 0:
                    page.evaluate("h => { location.hash = h }", "#/contracts")
                else:
                    page.evaluate("() => { location.hash = '#/home' }")
                    page.wait_for_timeout(2500)
                    page.evaluate("h => { location.hash = h }", "#/contracts")
            req = ri.value
            h = {k: v for k, v in req.all_headers().items() if k.lower() in CABECALHOS_MC}
            if any(k.lower() == "authorization" for k in h):
                q = urlparse(req.url).query
                log(f"  lista de contratos: parâmetros que o site usa: {re.sub(r'=[^&]*', '=…', q) or '(nenhum)'}")
                return h
        except Exception as e:
            log(f"  … tentativa {tent + 1} sem resposta da lista de contratos ({str(e)[:120]})")
    mc.foto(page, "medicoes_sem_acesso")
    raise SystemExit("Não consegui pegar o acesso da API de contratos do MC (tela #/contracts).")


class Erp:
    def __init__(self, page, h):
        self.page, self.h = page, h

    def get(self, caminho):
        ultimo = ""
        for tent in range(4):
            try:
                r = self.page.request.get(f"{ERP_API}/{caminho}", headers=self.h, timeout=60000)
                if r.ok:
                    return r.json()
                ultimo = f"HTTP {r.status}"
                if r.status in (401, 403, 404):
                    break
            except Exception as e:
                ultimo = str(e)[:160]
            time.sleep(2 + tent * 3)
        raise RuntimeError(f"MC não respondeu {caminho.split('?')[0]} — {ultimo}")

    def contratos(self):
        todos, vistos = [], set()
        for pagina in range(1, 200):
            j = self.get(f"plannings/contracts?pageIndex={pagina}&pageSize=100")
            itens = j.get("items") or []
            novos = [i for i in itens if i.get("id") not in vistos]
            for i in novos:
                vistos.add(i.get("id"))
            todos += novos
            if not itens or not novos or not j.get("hasNextPage"):
                break
        return todos

    def medicoes(self, planning_id):
        """Últimas medições do contrato (a tela usa estes parâmetros na aba Medições)."""
        for q in ("pageIndex=1&pageSize=20&planningOption=CONTRACT", "pageIndex=1&pageSize=20", "pageIndex=1"):
            try:
                j = self.get(f"work-measurements/{planning_id}/measurements?{q}")
                return j.get("items") or []
            except RuntimeError:
                continue
        return None


def ultima_medicao(meds):
    if not meds:
        return None
    def chave(m):
        return (str(m.get("measurementDate") or m.get("creationDate") or ""), int(m.get("number") or 0))
    m = sorted(meds, key=chave)[-1]
    return {
        "numero": m.get("number"),
        "data": str(m.get("measurementDate") or m.get("creationDate") or "")[:10] or None,
        "lancada_em": str(m.get("creationDate") or "")[:10] or None,
        "status": limpo(m.get("measurementStatus")),
        "pct": round(float(m.get("measuredPercentage") or 0), 2),
        "titulo": limpo(m.get("title"))[:120],
    }


# 29/10/26 — STATUS DA OBRA no Mais Controle (o Mapa de Obras filtra por ele).
# A lista de contratos não traz o status da obra: o robô abre "Minhas Obras"
# (#/work), pega a chamada de API que a própria tela faz para listar as obras e
# lê todas as páginas. Só nome, id e status da obra vão para o arquivo.
ROTULO_OBRA = {"IN_BUDGET": "Em orçamento", "BUDGET": "Em orçamento", "BUDGETING": "Em orçamento", "QUOTATION": "Em orçamento",
               "TO_START": "A iniciar", "NOT_STARTED": "A iniciar", "IN_PROGRESS": "Em andamento", "STARTED": "Em andamento",
               "PARALYZED": "Paralisada", "PAUSED": "Paralisada", "STOPPED": "Paralisada", "FINISHED": "Finalizada",
               "CONCLUDED": "Finalizada", "DONE": "Finalizada", "CANCELED": "Cancelada", "CANCELLED": "Cancelada"}
_NOMES = ("workname", "name", "nome", "title", "description")


def _campo(d, preds):
    for k, v in (d or {}).items():
        if any(p(k.lower()) for p in preds) and isinstance(v, (str, int, float)) and str(v).strip():
            return k, v
    return None, None


def _itens(j):
    if isinstance(j, list):
        return j
    if isinstance(j, dict):
        for k in ("items", "data", "content", "results"):
            if isinstance(j.get(k), list):
                return j[k]
    return None


def status_das_obras(page, erp):
    """{workId: {"nome", "status", "status_txt"}} lendo a tela Minhas Obras."""
    resp = []

    def ouvir(r):
        if "prod-erp-api." in r.url and r.request.method == "GET":
            resp.append(r)
    page.on("response", ouvir)
    try:
        page.evaluate("() => { location.hash = '#/home' }")
        page.wait_for_timeout(1500)
        page.evaluate("() => { location.hash = '#/work' }")
        page.wait_for_timeout(9000)
    finally:
        page.remove_listener("response", ouvir)
    caminhos, alvo = [], None
    for r in resp:
        u = urlparse(r.url)
        caminhos.append(u.path + ("?" + re.sub(r"=[^&]*", "=…", u.query) if u.query else ""))
        if alvo:
            continue
        try:
            itens = _itens(r.json())
        except Exception:
            continue
        if not itens or not isinstance(itens[0], dict):
            continue
        k_st, _ = _campo(itens[0], [lambda k: k == "status" or k.endswith("status")])
        k_nm, _ = _campo(itens[0], [lambda k: k in _NOMES])
        if k_st and k_nm and "contract" not in u.path:
            alvo = (u, k_st, k_nm)
    RESUMO["obras_chamadas_api"] = sorted(set(caminhos))[:40]
    if not alvo:
        log("  ! não achei a lista de obras na tela Minhas Obras (status da obra fica de fora)")
        return {}
    u, k_st, k_nm = alvo
    base = u.path.split("/", 1)[1] if u.path.startswith("/") else u.path
    q = dict(x.split("=", 1) for x in u.query.split("&") if "=" in x)
    obras, vistos = {}, set()
    for pagina in range(1, 100):
        if "pageIndex" in q:
            q["pageIndex"] = str(pagina)
        if "pageSize" in q:
            q["pageSize"] = "100"
        j = erp.get(base + ("?" + "&".join(f"{k}={v}" for k, v in q.items()) if q else ""))
        itens = _itens(j) or []
        novos = 0
        for o in itens:
            oid = o.get("id") or o.get("workId")
            if not oid or oid in vistos:
                continue
            vistos.add(oid)
            novos += 1
            st = limpo(o.get(k_st)).upper()
            obras[oid] = {"nome": limpo(o.get(k_nm)), "status": st,
                          "status_txt": ROTULO_OBRA.get(st, limpo(o.get(k_st)).replace("_", " ").title())}
        if "pageIndex" not in q or not itens or not novos or (isinstance(j, dict) and j.get("hasNextPage") is False):
            break
    cont = {}
    for o in obras.values():
        cont[o["status"]] = cont.get(o["status"], 0) + 1
    log(f"Obras no MC: {len(obras)} · status: {cont}")
    RESUMO["obras_por_status"] = cont
    return obras


def registro(c, ult, n_meds):
    w = c.get("workResponse") or {}
    pt = c.get("participantResponse") or {}
    st = c.get("serviceTypeResponse") or {}
    status = limpo(c.get("status")).upper()
    return {
        "id": c.get("id"),
        "codigo": limpo(c.get("code")),
        "titulo": limpo(c.get("title"))[:160],
        "status": status,
        "status_txt": ROTULO_STATUS.get(status, limpo(c.get("status")).replace("_", " ").title()),
        "obra_id": w.get("workId") or w.get("id"),
        "obra": limpo(w.get("workName") or w.get("name")),
        "fornecedor": limpo(pt.get("participantName") or pt.get("name")),
        "servico": limpo(st.get("serviceTypeName") or st.get("name")),
        "medicoes": n_meds,
        "ultima": ult,
    }


def main():
    obras_mc = {}
    with sync_playwright() as p:
        b, page = mc.abrir(p)
        try:
            mc.login(page)
            log("Login no MC ok.")
            erp = Erp(page, capturar_erp(page))
            lista = erp.contratos()
            st = {}
            for c in lista:
                st[limpo(c.get("status")).upper()] = st.get(limpo(c.get("status")).upper(), 0) + 1
            log(f"Contratos no MC: {len(lista)} · por status: {st}")
            if DESCOBRIR and lista:
                log("campos de um contrato:", json.dumps(estrutura(lista[0]), ensure_ascii=False))
                wm = [c.get("workMeasurementResponse") for c in lista if c.get("workMeasurementResponse")]
                if wm:
                    log("workMeasurementResponse:", json.dumps(estrutura(wm[0]), ensure_ascii=False))
            abertos = [c for c in lista if limpo(c.get("status")).upper() not in FECHADOS]
            log(f"No arquivo (todos menos cancelados): {len(abertos)}")
            # 23/10: a própria lista já traz o resumo das medições de cada contrato
            # (workMeasurementResponse: nº de medições, data da última aprovação e
            # % medido) — sem uma chamada por contrato.
            saida, st_med = [], {}
            for c in abertos:
                wm = c.get("workMeasurementResponse") or {}
                n = wm.get("numberOfMeasurements")
                ult = None
                if wm:
                    ult = {"data_aprovacao": str(wm.get("lastMeasurementDateApproval") or "")[:10] or None,
                           "pct": round(float(wm.get("measuredPercentage") or 0), 2)}
                st_med["com medição" if n else "sem medição"] = st_med.get("com medição" if n else "sem medição", 0) + 1
                saida.append(registro(c, ult, n))
            log(f"Medições: {st_med}")
            try:
                obras_mc = status_das_obras(page, erp)
            except Exception as e:
                log(f"  ! status das obras: {str(e)[:150]}")
                obras_mc = {}
            for x in saida:
                o = obras_mc.get(x.get("obra_id")) or {}
                x["obra_status"], x["obra_status_txt"] = o.get("status"), o.get("status_txt")
            RESUMO.update({"contratos_por_status": st, "medicoes_por_status": st_med, "em_aberto": len(abertos)})
            if DESCOBRIR and lista:
                RESUMO["campos_contrato"] = estrutura(lista[0])
                wm = [c.get("workMeasurementResponse") for c in lista if c.get("workMeasurementResponse")]
                if wm:
                    RESUMO["campos_workMeasurementResponse"] = estrutura(wm[0])
        finally:
            b.close()

    saida.sort(key=lambda x: (x["obra"], x["servico"], x["fornecedor"]))
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    SAIDA.write_text(json.dumps({
        "ok": True,
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "total": len(saida),
        "resumo": RESUMO,          # só contagens (e, com DESCOBRIR=1, nomes de campos)
        "contratos": saida,
        "obras": {k: v for k, v in obras_mc.items()},   # 29/10: id -> nome e status da obra no MC
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    obras = len({x["obra"] for x in saida})
    log(f"Gravado {SAIDA}: {len(saida)} contratos (todos os status, menos cancelados) em {obras} obras.")


if __name__ == "__main__":
    sys.exit(main())
