# -*- coding: utf-8 -*-
"""Robô do SERVIDOR do escritório: atende a fila de pedidos do portal e roda os robôs do Mais Controle
pela aba do Chrome do porteiro (MC_VIA=porteiro) — sem login nenhum. Plano de 27/10/2026.

Uso (Agendador de Tarefas do Windows, a cada 1 minuto):
    python servidor\\robo_fila.py                # dá sinal e atende os pedidos pendentes de todas as filas
    python servidor\\robo_fila.py --indices      # índices de reajuste (tarefa das 9h)
    python servidor\\robo_fila.py --verificar    # só confere a configuração e o porteiro; não roda nada
    python servidor\\robo_fila.py --robo contas  # 30/10: robôs que rodavam no GitHub (contas, bases, medicoes)

Configuração (FORA do repositório, só no servidor): C:\\AUTOMAÇÕES MAIS CONTROLE\\_central\\robos-portal.json
    {"filas": [{"nome": "teste", "db_fila": "<id da base FILA DO ROBÔ>", "notion_token_arquivo": "<arquivo>",
                "pode_gravar": false, "vars": {"DB_VENDAS_COND": "...", "DB_CORRETORES": "...", ...}},
               {"nome": "producao", ..., "pode_gravar": true}]}
Gravar no ERP exige as DUAS chaves, como no GitHub: o pedido pediu "aplicar" E a fila tem "pode_gravar": true
E existe o arquivo _central\\VENDA_APLICAR.txt (só o dono cria). A fila "teste" nunca grava.

Log PÚBLICO de propósito curto: só tipo, 8 letras do id e o código de saída — nunca nome, CPF ou valores."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import urllib.request

RAIZ = pathlib.Path(__file__).resolve().parent.parent          # o clone do portal
CENTRAL = pathlib.Path(os.environ.get("MC_CENTRAL") or r"C:\AUTOMAÇÕES MAIS CONTROLE\_central")
CONFIG = CENTRAL / "robos-portal.json"
TRAVA = CENTRAL / "robos-portal.trava"
SAUDE = CENTRAL / "robos-portal-saude.json"
APLICAR = CENTRAL / "VENDA_APLICAR.txt"
LOGS = CENTRAL / "logs"
PRAZO_PEGO_S = 15 * 60          # pedido PEGO há mais que isto (robô morreu no meio) volta a ser atendido
PRAZO_ROBO_S = 600              # mesmo teto do GitHub (timeout-minutes: 10)
RE_ID = re.compile(r"^[0-9a-fA-F-]{32,36}$")

COL = {"titulo": "PEDIDO", "tipo": "TIPO", "payload": "PAYLOAD", "situacao": "SITUAÇÃO",
       "pedido_em": "PEDIDO EM", "resultado": "RESULTADO", "concluido_em": "CONCLUÍDO EM"}


def agora_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def log(msg: str) -> None:
    LOGS.mkdir(parents=True, exist_ok=True)
    linha = "%s %s" % (dt.datetime.now().strftime("%H:%M:%S"), msg)
    with open(LOGS / ("robos-portal-%s.log" % dt.date.today().isoformat()), "a", encoding="utf-8") as f:
        f.write(linha + "\n")
    print(linha)


# ---------------------------------------------------------------- Notion
class Notion:
    def __init__(self, token: str):
        self.token = token

    def api(self, metodo: str, caminho: str, corpo=None) -> dict:
        req = urllib.request.Request("https://api.notion.com/v1" + caminho, method=metodo,
                                     data=json.dumps(corpo).encode() if corpo is not None else None,
                                     headers={"Authorization": "Bearer " + self.token, "Notion-Version": "2022-06-28",
                                              "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())


def texto(prop) -> str:
    if not prop:
        return ""
    t = prop.get("type")
    if t in ("title", "rich_text"):
        return "".join(x.get("plain_text", "") for x in prop.get(t) or [])
    if t == "select":
        return (prop.get("select") or {}).get("name", "")
    if t == "date":
        return (prop.get("date") or {}).get("start", "")
    return ""


def rt(s: str) -> dict:
    return {"rich_text": [{"type": "text", "text": {"content": str(s)[:1900]}}]}


# ---------------------------------------------------------------- pedidos
def argumentos(tipo: str, p: dict, pode_gravar: bool) -> tuple[list, dict] | None:
    """Pedido da fila -> (argv do robô, env extra). None = pedido inválido. Mesmas regras do mc-venda.yml."""
    if tipo == "mc-retrato":   # só LÊ o ERP e grava o retrato no Notion: nunca leva --aplicar
        pagina = str(p.get("pageId") or "")
        return (["-m", "venda.mc.retrato", "--page", pagina], {}) if RE_ID.match(pagina) else None
    if tipo != "mc-venda":
        return None
    pagina = str(p.get("pageId") or "")
    if not RE_ID.match(pagina):
        return None
    pediu = p.get("aplicar") is True or str(p.get("aplicar")).lower() == "true"
    flag = []
    if pediu:
        flag = ["--aplicar"] if pode_gravar else ["--bloqueado"]
    if str(p.get("acao") or "lancar") == "distrato":
        recebeu, destino = str(p.get("recebeu") or ""), str(p.get("destino") or "")
        valor, data = str(p.get("valor") or ""), str(p.get("data") or "")
        if recebeu not in ("sim", "nao") or destino not in ("", "retido", "devolvido"):
            return None
        if not re.match(r"^[0-9.,]{0,20}$", valor) or not re.match(r"^(\d{4}-\d{2}-\d{2})?$", data):
            return None
        return (["-m", "venda.mc.distrato", "--page", pagina, "--recebeu", recebeu, "--destino", destino,
                 "--valor", valor, "--data", data] + flag, {})
    if str(p.get("acao") or "lancar") != "lancar":
        return None
    if p.get("anexar") is True and flag == ["--aplicar"]:
        flag = ["--aplicar", "--anexar"]
    return (["-m", "venda.mc.lancar", "--page", pagina] + flag, {})


def marcar_erro_argv(argv: list) -> list | None:
    """O 'Avisar no Notion que falhou' do workflow: anota ERRO na página da venda."""
    if len(argv) >= 4 and argv[2] == "--page":
        return argv[:4] + ["--marcar-erro", "o robô do servidor falhou — veja o log do servidor"]
    return None


class Fila:
    def __init__(self, cfg: dict):
        self.nome = cfg["nome"]
        self.db = cfg["db_fila"].replace("-", "")
        tok = pathlib.Path(cfg["notion_token_arquivo"]).read_text(encoding="utf-8").strip()
        self.notion = Notion(tok)
        self.token = tok
        self.vars = {k: str(v) for k, v in (cfg.get("vars") or {}).items()}
        self.pode_gravar = bool(cfg.get("pode_gravar")) and self.nome != "teste" and APLICAR.exists()

    def sinal(self) -> None:
        r = self.notion.api("POST", "/databases/%s/query" % self.db,
                            {"filter": {"property": COL["tipo"], "select": {"equals": "SINAL"}}, "page_size": 1})
        props = {COL["pedido_em"]: {"date": {"start": agora_iso()}}}
        if r.get("results"):
            self.notion.api("PATCH", "/pages/" + r["results"][0]["id"], {"properties": props})
        else:
            props[COL["titulo"]] = {"title": [{"type": "text", "text": {"content": "SINAL DO SERVIDOR"}}]}
            props[COL["tipo"]] = {"select": {"name": "SINAL"}}
            self.notion.api("POST", "/pages", {"parent": {"database_id": self.db}, "properties": props})

    def pendentes(self) -> list:
        r = self.notion.api("POST", "/databases/%s/query" % self.db, {
            "filter": {"or": [{"property": COL["situacao"], "select": {"equals": "PENDENTE"}},
                              {"property": COL["situacao"], "select": {"equals": "PEGO"}}]},
            "sorts": [{"property": COL["pedido_em"], "direction": "ascending"}], "page_size": 20})
        out = []
        for l in r.get("results") or []:
            pr = l["properties"]
            sit = texto(pr.get(COL["situacao"]))
            if sit == "PEGO":
                pego = texto(pr.get(COL["concluido_em"]))   # PEGO guarda a hora em CONCLUÍDO EM
                try:
                    idade = time.time() - dt.datetime.fromisoformat(pego.replace("Z", "+00:00")).timestamp()
                except ValueError:
                    idade = PRAZO_PEGO_S + 1
                if idade < PRAZO_PEGO_S:
                    continue
            out.append(l)
        return out

    def marcar(self, pid: str, situacao: str, resultado: str = "") -> None:
        props = {COL["situacao"]: {"select": {"name": situacao}}, COL["concluido_em"]: {"date": {"start": agora_iso()}}}
        if resultado:
            props[COL["resultado"]] = rt(resultado)
        self.notion.api("PATCH", "/pages/" + pid, {"properties": props})

    def env(self) -> dict:
        e = dict(os.environ)
        e.update(self.vars)
        e.update({"NOTION_TOKEN": self.token, "MC_VIA": "porteiro", "PYTHONIOENCODING": "utf-8"})
        for n in ("MC_ROBO_EMAIL", "MC_ROBO_SENHA", "MC_ROBO_APARELHO"):   # no servidor nunca há senha
            e.pop(n, None)
        return e

    def atender(self, linha: dict) -> str:
        pr = linha["properties"]
        tipo = texto(pr.get(COL["tipo"]))
        try:
            payload = json.loads(texto(pr.get(COL["payload"])) or "{}")
        except ValueError:
            payload = {}
        alvo = str(payload.get("pageId") or "")[:8]
        montado = argumentos(tipo, payload, self.pode_gravar)
        if not montado:
            self.marcar(linha["id"], "ERRO", "pedido inválido (%s)" % tipo)
            log("[%s] %s %s: pedido inválido" % (self.nome, tipo, alvo))
            return "ERRO"
        argv, extra = montado
        self.marcar(linha["id"], "PEGO")
        env = self.env()
        env.update(extra)
        log("[%s] %s %s: começando (%s)" % (self.nome, tipo, alvo, " ".join(a for a in argv if a.startswith("--") and a != "--page")))
        try:
            r = subprocess.run([sys.executable] + argv, cwd=RAIZ, env=env, capture_output=True, text=True,
                               encoding="utf-8", errors="replace", timeout=PRAZO_ROBO_S)
            codigo, saida = r.returncode, (r.stdout or "").strip().splitlines()
        except subprocess.TimeoutExpired:
            codigo, saida = 124, ['{"situacao": "ERRO", "codigo": "PRAZO_ESGOTADO"}']
        ultima = saida[-1] if saida else ""
        if codigo != 0:
            m = marcar_erro_argv(argv)
            if m:
                subprocess.run([sys.executable] + m, cwd=RAIZ, env=env, capture_output=True, timeout=120)
        self.marcar(linha["id"], "FEITO" if codigo == 0 else "ERRO", ultima)
        log("[%s] %s %s: código %s %s" % (self.nome, tipo, alvo, codigo, ultima[:200]))
        return "FEITO" if codigo == 0 else "ERRO"


def carregar() -> list:
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    return [Fila(f) for f in cfg.get("filas") or []]


def com_trava(funcao):
    """Uma execução por vez (o Agendador chama a cada minuto; um lançamento pode durar mais)."""
    CENTRAL.mkdir(parents=True, exist_ok=True)
    import msvcrt
    f = open(TRAVA, "a+")
    try:
        msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        print("outra execução ainda está rodando — saindo")
        return 0
    try:
        return funcao()
    finally:
        try:
            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
        finally:
            f.close()


def rodada() -> int:
    saude = {"em": agora_iso(), "filas": {}}
    erro = 0
    for fila in carregar():
        st = {"feitos": 0, "erros": 0}
        try:
            fila.sinal()
            for linha in fila.pendentes():
                if fila.atender(linha) == "FEITO":
                    st["feitos"] += 1
                else:
                    st["erros"] += 1
        except Exception as e:     # rede, Notion fora: a próxima rodada tenta de novo; a saúde mostra
            st["falha"] = "%s: %s" % (type(e).__name__, str(e)[:200])
            log("[%s] FALHA %s" % (fila.nome, st["falha"]))
            erro = 1
        saude["filas"][fila.nome] = st
    SAUDE.write_text(json.dumps(saude, ensure_ascii=False, indent=1), encoding="utf-8")
    return erro


def indices() -> int:
    """Tarefa das 9h (antes no GitHub): grava só com o arquivo _central\\INDICES_APLICAR.txt."""
    env = dict(os.environ, MC_VIA="porteiro", PYTHONIOENCODING="utf-8")
    for n in ("MC_ROBO_EMAIL", "MC_ROBO_SENHA", "MC_ROBO_APARELHO"):
        env.pop(n, None)
    argv = ["-m", "venda.mc.indices"] + (["--aplicar"] if (CENTRAL / "INDICES_APLICAR.txt").exists() else [])
    r = subprocess.run([sys.executable] + argv, cwd=RAIZ, env=env, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=PRAZO_ROBO_S)
    log("[indices] código %s %s" % (r.returncode, ((r.stdout or "").strip().splitlines() or [""])[-1][:200]))
    return r.returncode


# ---------------------------------------------------------------- robôs que rodavam no GitHub (30/10/2026)
# Mesmos scripts e mesma ordem dos workflows; aqui entram pela aba do porteiro (MC_VIA=porteiro, sem login).
# Configuração em robos-portal.json, chave "robos": {"notion_token_arquivo": "...", "vars": {...},
# "github_token_arquivo": "..." (só medições: publica dist/mc_medicoes/contratos.json no repositório)}.
# Gravar (APLICAR=1) exige o arquivo _central\ROBOS_APLICAR.txt — o dono cria.
ROBOS = {
    "contas": ["robo_mc_contas.py", "robo_mc_clientes.py", "robo_mc_obras.py"],   # robos-mc.yml (06:23)
    "bases": ["robo_mc_bases.py"],                                                # robos-mc-bases.yml (07:17)
    "medicoes": ["robo_mc_medicoes.py"],                                          # robos-mc-medicoes.yml (2/2 h)
}
REPO_GH = "DEVMoraisEng/PORTAL-MORAIS"
ARQ_MEDICOES = "dist/mc_medicoes/contratos.json"
PRAZO_ROBO_ANTIGO_S = 40 * 60


def env_robos(cfg: dict) -> dict:
    e = dict(os.environ)
    e.update({k: str(v) for k, v in (cfg.get("vars") or {}).items()})
    tok = pathlib.Path(cfg["notion_token_arquivo"]).read_text(encoding="utf-8").strip()
    e.update({"NOTION_TOKEN": tok, "MC_VIA": "porteiro", "PYTHONIOENCODING": "utf-8",
              "APLICAR": "1" if (CENTRAL / "ROBOS_APLICAR.txt").exists() else ""})
    for n in ("MC_USUARIO", "MC_SENHA", "MC_ROBO_USUARIO", "MC_ROBO_SENHA", "MC_ROBO_EMAIL", "MC_ROBO_APARELHO",
              "MC_EMAIL_SENHA_APP"):
        e.pop(n, None)                     # no servidor nunca há senha: quem está logado é o porteiro
    return e


def publicar_medicoes(cfg: dict) -> str:
    """Sobe dist/mc_medicoes/contratos.json pela API do GitHub (o Mapa de Obras lê do site) e devolve o clone limpo."""
    import base64
    arq = RAIZ / ARQ_MEDICOES
    if not arq.exists():
        return "sem arquivo"
    tok_arq = cfg.get("github_token_arquivo")
    try:
        if not tok_arq:
            return "sem github_token_arquivo na configuração — não publiquei"
        tok = pathlib.Path(tok_arq).read_text(encoding="utf-8").strip()
        novo = arq.read_bytes()
        url = "https://api.github.com/repos/%s/contents/%s" % (REPO_GH, ARQ_MEDICOES)
        cab = {"Authorization": "Bearer " + tok, "Accept": "application/vnd.github+json", "User-Agent": "robo-servidor"}
        atual = json.loads(urllib.request.urlopen(urllib.request.Request(url + "?ref=main", headers=cab), timeout=60).read())
        if base64.b64decode(atual.get("content") or "") == novo:
            return "sem mudança"
        corpo = {"message": "Medições de contratos do MC %s (servidor) [skip ci]" % agora_iso(), "branch": "main",
                 "sha": atual["sha"], "content": base64.b64encode(novo).decode()}
        req = urllib.request.Request(url, method="PUT", data=json.dumps(corpo).encode(), headers=cab)
        urllib.request.urlopen(req, timeout=60).read()
        return "publicado"
    finally:
        subprocess.run(["git", "checkout", "--", ARQ_MEDICOES], cwd=RAIZ, capture_output=True)


def robo_antigo(nome: str) -> int:
    if nome not in ROBOS:
        log("[robo] desconhecido: %s" % nome)
        return 2
    cfg = json.loads(CONFIG.read_text(encoding="utf-8")).get("robos")
    if not cfg:
        log("[%s] sem a chave \"robos\" em %s" % (nome, CONFIG.name))
        return 2
    env, pior = env_robos(cfg), 0
    for script in ROBOS[nome]:
        try:
            r = subprocess.run([sys.executable, script], cwd=RAIZ, env=env, capture_output=True, text=True,
                               encoding="utf-8", errors="replace", timeout=PRAZO_ROBO_ANTIGO_S)
            codigo, fim = r.returncode, ((r.stdout or "").strip().splitlines() or [""])[-1]
            if codigo:
                fim = ((r.stderr or "").strip().splitlines() or [fim])[-1]
        except subprocess.TimeoutExpired:
            codigo, fim = 124, "passou de %d min" % (PRAZO_ROBO_ANTIGO_S // 60)
        log("[%s] %s código %s %s" % (nome, script, codigo, str(fim)[:200]))
        pior = pior or codigo
    if nome == "medicoes" and not pior:
        try:
            log("[medicoes] site: %s" % publicar_medicoes(cfg))
        except Exception as e:
            log("[medicoes] publicar FALHOU %s: %s" % (type(e).__name__, str(e)[:200]))
            pior = 1
    saude = json.loads(SAUDE.read_text(encoding="utf-8")) if SAUDE.exists() else {}
    saude.setdefault("robos", {})[nome] = {"em": agora_iso(), "codigo": pior}
    SAUDE.write_text(json.dumps(saude, ensure_ascii=False, indent=1), encoding="utf-8")
    return pior


def verificar() -> int:
    ok = True
    print("clone do portal:", RAIZ)
    print("config:", CONFIG, "existe" if CONFIG.exists() else "NÃO EXISTE")
    if CONFIG.exists():
        for fila in carregar():
            print(" fila %-9s base %s… pode gravar: %s" % (fila.nome, fila.db[:8], "SIM" if fila.pode_gravar else "não"))
    sys.path.insert(0, str(RAIZ))
    from venda.mc.porteiro import AbaPorteiro, PorteiroErro
    try:
        aba = AbaPorteiro.abrir()
        aba.fechar()
        print("porteiro: logado no Mais Controle (aba aberta e fechada)")
    except PorteiroErro as e:
        print("porteiro: PROBLEMA —", e)
        ok = False
    return 0 if ok else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--indices", action="store_true")
    ap.add_argument("--verificar", action="store_true")
    ap.add_argument("--robo", choices=sorted(ROBOS))
    a = ap.parse_args(argv)
    if a.verificar:
        return verificar()
    if a.indices:
        return com_trava(indices)
    if a.robo:
        return robo_antigo(a.robo)      # sem a trava da fila: os robôs antigos não usam a fila
    return com_trava(rodada)


if __name__ == "__main__":
    sys.exit(main())
