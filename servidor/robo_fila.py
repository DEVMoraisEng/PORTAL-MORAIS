# -*- coding: utf-8 -*-
"""Robô do SERVIDOR do escritório: atende a fila de pedidos do portal e roda os robôs do Mais Controle
pela aba do Chrome do porteiro (MC_VIA=porteiro) — sem login nenhum. Plano de 27/10/2026.

Uso (Agendador de Tarefas do Windows, a cada 1 minuto):
    python servidor\\robo_fila.py                # dá sinal e atende os pedidos pendentes de todas as filas
    python servidor\\robo_fila.py --indices      # índices de reajuste (tarefa das 9h)
    python servidor\\robo_fila.py --verificar    # só confere a configuração e o porteiro; não roda nada
    python servidor\\robo_fila.py --robo contas  # 30/10: robôs que rodavam no GitHub (contas, bases, medicoes, retratos)

Configuração (FORA do repositório, só no servidor): C:\\AUTOMAÇÕES MAIS CONTROLE\\_central\\robos-portal.json
    {"filas": [{"nome": "teste", "db_fila": "<id da base FILA DO ROBÔ>", "notion_token_arquivo": "<arquivo>",
                "pode_gravar": false, "vars": {"DB_VENDAS_COND": "...", "DB_CORRETORES": "...", ...}},
               {"nome": "producao", ..., "pode_gravar": true}]}
Gravar no ERP exige as DUAS chaves, como no GitHub: o pedido pediu "aplicar" E a fila tem "pode_gravar": true
E existe o arquivo _central\\VENDA_APLICAR.txt (só o dono cria). A fila "teste" não grava — a não ser com uma
TERCEIRA chave, separada e só dela: o arquivo _central\\TESTE_PODE_GRAVAR.txt (05/11/2026, para o dono testar o
processo inteiro da casa de rua gravando de verdade no Mais Controle; ele mesmo cria e apaga). Sem ele, nada muda.

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
import urllib.error

RAIZ = pathlib.Path(__file__).resolve().parent.parent          # o clone do portal
CENTRAL = pathlib.Path(os.environ.get("MC_CENTRAL") or r"C:\AUTOMAÇÕES MAIS CONTROLE\_central")
CONFIG = CENTRAL / "robos-portal.json"
TRAVA = CENTRAL / "robos-portal.trava"
TRAVA_INDICES = CENTRAL / "robo-indices.trava"   # 04/11: os índices não esperam a trava da fila
#: 04/11: a VEZ no Mais Controle — um robô de cada vez na aba do porteiro. Às 17:2x os índices, as medições e os
#: anexos entraram juntos no mesmo Chrome: medições com Page.goto estourando, índices "código 1" sem mensagem e o
#: porteiro dando "fora". Quem chega espera a vez (até ESPERA_VEZ_S) em vez de disputar a aba.
TRAVA_MC = CENTRAL / "robo-mc-vez.trava"
ESPERA_VEZ_S = 50 * 60
#: 04/11: quem está rodando agora (rodado pela tarefa OU por um .bat): o Escritório mostra "trabalhando".
RODANDO = CENTRAL / "rodando"
SAUDE = CENTRAL / "robos-portal-saude.json"
APLICAR = CENTRAL / "VENDA_APLICAR.txt"
#: 05/11/2026: chave EXPLÍCITA e separada para a fila "teste" gravar no ERP (o dono cria para o 1º teste ao vivo e
#: apaga depois). Vale junto com "pode_gravar": true da fila e o VENDA_APLICAR.txt — nunca sozinha.
TESTE_PODE_GRAVAR = CENTRAL / "TESTE_PODE_GRAVAR.txt"
#: 05/11/2026: baixas e alteração de sinal/financiamento/FGTS da casa de rua (venda/mc/recebimentos.py). Trava PRÓPRIA:
#: grava só com "pode_gravar_recebimento": true na fila E este arquivo (só o dono cria). Vale também na fila "teste" —
#: o dono pediu o 1º processo inteiro no portal de teste gravando de verdade no Mais Controle.
APLICAR_RECEBIMENTO = CENTRAL / "RECEBIMENTO_APLICAR.txt"
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
    if tipo == "mc-recebimento":   # 05/11: pode_gravar aqui é a trava PRÓPRIA dos recebimentos (Fila.pode_gravar_recebimento)
        pagina = str(p.get("pageId") or "")
        if not RE_ID.match(pagina):
            return None
        pediu = p.get("aplicar") is True or str(p.get("aplicar")).lower() == "true"
        return (["-m", "venda.mc.recebimentos", "--page", pagina] +
                ((["--aplicar"] if pode_gravar else ["--bloqueado"]) if pediu else []), {})
    if tipo not in ("mc-venda", "mc-anexos"):
        return None
    pagina = str(p.get("pageId") or "")
    if not RE_ID.match(pagina):
        return None
    pediu = p.get("aplicar") is True or str(p.get("aplicar")).lower() == "true"
    flag = []
    if pediu:
        flag = ["--aplicar"] if pode_gravar else ["--bloqueado"]
    if tipo == "mc-anexos":   # 03/11: contrato no recebimento e ZIP no Orçamento (venda/mc/anexos.py)
        return (["-m", "venda.mc.anexos", "--page", pagina] + flag, {})
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
    # o retrato não tem --marcar-erro; o anexos (03/11) já escreve o motivo nas linhas dele, sem apagar o resto
    if len(argv) >= 4 and argv[2] == "--page" and argv[1] not in ("venda.mc.retrato", "venda.mc.anexos"):
        return argv[:4] + ["--marcar-erro", "o robô do servidor falhou — veja o log do servidor"]
    return None


def apos_gravar(argv: list) -> list | None:
    """31/10: depois de GRAVAR uma venda no ERP pela fila (lançar/distrato com --aplicar), lê o retrato de TODAS as
    vendas, para a aba Financeiro mostrar a unidade nova e as outras ficarem em dia. Prévia, bloqueado e mc-retrato: None."""
    if len(argv) > 1 and argv[1] in ("venda.mc.lancar", "venda.mc.distrato") and "--aplicar" in argv:
        return ["-m", "venda.mc.retrato", "--todas"]
    return None


# ---------------------------------------------------------------- 03/11: "Rodar de novo" do Escritório de Robôs
RE_TAREFA = re.compile(r"^MoraisEng - [0-9A-Za-zÀ-ÿ ()._-]{2,80}$")
SEM_JANELA = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def tarefa_para_rodar(p: dict, nome_fila: str) -> tuple[str | None, str]:
    """Pedido robo-rodar -> (nome da tarefa agendada, "") ou (None, motivo). Só tarefas "MoraisEng - …" que já
    existem; nunca o porteiro (derrubaria a sessão de todo mundo) nem a própria fila; nunca pela fila de teste."""
    nome = str(p.get("tarefa") or "").strip()
    if nome_fila == "teste":
        return None, "a fila de teste não dispara robô"
    if not RE_TAREFA.match(nome):
        return None, "tarefa inválida"
    baixo = nome.lower()
    if "porteiro" in baixo or "(fila)" in baixo:
        return None, "essa tarefa não se roda pelo portal"
    return nome, ""


def rodar_tarefa(nome: str) -> tuple[bool, str]:
    """schtasks /Run: roda a MESMA tarefa agendada (rodar_e_relatar.py, e-mail e escritório inclusos). Se ela já
    está rodando, o Agendador não abre outra (as tarefas são criadas com "não rodar duas ao mesmo tempo")."""
    r = subprocess.run(["schtasks", "/Run", "/TN", nome], capture_output=True, text=True, errors="replace",
                       timeout=60, creationflags=SEM_JANELA)
    msg = " ".join(((r.stdout or "") + " " + (r.stderr or "")).split())[:300]
    return r.returncode == 0, msg


class Fila:
    def __init__(self, cfg: dict):
        self.nome = cfg["nome"]
        self.db = cfg["db_fila"].replace("-", "")
        tok = pathlib.Path(cfg["notion_token_arquivo"]).read_text(encoding="utf-8").strip()
        self.notion = Notion(tok)
        self.token = tok
        self.vars = {k: str(v) for k, v in (cfg.get("vars") or {}).items()}
        self.pode_gravar = (bool(cfg.get("pode_gravar")) and APLICAR.exists()
                            and (self.nome != "teste" or TESTE_PODE_GRAVAR.exists()))
        self.pode_gravar_recebimento = bool(cfg.get("pode_gravar_recebimento")) and APLICAR_RECEBIMENTO.exists()

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
        if tipo == "robo-rodar":
            return self.rodar_de_novo(linha, payload)
        montado = argumentos(tipo, payload, self.pode_gravar_recebimento if tipo == "mc-recebimento" else self.pode_gravar)
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
        depois = apos_gravar(argv) if codigo == 0 else None
        if depois:     # best-effort: o pedido já está FEITO e assim fica, aconteça o que acontecer aqui
            try:
                r2 = subprocess.run([sys.executable] + depois, cwd=RAIZ, env=env, capture_output=True, text=True,
                                    encoding="utf-8", errors="replace", timeout=PRAZO_ROBO_S)
                saida2 = (r2.stdout or "").strip().splitlines()
                log("[%s] retratos depois de gravar: código %s %s" % (self.nome, r2.returncode, (saida2[-1] if saida2 else "")[:200]))
            except subprocess.TimeoutExpired:
                log("[%s] retratos depois de gravar: prazo esgotado" % self.nome)
            except Exception as e:
                log("[%s] retratos depois de gravar: falhou (%s)" % (self.nome, type(e).__name__))
        return "FEITO" if codigo == 0 else "ERRO"


    def rodar_de_novo(self, linha: dict, payload: dict) -> str:
        """03/11: botão "Rodar de novo" do Escritório de Robôs. Dispara a tarefa e marca FEITO na hora (o resultado
        da rodada vem no e-mail e na própria aba); a próxima publicação do escritório sai logo, com a mesa rodando."""
        nome, motivo = tarefa_para_rodar(payload, self.nome)
        quem = str(payload.get("quem") or "")[:40]
        if not nome:
            self.marcar(linha["id"], "ERRO", motivo)
            log("[%s] robo-rodar: recusado (%s)" % (self.nome, motivo))
            return "ERRO"
        if nome == "MoraisEng - Reorganizar":          # 04/11: o Coordenador da fila (servidor/reorganizar.py)
            return self.reorganizar(linha, quem)
        try:
            ok, msg = rodar_tarefa(nome)
        except Exception as e:
            ok, msg = False, "%s: %s" % (type(e).__name__, str(e)[:200])
        self.marcar(linha["id"], "FEITO" if ok else "ERRO", ("disparada: " if ok else "não disparou: ") + nome + (" — " + msg if not ok else ""))
        log("[%s] robo-rodar %s%s: %s" % (self.nome, nome, (" (pedido de %s)" % quem) if quem else "", "disparada" if ok else "FALHOU " + msg))
        if ok:
            try:
                time.sleep(3)                       # deixa o Agendador marcar "Running" antes de publicar
                sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
                import escritorio_robos
                escritorio_robos.publicar(lambda m: log("[escritorio] " + m))
            except Exception:
                pass
        return "FEITO" if ok else "ERRO"


    def reorganizar(self, linha: dict, quem: str) -> str:
        try:
            sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
            import escritorio_robos as ER
            import reorganizar as RZ
            plano, motivo = RZ.criar_plano(ER.ler_tarefas(), ER.rodadas(), quem)
        except Exception as e:
            plano, motivo = None, "%s: %s" % (type(e).__name__, str(e)[:200])
        if not plano:
            self.marcar(linha["id"], "ERRO", "reorganizar: " + motivo)
            log("[coordenador] não reorganizei: %s" % motivo)
            return "ERRO"
        ordem = " → ".join(i["chave"] for i in plano["fila"])
        self.marcar(linha["id"], "FEITO", "fila montada: " + ordem)
        log("[coordenador] fila montada%s: %s" % ((" (pedido de %s)" % quem) if quem else "", ordem))
        passo_coordenador()
        return "FEITO"


def passo_coordenador() -> None:
    """04/11: um passo do Coordenador da fila por minuto (um robô de cada vez, ver servidor/reorganizar.py)."""
    try:
        sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
        import reorganizar as RZ
        if not RZ.ativo(RZ.ler()):
            return
        import escritorio_robos as ER
        msg = RZ.passo(ER.ler_tarefas(), ER.conferir_porteiro)
        if msg:
            log("[coordenador] " + msg)
            ER.publicar(lambda m: log("[escritorio] " + m))
    except Exception as e:
        log("[coordenador] FALHOU %s: %s" % (type(e).__name__, str(e)[:150]))


def carregar() -> list:
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    return [Fila(f) for f in cfg.get("filas") or []]


def com_trava(funcao, trava=None):
    """Uma execução por vez (o Agendador chama a cada minuto; um lançamento pode durar mais).

    04/11/2026: os índices têm a trava DELES (TRAVA_INDICES). Com a mesma da fila, o "Rodar de novo" e o
    Coordenador (que soltam a tarefa de dentro da rodada da fila, com a trava pega) faziam os índices saírem na
    hora com "outra execução ainda está rodando" — código 0, nenhuma linha no log e o relatório "FALHOU"."""
    trava = trava or TRAVA
    CENTRAL.mkdir(parents=True, exist_ok=True)
    import msvcrt
    f = open(trava, "a+")
    try:
        msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        print("outra execução ainda está rodando — saindo")
        if trava != TRAVA:
            log("[%s] outra execução ainda está rodando — não abri outra" % pathlib.Path(trava).stem.replace("robo-", ""))
        return 0
    try:
        return funcao()
    finally:
        try:
            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
        finally:
            f.close()


def _travar(f) -> bool:
    """Pega a trava sem esperar (True) ou diz que outro está com ela (False). Windows: msvcrt; resto: fcntl."""
    try:
        import msvcrt
        try:
            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
            return True
        except OSError:
            return False
    except ImportError:
        import fcntl
        try:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:
            return False


def _soltar(f) -> None:
    try:
        import msvcrt
        f.seek(0)
        msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
    except ImportError:
        import fcntl
        fcntl.flock(f.fileno(), fcntl.LOCK_UN)
    except OSError:
        pass


def marcar_rodando(nome: str, fase: str | None) -> None:
    """Escreve (fase) ou apaga (None) o _central/rodando/<nome>.json que o Escritório lê. Nunca derruba o robô."""
    try:
        arq = RODANDO / ("%s.json" % nome)
        if fase is None:
            arq.unlink(missing_ok=True)
            return
        RODANDO.mkdir(parents=True, exist_ok=True)
        antes = {}
        try:
            antes = json.loads(arq.read_text(encoding="utf-8"))
        except Exception:
            pass
        arq.write_text(json.dumps({"robo": nome, "fase": fase, "pid": os.getpid(),
                                   "desde": antes.get("desde") or agora_iso(), "fase_em": agora_iso()}),
                       encoding="utf-8")
    except Exception:
        pass


def na_vez(nome: str, funcao, espera_s: float = ESPERA_VEZ_S, dormir=time.sleep, relogio=time.monotonic) -> int:
    """Roda `funcao` quando for a vez dele no Mais Controle (TRAVA_MC). Espera quem estiver lá; desiste depois de
    `espera_s` com código 1 e uma linha clara no log (o relatório mostra o motivo)."""
    CENTRAL.mkdir(parents=True, exist_ok=True)
    f = open(TRAVA_MC, "a+")
    ini, avisou = relogio(), False
    try:
        while not _travar(f):
            if not avisou:
                quem = []
                try:
                    quem = sorted(x.stem for x in RODANDO.glob("*.json") if x.stem != nome)
                except Exception:
                    pass
                log("[vez] %s esperando a vez no Mais Controle (usando agora: %s)" % (nome, ", ".join(quem) or "outro robô"))
                marcar_rodando(nome, "esperando a vez")
                avisou = True
            if relogio() - ini > espera_s:
                marcar_rodando(nome, None)
                log("[%s] FALHOU: esperei %d min a vez no Mais Controle e outro robô não terminou" % (nome, espera_s // 60))
                return 1
            dormir(10)
        if avisou:
            log("[vez] %s: chegou a vez (esperou %d min)" % (nome, (relogio() - ini) // 60))
        marcar_rodando(nome, "trabalhando")
        try:
            return funcao()
        finally:
            marcar_rodando(nome, None)
            _soltar(f)
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
    passo_coordenador()
    return erro


def indices() -> int:
    """Tarefa das 9h (antes no GitHub): grava só com o arquivo _central\\INDICES_APLICAR.txt."""
    env = dict(os.environ, MC_VIA="porteiro", PYTHONIOENCODING="utf-8")
    for n in ("MC_ROBO_EMAIL", "MC_ROBO_SENHA", "MC_ROBO_APARELHO"):
        env.pop(n, None)
    argv = ["-m", "venda.mc.indices"] + (["--aplicar"] if (CENTRAL / "INDICES_APLICAR.txt").exists() else [])
    try:
        r = subprocess.run([sys.executable] + argv, cwd=RAIZ, env=env, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=PRAZO_ROBO_S)
    except subprocess.TimeoutExpired:
        log("[indices] código 124 passou de %d min" % (PRAZO_ROBO_S // 60))
        return 124
    fim = ((r.stdout or "").strip().splitlines() or [""])[-1]
    if r.returncode and not fim.strip():     # 04/11: "código 1" sem nada — o motivo estava no stderr
        fim = ((r.stderr or "").strip().splitlines() or ["(sem mensagem)"])[-1]
    log("[indices] código %s %s" % (r.returncode, fim[:200]))
    try:
        (LOGS / "saida-indices.txt").write_text("%s código %s\n%s\n%s" % (
            agora_iso(), r.returncode, (r.stdout or "")[-60000:], (r.stderr or "")[-20000:]), encoding="utf-8")
    except Exception:
        pass
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
    # 31/10: retrato diário das vendas do condomínio (aba Financeiro + antecipação); só lê o ERP
    "retratos": ["robo_mc_retratos.py"],
    # 03/11: anexos dos pagamentos (boleto/NF/recibo/comprovante) para a Auditoria Financeira; só lê o ERP.
    # Precisa de "vars": {"SUPABASE_URL": ...} e "supabase_key_arquivo" (service key, o dono cola no arquivo).
    "anexos": ["robo_mc_anexos.py"],
    # 04/11: medidores comprados por obra (solicitação atendida / OC) para o alerta da aba Ligações; só lê o ERP.
    # Publica dist/medidores_mc.json no repositório como as medições (github_token_arquivo).
    "medidores": ["robo_mc_medidores.py"],
    # 05/11: documentos do Orçamento (matrícula, certidão mãe, alvará, habite-se) -> dossiê do imóvel das casas de rua
    # com venda. Só lê o ERP; grava no Notion só com ROBOS_APLICAR.txt. Precisa de "vars": {"DB_VENDAS": ...}.
    "documentos": ["robo_mc_documentos.py"],
    # 06/11: boletos do mês do Reserva dos Ipês pela Cobrança Fácil (venda/mc/boletos.py).
    # Dias úteis 10:00; já emite, mas só com _central\BOLETOS_APLICAR.txt (o dono cria). Sem ele, só a lista.
    "boletos": [["robo_mc_boletos.py", "--emitir"]],
}
REPO_GH = "DEVMoraisEng/PORTAL-MORAIS"
ARQ_MEDICOES = "dist/mc_medicoes/contratos.json"
ARQ_MEDIDORES = "dist/medidores_mc.json"
PRAZO_ROBO_ANTIGO_S = 40 * 60


def env_robos(cfg: dict) -> dict:
    e = dict(os.environ)
    e.update({k: str(v) for k, v in (cfg.get("vars") or {}).items()})
    tok = pathlib.Path(cfg["notion_token_arquivo"]).read_text(encoding="utf-8").strip()
    chave_sb = cfg.get("supabase_key_arquivo")
    if chave_sb and pathlib.Path(chave_sb).exists():
        e["SUPABASE_SERVICE_KEY"] = pathlib.Path(chave_sb).read_text(encoding="utf-8").strip()
    e.update({"NOTION_TOKEN": tok, "MC_VIA": "porteiro", "PYTHONIOENCODING": "utf-8",
              "APLICAR": "1" if (CENTRAL / "ROBOS_APLICAR.txt").exists() else ""})
    for n in ("MC_USUARIO", "MC_SENHA", "MC_ROBO_USUARIO", "MC_ROBO_SENHA", "MC_ROBO_EMAIL", "MC_ROBO_APARELHO",
              "MC_EMAIL_SENHA_APP"):
        e.pop(n, None)                     # no servidor nunca há senha: quem está logado é o porteiro
    return e


def publicar_medicoes(cfg: dict) -> str:
    """Sobe dist/mc_medicoes/contratos.json pela API do GitHub (o Mapa de Obras lê do site) e devolve o clone limpo."""
    return publicar_arquivo(cfg, ARQ_MEDICOES, "Medições de contratos do MC %s (servidor) [skip ci]" % agora_iso())


def publicar_arquivo(cfg: dict, caminho: str, mensagem: str) -> str:
    """04/11: o mesmo das medições para qualquer arquivo do dist/ (medidores): sobe pela API do GitHub só se mudou
    e devolve o clone limpo (o servidor só faz git pull)."""
    import base64
    arq = RAIZ / caminho
    if not arq.exists():
        return "sem arquivo"
    tok_arq = cfg.get("github_token_arquivo")
    try:
        if not tok_arq:
            return "sem github_token_arquivo na configuração — não publiquei"
        tok = pathlib.Path(tok_arq).read_text(encoding="utf-8").strip()
        novo = arq.read_bytes()
        url = "https://api.github.com/repos/%s/contents/%s" % (REPO_GH, caminho)
        cab = {"Authorization": "Bearer " + tok, "Accept": "application/vnd.github+json", "User-Agent": "robo-servidor"}
        try:
            atual = json.loads(urllib.request.urlopen(urllib.request.Request(url + "?ref=main", headers=cab), timeout=60).read())
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
            atual = {}                       # arquivo novo no repositório
        if atual and base64.b64decode(atual.get("content") or "") == novo:
            return "sem mudança"
        corpo = {"message": mensagem, "branch": "main", "content": base64.b64encode(novo).decode()}
        if atual.get("sha"):
            corpo["sha"] = atual["sha"]
        req = urllib.request.Request(url, method="PUT", data=json.dumps(corpo).encode(), headers=cab)
        urllib.request.urlopen(req, timeout=60).read()
        return "publicado"
    finally:
        subprocess.run(["git", "checkout", "--", caminho], cwd=RAIZ, capture_output=True)
        # 04/11: arquivo NOVO no repositório (medidores, problemas da água) não tem o que o checkout devolver — e,
        # largado no clone, faz o próximo git pull parar com "untracked working tree file would be overwritten"
        r = subprocess.run(["git", "ls-files", "--error-unmatch", caminho], cwd=RAIZ, capture_output=True)
        if getattr(r, "returncode", 0) != 0:
            try:
                arq.unlink()
            except OSError:
                pass


def robo_antigo(nome: str) -> int:
    if nome not in ROBOS:
        log("[robo] desconhecido: %s" % nome)
        return 2
    cfg = json.loads(CONFIG.read_text(encoding="utf-8")).get("robos")
    if not cfg:
        log("[%s] sem a chave \"robos\" em %s" % (nome, CONFIG.name))
        return 2
    env, pior = env_robos(cfg), 0
    for item in ROBOS[nome]:
        script = item if isinstance(item, str) else item[0]       # 06/11: item = texto ou [script, argumento...]
        argv = [sys.executable] + ([item] if isinstance(item, str) else list(item))
        try:
            r = subprocess.run(argv, cwd=RAIZ, env=env, capture_output=True, text=True,
                               encoding="utf-8", errors="replace", timeout=PRAZO_ROBO_ANTIGO_S)
            codigo, fim = r.returncode, ((r.stdout or "").strip().splitlines() or [""])[-1]
            if codigo:
                fim = ((r.stderr or "").strip().splitlines() or [fim])[-1]
        except subprocess.TimeoutExpired:
            codigo, fim = 124, "passou de %d min" % (PRAZO_ROBO_ANTIGO_S // 60)
        log("[%s] %s código %s %s" % (nome, script, codigo, str(fim)[:200]))
        try:                    # 04/11: a saída inteira da última rodada de cada robô (o log só guarda a última linha)
            if "r" in locals():
                (LOGS / ("saida-%s.txt" % nome)).write_text(
                    "%s %s código %s\n%s\n%s" % (agora_iso(), script, codigo, (r.stdout or "")[-60000:], (r.stderr or "")[-20000:]),
                    encoding="utf-8")
        except Exception:
            pass
        if env.get("DESCOBRIR") and "r" in locals():          # 03/11: na descoberta, mostra a saída inteira
            print((r.stdout or "") + (r.stderr or ""))
        pior = pior or codigo
    if nome == "medicoes" and not pior:
        try:
            log("[medicoes] site: %s" % publicar_medicoes(cfg))
        except Exception as e:
            log("[medicoes] publicar FALHOU %s: %s" % (type(e).__name__, str(e)[:200]))
            pior = 1
    if nome == "medidores" and not pior and not env.get("DESCOBRIR") and not env.get("SIMULAR"):
        try:
            hora = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
            log("[medidores] site: %s" % publicar_arquivo(cfg, ARQ_MEDIDORES, "Medidores MC %s (servidor) [skip ci]" % hora))
        except Exception as e:
            log("[medidores] publicar FALHOU %s: %s" % (type(e).__name__, str(e)[:200]))
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
            if fila.nome == "teste" and fila.pode_gravar:   # 05/11: a 3ª chave está ligada — lembrar de apagar
                print("   ATENÇÃO: a fila de teste GRAVA no Mais Controle (%s existe)" % TESTE_PODE_GRAVAR.name)
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
        return com_trava(lambda: na_vez("indices", indices), TRAVA_INDICES)
    if a.robo:                          # sem a trava da fila (não usam a fila), mas um de cada vez no MC
        return na_vez(a.robo, lambda: robo_antigo(a.robo))
    codigo = com_trava(rodada)
    atualizar_codigo()
    publicar_escritorio()
    return codigo


def publicar_escritorio() -> None:
    """03/11/2026 — aba ESCRITÓRIO DE ROBÔS do portal: a cada 5 min (04/11: era 15; o dono quer saber logo se o porteiro caiu) (a fila roda de minuto em minuto) sobe o
    retrato das tarefas agendadas, rodadas e saúde da fila (servidor/escritorio_robos.py). Nunca atrapalha a fila."""
    try:
        sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
        import escritorio_robos
        if escritorio_robos.publicar_se_passou(5, lambda m: log("[escritorio] " + m)):
            publicar_problemas_agua((escritorio_robos.ULTIMO or {}).get("agua"))
            publicar_contas_agua()
    except Exception as e:
        log("[escritorio] FALHOU %s: %s" % (type(e).__name__, str(e)[:150]))


#: 05/11: o servidor só recebia código novo quando alguém clicava num .bat — o PR #103 ficou 13 h sem chegar. Agora a
#: fila (de minuto em minuto) faz o git pull sozinha a cada ATUALIZAR_MIN, só com o clone limpo e nenhum robô do MC
#: rodando (quem já está rodando termina com o código com que começou).
ATUALIZAR_MIN = 15
MARCA_PULL = CENTRAL / "ultimo-git-pull.txt"
URL_REPO = "https://github.com/DEVMoraisEng/PORTAL-MORAIS.git"


def atualizar_codigo(agora=time.time, rodar=subprocess.run) -> str | None:
    try:
        if MARCA_PULL.exists() and agora() - MARCA_PULL.stat().st_mtime < ATUALIZAR_MIN * 60:
            return None
        CENTRAL.mkdir(parents=True, exist_ok=True)
        # 05/11: com os anexos rodando o dia inteiro, "nenhum robô rodando" quase nunca acontecia e o código novo não
        # chegava. Quem já está rodando carregou o código dele; só espera quem COMEÇOU agora (pode estar importando).
        try:
            for x in RODANDO.glob("*.json"):
                if agora() - x.stat().st_mtime < 90:
                    return "robô começando agora — tento no próximo minuto"
        except Exception:
            pass
        MARCA_PULL.write_text(dt.datetime.now().isoformat(timespec="seconds"), encoding="utf-8")
        st = rodar(["git", "status", "--porcelain", "-uno"], cwd=RAIZ, capture_output=True, text=True, timeout=60)
        if (st.stdout or "").strip():
            log("[atualizar] clone com mudança local, não puxei: %s" % (st.stdout or "").strip().replace("\n", " | ")[:200])
            return "clone sujo"
        antes = rodar(["git", "rev-parse", "--short", "HEAD"], cwd=RAIZ, capture_output=True, text=True, timeout=60)
        r = rodar(["git", "pull", "--ff-only", URL_REPO, "main"], cwd=RAIZ, capture_output=True, text=True, timeout=180)
        depois = rodar(["git", "rev-parse", "--short", "HEAD"], cwd=RAIZ, capture_output=True, text=True, timeout=60)
        if r.returncode:
            log("[atualizar] git pull FALHOU: %s" % ((r.stderr or r.stdout or "").strip().splitlines() or [""])[-1][:200])
            return "falhou"
        if (antes.stdout or "").strip() != (depois.stdout or "").strip():
            log("[atualizar] código novo: %s → %s" % ((antes.stdout or "").strip(), (depois.stdout or "").strip()))
            return "atualizado"
        return "em dia"
    except Exception as e:
        log("[atualizar] FALHOU %s: %s" % (type(e).__name__, str(e)[:150]))
        return "falhou"


ARQ_PROBLEMAS_AGUA = "dist/agua_problemas.json"


def publicar_problemas_agua(sala) -> str | None:
    """04/11: a aba PROBLEMAS COM AS LIGAÇÕES (ligacoes.html) — pendências e repetidas da rodada da água, sem valores
    nem CPF. Sobe pela API do GitHub só quando muda (a rodada é uma vez por dia; o resto das vezes "sem mudança")."""
    try:
        import sala_agua
        doc = sala_agua.problemas_publicos(sala)
        if not doc.get("ok"):
            return None
        comparar = dict(doc, updated_at=None)
        marca = CENTRAL / "agua-problemas-publicado.json"
        try:
            if json.loads(marca.read_text(encoding="utf-8")) == comparar:
                return "sem mudança"
        except Exception:
            pass
        cfg = json.loads(CONFIG.read_text(encoding="utf-8")).get("robos") or {}
        arq = RAIZ / ARQ_PROBLEMAS_AGUA
        arq.parent.mkdir(parents=True, exist_ok=True)
        arq.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        res = publicar_arquivo(cfg, ARQ_PROBLEMAS_AGUA,
                               "Problemas das ligações %s (servidor) [skip ci]" % dt.datetime.now().strftime("%Y-%m-%d %H:%M"))
        if res in ("publicado", "sem mudança"):
            marca.write_text(json.dumps(comparar, ensure_ascii=False), encoding="utf-8")
        log("[escritorio] problemas das ligações: %s (%d pendência(s), %d repetida(s))" % (
            res, len(doc["itens"]), len(doc["duplicadas"])))
        return res
    except Exception as e:
        log("[escritorio] problemas das ligações FALHOU %s: %s" % (type(e).__name__, str(e)[:150]))
        return None


ARQ_CONTAS_AGUA = "dist/agua_contas.json"


def publicar_contas_agua() -> str | None:
    """09/11: a aba CONTROLE DE CONTAS VENCIDAS (ligacoes.html) — STATUS de cada UC e o que o robô de água e energia
    fez nela (lançou, REF e link; ou por que não lançou). Sem CPF, valor ou nome de cliente. Só sobe quando muda."""
    try:
        import sala_agua
        doc = sala_agua.contas_publicas()
        if not doc.get("ok"):
            return None
        comparar = dict(doc, updated_at=None)
        marca = CENTRAL / "agua-contas-publicado.json"
        try:
            if json.loads(marca.read_text(encoding="utf-8")) == comparar:
                return "sem mudança"
        except Exception:
            pass
        cfg = json.loads(CONFIG.read_text(encoding="utf-8")).get("robos") or {}
        arq = RAIZ / ARQ_CONTAS_AGUA
        arq.parent.mkdir(parents=True, exist_ok=True)
        arq.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        res = publicar_arquivo(cfg, ARQ_CONTAS_AGUA,
                               "Contas de água e energia %s (servidor) [skip ci]" % dt.datetime.now().strftime("%Y-%m-%d %H:%M"))
        if res in ("publicado", "sem mudança"):
            marca.write_text(json.dumps(comparar, ensure_ascii=False), encoding="utf-8")
        log("[escritorio] contas de água e energia: %s (%d UC(s))" % (res, len(doc["contas"])))
        return res
    except Exception as e:
        log("[escritorio] contas de água e energia FALHOU %s: %s" % (type(e).__name__, str(e)[:150]))
        return None


if __name__ == "__main__":
    sys.exit(main())
