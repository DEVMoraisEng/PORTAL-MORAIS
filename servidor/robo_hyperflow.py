# -*- coding: utf-8 -*-
"""ROBÔ DA HYPERFLOW (25/11/2026) — classificação dos leads da Análise de Marketing, todo dia.

O que faz, em cada rodada (tarefas "MoraisEng - HyperFlow leads" às 07:00 e 13:00, pelo robo_fila.py --robo hyperflow):
  1. pede ao Apps Script (ação mkRobo, op "leads", com a chave do robô) os leads das abas de campanha da planilha
     de marketing e a classificação que já está na aba HYPERFLOW;
  2. abre a HyperFlow num Chrome só do robô (perfil em _central\\chrome-hyperflow, já logado com o ADM) e lê
     a) a tela Oportunidades inteira — a etapa de cada lead (Prospecção, Pendente/Ativo/Recusado cliente ou corretor),
        pelas respostas que a própria tela recebe (não pelo desenho da página, que só mostra 10 cartões por vez);
     b) o Histórico de chats — só as conversas novas ou que mudaram desde a rodada anterior (servidor/hyperflow_extrator.js);
  3. classifica (cliente / corretor / respondeu e parou / sem resposta) com a MESMA regra da análise de 24/11 e grava
     só o que mudou (op "gravar"). Correção feita à mão no portal (fonte MANUAL) nunca é sobrescrita;
  4. grava o resultado da rodada (op "status") — a página mostra "lido pelo robô em …".

Ordem de prioridade por lead: etapa da Oportunidade (menos Prospecção) > conversa lida > Prospecção (= sem resposta,
só se ainda não havia nada melhor). Lead que não aparece na HyperFlow fica como está.

Uso:
  python servidor\\robo_hyperflow.py --login     abre o Chrome do robô para o dono entrar na HyperFlow (uma vez só)
  python servidor\\robo_hyperflow.py             rodada normal (sem janela)
  python servidor\\robo_hyperflow.py --ver       rodada com a janela aberta (para conferir)
  python servidor\\robo_hyperflow.py --simular   lê tudo e mostra o que gravaria, sem gravar

Configuração (nada de senha aqui):
  chave do robô: _chaves\\mk-robo.txt (o dono cola a chave que o mkGerarChaveRobo do Apps Script mostra) ou MK_ROBO_CHAVE
  URL do Apps Script: MK_ROBO_URL (padrão: a URL de produção do portal)
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import sys
import time
import urllib.request

AQUI = pathlib.Path(__file__).resolve().parent
CENTRAL = pathlib.Path(os.environ.get("MC_CENTRAL") or r"C:\AUTOMAÇÕES MAIS CONTROLE\_central")
CHAVES = CENTRAL.parent / "_chaves"
PERFIL = CENTRAL / "chrome-hyperflow"
ESTADO = CENTRAL / "hyperflow-robo.json"
EXTRATOR = AQUI / "hyperflow_extrator.js"
URL_PADRAO = ("https://script.google.com/macros/s/"
              "AKfycbwvMnVHZd7y5k-GP8_Dg9zkWyD2fqqH8UI4gaXsQ0iJnm9QNSsyyUhODFMyMW6BfAk/exec")
CONVERSAS = "https://conversas.hyperflow.global/all-chats/all?sort=-createdAt"
OPORTUNIDADES = "https://conversas.hyperflow.global/opportunities/pipeline/leads-morais-engenharia-e-construcap-1"
ETAPAS = {          # etapa da Oportunidade -> (tipo, completo)
    "ativo - cliente": ("CLIENTE", True), "pendente - cliente": ("CLIENTE", False), "recusado - cliente": ("CLIENTE", False),
    "ativo - corretor": ("CORRETOR", True), "pendente - corretor": ("CORRETOR", False), "recusado - corretor": ("CORRETOR", False),
}
PROSPECCAO = "prospecção"
FRACOS = ("", "SEM RESPOSTA", "SEM CONVERSA")      # o que a Prospecção pode substituir
PRAZO_CONVERSAS_MIN = 30


def log(msg: str) -> None:
    print(dt.datetime.now().strftime("%H:%M:%S"), msg, flush=True)


def chave_tel(t) -> str:
    d = "".join(ch for ch in str(t or "") if ch.isdigit())
    if len(d) > 11 and d.startswith("55"):
        d = d[2:]
    return d[:2] + d[-8:] if len(d) >= 10 else ""


def agora_iso() -> str:
    return dt.datetime.now().strftime("%Y-%m-%dT%H:%M")


# ------------------------------------------------------------------ Apps Script
def ler_chave() -> str:
    k = (os.environ.get("MK_ROBO_CHAVE") or "").strip()
    if not k:
        arq = CHAVES / "mk-robo.txt"
        if arq.exists():
            k = arq.read_text(encoding="utf-8").strip()
    if not k:
        raise SystemExit("sem a chave do robô: crie %s com a chave do mkGerarChaveRobo (Apps Script)" % (CHAVES / "mk-robo.txt"))
    return k


def apps_script(op: str, **dados) -> dict:
    corpo = json.dumps(dict(action="mkRobo", op=op, chave=ler_chave(), **dados)).encode("utf-8")
    req = urllib.request.Request(os.environ.get("MK_ROBO_URL") or URL_PADRAO, data=corpo,
                                 headers={"Content-Type": "text/plain;charset=utf-8"})
    with urllib.request.urlopen(req, timeout=180) as r:
        resp = json.loads(r.read().decode("utf-8"))
    if not resp.get("ok"):
        raise RuntimeError("Apps Script (%s): %s" % (op, resp.get("erro")))
    return resp


# ------------------------------------------------------------------ decisão (testável sem navegador)
def decidir(leads: list, atual: dict, etapas: dict, conversas: dict, inicio: str) -> list:
    """leads: [{k, nome}]; atual: {k: {tipo, etapa, fonte}} (aba HYPERFLOW); etapas: {k: nome da etapa da Oportunidade};
    conversas: {k: {tipo, etapa, completo, lida, msgAt}} (HX.classificar); inicio: hora local da rodada.
    Devolve só os itens que mudam alguma coisa."""
    itens, vistos = [], set()
    for l in leads:
        k = l.get("k")
        if not k or k in vistos:
            continue
        vistos.add(k)
        cur = atual.get(k) or {}
        if cur.get("fonte") == "MANUAL":
            continue
        et = (etapas.get(k) or "").strip()
        cv = conversas.get(k)
        novo = None
        if et.lower() in ETAPAS:
            tipo, completo = ETAPAS[et.lower()]
            novo = {"tipo": tipo, "etapa": "Oportunidade: " + et, "completo": completo, "fonte": "HYPERFLOW OPORTUNIDADES"}
        elif cv and cv.get("lida"):
            novo = {"tipo": cv["tipo"], "etapa": cv["etapa"], "completo": bool(cv.get("completo")), "fonte": "HYPERFLOW CONVERSAS"}
        elif et.lower() == PROSPECCAO and (cur.get("tipo") or "") in FRACOS:
            novo = {"tipo": "SEM RESPOSTA", "etapa": "Oportunidade: Prospecção", "completo": False, "fonte": "HYPERFLOW OPORTUNIDADES"}
        elif cv and not cur.get("tipo"):
            novo = {"tipo": cv["tipo"], "etapa": cv["etapa"], "completo": False, "fonte": "HYPERFLOW CONVERSAS"}
        if not novo:
            continue
        if novo["tipo"] == (cur.get("tipo") or "") and novo["etapa"] == (cur.get("etapa") or ""):
            continue
        novo.update({"k": k, "nome": l.get("nome") or "", "at": inicio})
        itens.append(novo)
    return itens


# ------------------------------------------------------------------ navegador
def abrir(pw, ver: bool):
    PERFIL.mkdir(parents=True, exist_ok=True)
    args = dict(user_data_dir=str(PERFIL), headless=not ver, viewport={"width": 1500, "height": 950},
                locale="pt-BR", timezone_id="America/Sao_Paulo")
    try:
        return pw.chromium.launch_persistent_context(channel="chrome", **args)
    except Exception:
        return pw.chromium.launch_persistent_context(**args)


def logado(pg) -> bool:
    pg.goto(CONVERSAS, wait_until="domcontentloaded", timeout=90000)
    for _ in range(40):
        url = pg.url.lower()
        if "login" in url or "signin" in url or "auth" in url.split("?")[0]:
            return False
        if pg.locator("input[type=password]").count():
            return False
        if pg.locator("text=Histórico de chats").count() or pg.locator("p", has_text="#").count():
            return True
        time.sleep(1)
    return pg.locator("input[type=password]").count() == 0 and "login" not in pg.url.lower()


def _andar(obj, achar):
    if isinstance(obj, dict):
        achar(obj)
        for v in obj.values():
            _andar(v, achar)
    elif isinstance(obj, list):
        for v in obj:
            _andar(v, achar)


def ler_oportunidades(pg) -> dict:
    """{chave do telefone: nome da etapa} de todas as oportunidades do funil."""
    docs, nomes = {}, {}

    def resposta(r):
        if "hyperflowapis.global/graphql" not in r.url:
            return
        try:
            js = r.json()
        except Exception:
            return

        def achar(d):
            if "phone" in d and "stage" in d and "_id" in d:
                docs[d["_id"]] = d
            for lista in (d.get("stages"),):
                if isinstance(lista, list):
                    for s in lista:
                        if isinstance(s, dict) and s.get("_id") and s.get("name"):
                            nomes[str(s["_id"])] = str(s["name"])
        _andar(js, achar)

    pg.on("response", resposta)
    pg.goto(OPORTUNIDADES, wait_until="domcontentloaded", timeout=90000)
    pg.wait_for_timeout(6000)
    for _ in range(150):                        # "Visualizar mais" de cada coluna até acabar
        mais = pg.locator("text=Visualizar mais")
        if not mais.count():
            break
        try:
            mais.first.scroll_into_view_if_needed(timeout=5000)
            mais.first.click(timeout=5000)
        except Exception:
            pg.mouse.wheel(0, 600)
        pg.wait_for_timeout(1500)
    pg.wait_for_timeout(1500)
    pg.remove_listener("response", resposta)

    # nome da etapa que a resposta não trouxe: pelo título da coluna onde um cartão dela aparece
    titulos = ["Prospecção", "Pendente - Cliente", "Pendente - Corretor", "Ativo - Cliente", "Ativo - Corretor",
               "Recusado - Cliente", "Recusado - Corretor"]
    for sid in {str(d.get("stage")) for d in docs.values()} - set(nomes):
        exemplo = next((d for d in docs.values() if str(d.get("stage")) == sid and d.get("title")), None)
        if not exemplo:
            continue
        nome = pg.evaluate("""([titulo, titulos]) => {
            const el = [...document.querySelectorAll('*')].find(e => e.childElementCount === 0 && e.textContent.trim() === titulo);
            let p = el; for (let i = 0; i < 14 && p; i++) { const f = (p.innerText || '').split('\\n')[0].trim(); if (titulos.includes(f)) return f; p = p.parentElement; }
            return null; }""", [exemplo["title"], titulos])
        if nome:
            nomes[sid] = nome
    out = {}
    for d in docs.values():
        k = chave_tel(d.get("phone"))
        if k:
            out[k] = nomes.get(str(d.get("stage")), "")
    sem_nome = sum(1 for v in out.values() if not v)
    log("oportunidades: %d lidas, %d etapas com nome%s" % (len(out), len(set(nomes.values())),
                                                           (", %d sem etapa identificada" % sem_nome) if sem_nome else ""))
    return out


def ler_conversas(pg, since: str, chaves: list) -> tuple[dict, int]:
    pg.goto(CONVERSAS, wait_until="domcontentloaded", timeout=90000)
    pg.wait_for_timeout(5000)
    pg.evaluate(EXTRATOR.read_text(encoding="utf-8"))
    pg.evaluate("(s) => { HX.run(s); return true; }", since)
    fim = time.time() + PRAZO_CONVERSAS_MIN * 60
    prog = {}
    while time.time() < fim:
        time.sleep(10)
        prog = pg.evaluate("() => HX.prog || {}")
        if prog.get("phase") in ("fim", "erro"):
            break
    if prog.get("phase") == "erro":
        raise RuntimeError("leitura das conversas: " + str(prog.get("err"))[:300])
    if prog.get("phase") != "fim":
        log("conversas: passou de %d min — classifico com o que já foi lido" % PRAZO_CONVERSAS_MIN)
        pg.evaluate("() => HX.save()")
    lidos = int(prog.get("done") or 0)
    log("conversas: %s contato(s) lidos (%s)" % (lidos, json.dumps(prog.get("res") or {})))
    return pg.evaluate("(ks) => HX.classificar(ks)", chaves), lidos


# ------------------------------------------------------------------ rodada
def rodada(ver: bool, simular: bool) -> int:
    from playwright.sync_api import sync_playwright
    inicio = agora_iso()
    estado = json.loads(ESTADO.read_text(encoding="utf-8")) if ESTADO.exists() else {}
    if estado.get("ultima"):
        since = (dt.datetime.fromisoformat(estado["ultima"]) - dt.timedelta(hours=26)).strftime("%Y-%m-%dT%H:%M")
    else:
        since = (dt.datetime.now() - dt.timedelta(days=4)).strftime("%Y-%m-%dT00:00")

    base = apps_script("leads")
    leads = [l for a in base.get("abas", []) for l in a.get("leads", [])]
    atual = base.get("hyper") or {}
    chaves = sorted({l["k"] for l in leads if l.get("k")})
    log("planilha: %d leads em %d campanha(s), %d já classificados" % (len(leads), len(base.get("abas", [])), len(atual)))

    with sync_playwright() as pw:
        ctx = abrir(pw, ver)
        try:
            pg = ctx.pages[0] if ctx.pages else ctx.new_page()
            if not logado(pg):
                raise RuntimeError("a HyperFlow pediu login — rode: python servidor\\robo_hyperflow.py --login")
            etapas = ler_oportunidades(pg)
            conversas, lidos = ler_conversas(pg, since, chaves)
        finally:
            ctx.close()

    itens = decidir(leads, atual, etapas, conversas, inicio)
    resumo = {}
    for it in itens:
        resumo[it["tipo"]] = resumo.get(it["tipo"], 0) + 1
    if simular:
        log("SIMULAR: gravaria %d mudança(s) %s" % (len(itens), json.dumps(resumo, ensure_ascii=False)))
        return 0
    gravados = 0
    for i in range(0, len(itens), 250):
        gravados += int(apps_script("gravar", itens=itens[i:i + 250]).get("gravados") or 0)
    msg = "%d lead(s) atualizados %s; %d conversa(s) lidas; %d oportunidade(s)" % (
        gravados, json.dumps(resumo, ensure_ascii=False), lidos, len(etapas))
    apps_script("status", ok=True, msg=msg, lidos=lidos, gravados=gravados)
    ESTADO.write_text(json.dumps({"ultima": inicio, "resultado": msg}, ensure_ascii=False), encoding="utf-8")
    print("hyperflow: " + msg)
    return 0


def login() -> int:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        ctx = abrir(pw, True)
        pg = ctx.pages[0] if ctx.pages else ctx.new_page()
        pg.goto(CONVERSAS)
        print("Entre na HyperFlow nesta janela (login ADM). Ela fecha sozinha quando o Histórico de chats aparecer.")
        fim = time.time() + 15 * 60
        while time.time() < fim:
            time.sleep(5)
            if "conversas.hyperflow.global" in pg.url and "login" not in pg.url.lower() and pg.locator("p", has_text="#").count():
                print("login ok — o perfil do robô ficou salvo em", PERFIL)
                ctx.close()
                return 0
        ctx.close()
    print("não vi o login terminar em 15 min")
    return 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--login", action="store_true")
    ap.add_argument("--ver", action="store_true")
    ap.add_argument("--simular", action="store_true")
    a = ap.parse_args(argv)
    if a.login:
        return login()
    try:
        return rodada(a.ver, a.simular)
    except SystemExit:
        raise
    except Exception as e:
        msg = "%s: %s" % (type(e).__name__, str(e)[:250])
        try:
            if not a.simular:
                apps_script("status", ok=False, msg=msg)
        except Exception:
            pass
        print("hyperflow FALHOU — " + msg, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
