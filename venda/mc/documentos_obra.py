# -*- coding: utf-8 -*-
"""Documentos do Orçamento do Mais Controle → dossiê do imóvel da casa de rua (05/11/2026).

Pedido do dono (05/11/2026): "no Mais Controle, em Obras > Orçamentos, tem vários documentos anexados (matrículas,
certidões etc.). Colocar um vigia no servidor rodando todo dia cedo para buscar essas informações lá e sempre anexar
automaticamente se aparecer."

Todo dia, para cada casa de rua com venda (CLIENTES preenchido, sem contrato assinado, fora do condomínio):
  1. acha a obra no MC pelo nome = ENDEREÇO da casa (GET /works/all-for-sale; zero à esquerda não conta);
  2. lista as pastas do Orçamento (GET /folder?id=<obra>&origin=PLANNING) e classifica cada arquivo pelo nome do
     arquivo (ou, sem pista nele, pelo nome da pasta): matrícula, certidão mãe, alvará, habite-se. Nome que aponta
     para mais de um documento fica PENDENTE (o relatório conta; ninguém anexa no chute);
  3. arquivo novo (id do MC que a casa ainda não viu) vai para o espaço do dossiê do imóvel na VENDAS — baixado pelo
     link do próprio MC (GET /file/{id}/get-url) e subido ao Notion (File Upload API). Na PRIMEIRA vez que o robô olha a
     casa, espaço que já tem documento não recebe (o arquivo é só anotado como visto: o documento já estava lá); dali
     em diante, todo arquivo novo que aparecer no MC é anexado. Nunca apaga nem troca arquivo do Notion;
  4. marca o espaço como "novo, não lido" (coluna DOSSIÊ IMÓVEL - NOVOS DO MAIS CONTROLE; o portal passa para os
     pendentes do dossiê) e escreve uma linha na DOSSIÊ IMÓVEL - OBSERVAÇÃO;
  5. guarda os ids do MC já vistos na coluna MC - DOCUMENTOS DO ORÇAMENTO (JSON) para não repetir;
  6. copia o cliente da obra no MC (o proprietário: nome, CPF/CNPJ, endereço, e-mail) nas colunas VENDEDOR MC - … —
     o contrato usa só para completar o vendedor (ContratoVenda.comporVendedor).

Só LÊ o Mais Controle, e só pelo Chrome do porteiro (MC_VIA=porteiro; regra do dono de 14/10: nunca login por fora).
Grava no Notion só com APLICAR=1 (o robo_fila.py põe quando existe _central\\ROBOS_APLICAR.txt); sem ele, simula e
conta o que faria. Coluna que a base não tem: aquela parte fica de fora, com aviso no relatório.
Saída (relatório da rodada): só contagens e 8 letras do id da página — nunca nome, endereço, CPF ou nome de arquivo.
Ambiente: NOTION_TOKEN, DB_VENDAS (id da base BANCO DE DADOS VENDAS), MC_VIA=porteiro, APLICAR.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re

import requests

from . import regras as R

API = "https://api.notion.com/v1"
VERSAO = "2022-06-28"

# espaço do dossiê do imóvel -> coluna de arquivos da VENDAS (os mesmos do RegrasVenda.ESPACOS_IMOVEL)
ESPACOS = {
    "IMOVEL_MATRICULA": "IMÓVEL - MATRÍCULA",
    "IMOVEL_CERTIDAO_MAE": "IMÓVEL - CERTIDÃO MÃE",
    "IMOVEL_ALVARA": "IMÓVEL - ALVARÁ",
    "IMOVEL_HABITESE": "IMÓVEL - HABITE-SE",
}
ORDEM = ["IMOVEL_MATRICULA", "IMOVEL_CERTIDAO_MAE", "IMOVEL_ALVARA", "IMOVEL_HABITESE"]   # RegrasVenda.ORDEM_LEITURA
ROTULO = {"IMOVEL_MATRICULA": "Matrícula do imóvel", "IMOVEL_CERTIDAO_MAE": "Certidão mãe",
          "IMOVEL_ALVARA": "Alvará de construção", "IMOVEL_HABITESE": "Habite-se"}
COL_NOVOS = "DOSSIÊ IMÓVEL - NOVOS DO MAIS CONTROLE"      # RegrasVenda.COL_MC_DOCS.NOVOS
COL_VISTOS = "MC - DOCUMENTOS DO ORÇAMENTO"               # RegrasVenda.COL_MC_DOCS.VISTOS
COL_OBS = "DOSSIÊ IMÓVEL - OBSERVAÇÃO"
COL_CLIENTES = "CLIENTES"
COL_SITUACAO = "ASSINATURA - SITUAÇÃO"
COL_CONDOMINIO = "CONDOMÍNIO - VENDA ID"
COL_VENDEDOR_MC = {"nome": "VENDEDOR MC - NOME", "doc": "VENDEDOR MC - CPF/CNPJ", "endereco": "VENDEDOR MC - ENDEREÇO",
                   "email": "VENDEDOR MC - E-MAIL"}                        # RegrasVenda.COL_VENDEDOR_MC
# o portal lê PDF e imagem (RegrasVenda.ACEITOS / LIMITE_*): o resto não serve para a IA
MIME = {"pdf": "application/pdf", "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}
LIMITE = {"application/pdf": 10 * 1024 * 1024}
LIMITE_IMAGEM = 5 * 1024 * 1024
AMBIGUO = "AMBIGUO"


# ---------------------------------------------------------------- regras puras
def _palavras(s) -> str:
    """Nome comparável: sem acento, maiúsculas, só letras e números separados por um espaço."""
    return " " + " ".join(re.sub(r"[^A-Z0-9]+", " ", R.chave(s)).split()) + " "


def _classes(s) -> set:
    p = _palavras(s)
    achou = set()
    mae = " MAE " in p                          # "matrícula-mãe", "certidão mãe", pasta "MÃE"
    if mae:
        achou.add("IMOVEL_CERTIDAO_MAE")
    if " HABITE " in p or " HABITESE " in p or " HABITE SE " in p or " CONCLUSAO DE OBRA" in p:
        achou.add("IMOVEL_HABITESE")
    if " ALVARA " in p or " ALVARAS " in p:
        achou.add("IMOVEL_ALVARA")
    if not mae and (" MATRICULA " in p or " MATRICULAS " in p or " INTEIRO TEOR " in p or " MAT " in p):
        achou.add("IMOVEL_MATRICULA")
    return achou


def classificar(nome_arquivo: str, nome_pasta: str = "") -> str:
    """Espaço do dossiê do imóvel pelo nome do arquivo; sem pista nele, pelo nome da pasta.
    "" = não é documento do imóvel (ignorado); AMBIGUO = o nome aponta para mais de um (fica pendente)."""
    for s in (nome_arquivo, nome_pasta):
        c = _classes(s)
        if len(c) == 1:
            return c.pop()
        if len(c) > 1:
            return AMBIGUO
    return ""


def mime_do_arquivo(arq: dict) -> str:
    ext = str(arq.get("extension") or "").lower().lstrip(".")
    if not ext:
        m = re.search(r"\.([A-Za-z0-9]{2,5})$", str(arq.get("name") or ""))
        ext = m.group(1).lower() if m else ""
    return MIME.get(ext, "")


def nome_com_extensao(arq: dict) -> str:
    n, ext = str(arq.get("name") or "arquivo").strip(), str(arq.get("extension") or "").strip().lstrip(".")
    if ext and not n.lower().endswith("." + ext.lower()):
        n += "." + ext
    return n[:180]


def cabe(arq: dict, mime: str) -> bool:
    t = arq.get("sizeInBytes")
    if not isinstance(t, (int, float)) or t <= 0:
        return True                          # sem tamanho na lista: confere depois de baixar
    return t <= LIMITE.get(mime, LIMITE_IMAGEM)


def chave_endereco(s) -> str:
    """Como o ctrChaveEndereco_ do portal: "TB 06 QD 40" = "TB 6 QD 40"."""
    return re.sub(r"\b0+(\d)", r"\1", R.chave(s))


def achar_obra(obras: list, endereco: str):
    """(obra, "") ou (None, "SEM_OBRA" | "OBRA_AMBIGUA")."""
    k = chave_endereco(endereco)
    if not k:
        return None, "SEM_OBRA"
    achadas = [o for o in obras or [] if chave_endereco(o.get("name")) == k]
    if len(achadas) > 1:
        return None, "OBRA_AMBIGUA"
    return (achadas[0], "") if achadas else (None, "SEM_OBRA")


def valor(props: dict, nome: str):
    """Valor solto da coluna pelo nome normalizado (CLIENTES tem espaço no fim na base real)."""
    k = R.chave(nome)
    for n, pr in (props or {}).items():
        if R.chave(n) == k:
            if isinstance(pr, dict) and pr.get("type") == "files":
                return pr.get("files") or []
            return R._valor(pr)
    return None


def nome_real(props: dict, nome: str, tipo: str | None = None) -> str:
    k = R.chave(nome)
    for n, pr in (props or {}).items():
        if R.chave(n) == k and (tipo is None or (pr or {}).get("type") == tipo):
            return n
    return ""


def titulo(props: dict) -> str:
    for pr in (props or {}).values():
        if isinstance(pr, dict) and pr.get("type") == "title":
            return "".join(x.get("plain_text", "") for x in pr.get("title") or []).strip()
    return ""


def casa_alvo(props: dict) -> bool:
    """Casa de rua com venda e sem contrato assinado."""
    if not titulo(props) or not str(valor(props, COL_CLIENTES) or "").strip():
        return False
    if str(valor(props, COL_CONDOMINIO) or "").strip():
        return False                          # condomínio: o imóvel mora na linha do condomínio
    return R.chave(valor(props, COL_SITUACAO)) != "ASSINADO"


def ler_vistos(texto) -> tuple[bool, dict]:
    """(já olhou esta casa antes?, {id do arquivo do MC: "A:<espaço>" anexado | "J:<espaço>" já tinha documento})."""
    s = str(texto or "").strip()
    if not s:
        return False, {}
    try:
        o = json.loads(s)
    except ValueError:
        return True, {}
    ids = o.get("ids") if isinstance(o, dict) else None
    return True, dict(ids) if isinstance(ids, dict) else {}


def escrever_vistos(ids: dict) -> str:
    return json.dumps({"v": 1, "ids": ids}, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def planejar(props: dict, pastas: list) -> dict:
    """O que fazer com os arquivos das pastas do Orçamento desta casa. Puro (sem rede).
    {"anexar": [(espaço, arquivo)], "ja_tinha": [(espaço, arquivo)], "ambiguos": n, "formato": n, "sem_coluna": [espaço],
     "ignorados": n, "vistos_antes": bool}"""
    olhou, vistos = ler_vistos(valor(props, COL_VISTOS))
    plano = {"anexar": [], "ja_tinha": [], "ambiguos": 0, "formato": 0, "sem_coluna": [], "ignorados": 0, "vistos_antes": olhou}
    for pasta in pastas or []:
        for arq in (pasta or {}).get("files") or []:
            if not isinstance(arq, dict) or not arq.get("id") or arq.get("temporary") is True:
                continue
            aid = str(arq["id"])
            if aid in vistos:
                continue
            esp = classificar(arq.get("name"), (pasta or {}).get("name"))
            if not esp:
                plano["ignorados"] += 1
                continue
            if esp == AMBIGUO:
                plano["ambiguos"] += 1
                continue
            mime = mime_do_arquivo(arq)
            if not mime or not cabe(arq, mime):
                plano["formato"] += 1
                continue
            col = nome_real(props, ESPACOS[esp], "files")
            if not col:
                if esp not in plano["sem_coluna"]:
                    plano["sem_coluna"].append(esp)
                continue
            atuais = props[col].get("files") or []
            mesmo_nome = any(R.chave(f.get("name")) == R.chave(nome_com_extensao(arq)) for f in atuais)
            if mesmo_nome or (not olhou and atuais):
                plano["ja_tinha"].append((esp, arq))      # primeira olhada com documento no espaço: o documento já estava
            else:
                plano["anexar"].append((esp, arq))
    return plano


def espacos_novos(texto, novos: list) -> str:
    """Junta os espaços já marcados na coluna com os novos, sem repetir, na ordem de leitura."""
    tem = [x for x in re.split(r"[,;\s]+", str(texto or "")) if x in ESPACOS]
    tudo = [e for e in ORDEM if e in tem or e in novos]
    return ", ".join(tudo)


def _fmt_doc(cpf, cnpj) -> str:
    d = R.so_digitos(cnpj) or R.so_digitos(cpf)
    if len(d) == 14:
        return "%s.%s.%s/%s-%s" % (d[:2], d[2:5], d[5:8], d[8:12], d[12:])
    if len(d) == 11:
        return "%s.%s.%s-%s" % (d[:3], d[3:6], d[6:9], d[9:])
    return d


def _fmt_endereco(a) -> str:
    if not isinstance(a, dict):
        return ""
    cid = a.get("city") or {}
    uf = ((cid.get("state") or {}).get("abbreviation") or "") if isinstance(cid, dict) else ""
    cidade = cid.get("name") if isinstance(cid, dict) else ""
    cep = R.so_digitos(a.get("zipCode"))
    partes = [a.get("address"), a.get("addressNumber"), a.get("complement"), a.get("neighborhood"),
              ("CEP %s-%s" % (cep[:5], cep[5:])) if len(cep) == 8 else "",
              " - ".join(x for x in (str(cidade or "").strip(), str(uf or "").strip()) if x)]
    return ", ".join(" ".join(str(p).split()) for p in partes if p and str(p).strip())


def vendedor_do_mc(obra: dict) -> dict:
    """O cliente da obra no MC (o proprietário): {nome, doc, endereco, email} — vazio quando não há."""
    c = (obra or {}).get("customer") or {}
    if not isinstance(c, dict):
        return {}
    v = {"nome": " ".join(str(c.get("name") or c.get("corporateName") or "").split()),
         "doc": _fmt_doc(c.get("cpf"), c.get("cnpj")),
         "endereco": _fmt_endereco(c.get("address")), "email": str(c.get("email") or "").strip()}
    return v if v["nome"] or v["doc"] else {}


# ---------------------------------------------------------------- Notion
class NotionArquivos:
    """O pouco de Notion que o robô usa: ler a base, a página, subir arquivo e gravar a página."""

    def __init__(self, token: str, sessao=None):
        self.token = token
        self.http = sessao or requests.Session()

    def _cab(self, json_=True) -> dict:
        h = {"Authorization": "Bearer " + self.token, "Notion-Version": VERSAO}
        if json_:
            h["Content-Type"] = "application/json"
        return h

    def _ok(self, r, oque):
        if r.status_code >= 300:
            raise RuntimeError("Notion %s -> HTTP %s" % (oque, r.status_code))
        return r.json() if r.text.strip() else {}

    def linhas(self, db_id: str) -> list:
        out, cur = [], None
        while True:
            corpo = {"page_size": 100}
            if cur:
                corpo["start_cursor"] = cur
            j = self._ok(self.http.post(API + "/databases/%s/query" % db_id, json=corpo, headers=self._cab(), timeout=60), "query")
            out += j.get("results") or []
            if not j.get("has_more"):
                return out
            cur = j.get("next_cursor")

    def pagina(self, page_id: str) -> dict:
        return self._ok(self.http.get(API + "/pages/" + page_id, headers=self._cab(), timeout=60), "GET página")

    def subir(self, nome: str, mime: str, conteudo: bytes) -> str:
        """File Upload API (single part, até 20 MB): cria, envia e devolve o id para pôr na coluna."""
        fu = self._ok(self.http.post(API + "/file_uploads", json={"filename": nome, "content_type": mime},
                                     headers=self._cab(), timeout=60), "file_uploads")
        url = fu.get("upload_url") or (API + "/file_uploads/%s/send" % fu.get("id"))
        self._ok(self.http.post(url, files={"file": (nome, conteudo, mime)}, headers=self._cab(False), timeout=300), "envio do arquivo")
        return fu["id"]

    def gravar(self, page_id: str, props: dict) -> None:
        self._ok(self.http.patch(API + "/pages/" + page_id, json={"properties": props}, headers=self._cab(), timeout=60), "PATCH")


def _manter(f: dict) -> dict:
    """Arquivo que já está na coluna: a API troca a lista inteira, então ele volta como {type: file|external}."""
    if f.get("type") == "external":
        return {"type": "external", "name": f.get("name"), "external": {"url": (f.get("external") or {}).get("url")}}
    return {"type": "file", "name": f.get("name"), "file": {"url": (f.get("file") or {}).get("url")}}


def _rt(s: str) -> dict:
    s = str(s or "")
    return {"rich_text": [{"type": "text", "text": {"content": s[i:i + 1900]}} for i in range(0, min(len(s), 1900 * 90), 1900)]}


def baixar(erp, http, arq: dict, mime: str) -> bytes:
    link = erp.link_do_arquivo(str(arq["id"]))
    if not link:
        raise RuntimeError("o MC não deu o link do arquivo")
    r = http.get(link, timeout=180)
    if r.status_code >= 300:
        raise RuntimeError("download do arquivo -> HTTP %s" % r.status_code)
    if len(r.content) > LIMITE.get(mime, LIMITE_IMAGEM):
        raise ValueError("GRANDE")
    return r.content


def processar_casa(notion, erp, http, linha: dict, obras: list, aplicar: bool, hoje: str) -> dict:
    """Uma casa. Devolve as contagens e o motivo (código) quando não deu: {"res": "ok"|"sem_obra"|..., ...}."""
    props, pid = linha.get("properties") or {}, str(linha.get("id") or "")
    obra, motivo = achar_obra(obras, titulo(props))
    if not obra:
        return {"res": motivo.lower()}
    pastas = erp.pastas(str(obra.get("id")), "PLANNING")
    plano = planejar(props, pastas)
    out = {"res": "ok", "anexados": 0, "ja_tinha": len(plano["ja_tinha"]), "ambiguos": plano["ambiguos"],
           "formato": plano["formato"], "sem_coluna": plano["sem_coluna"], "falhas": 0, "vendedor_mc": False}
    # o proprietário da obra no MC -> VENDEDOR MC - … (só colunas que existem; só quando mudou)
    try:
        vmc = vendedor_do_mc(erp.obra(str(obra.get("id"))))
    except Exception:   # noqa: BLE001 — sem o detalhe da obra, só não completa o vendedor
        vmc = {}
    mudar_vendedor = {}
    for campo, col in COL_VENDEDOR_MC.items():
        real = nome_real(props, col, "rich_text")
        if real and vmc.get(campo) and str(valor(props, col) or "").strip() != vmc[campo]:
            mudar_vendedor[real] = _rt(vmc[campo])
    if not aplicar:
        out["anexados"] = len(plano["anexar"])        # simulação: o que anexaria
        out["vendedor_mc"] = bool(mudar_vendedor)
        return out
    _, vistos = ler_vistos(valor(props, COL_VISTOS))
    col_vistos = nome_real(props, COL_VISTOS, "rich_text")
    if not col_vistos:
        out["res"] = "sem_coluna_vistos"              # sem onde lembrar, anexaria de novo todo dia: não anexa
        if mudar_vendedor:
            notion.gravar(pid, mudar_vendedor)
            out["vendedor_mc"] = True
        return out
    for esp, arq in plano["ja_tinha"]:
        vistos[str(arq["id"])] = "J:" + esp
    # arquivos novos: baixa do MC e sobe ao Notion; um que falhe não para os outros (fica para amanhã)
    subidos = {}
    for esp, arq in plano["anexar"]:
        mime = mime_do_arquivo(arq)
        try:
            conteudo = baixar(erp, http, arq, mime)
            nome = nome_com_extensao(arq)
            subidos.setdefault(esp, []).append((nome, notion.subir(nome, mime, conteudo), str(arq["id"])))
        except ValueError:
            out["formato"] += 1
            vistos[str(arq["id"])] = "G:" + esp       # grande demais para a IA: não tenta todo dia
        except Exception:   # noqa: BLE001
            out["falhas"] += 1
    gravar = dict(mudar_vendedor)
    if subidos:
        atual = notion.pagina(pid).get("properties") or {}   # lista de arquivos de AGORA (alguém pode ter anexado)
        linhas_obs = []
        for esp, lista in subidos.items():
            col = nome_real(atual, ESPACOS[esp], "files")
            if not col:
                continue
            arquivos = [_manter(f) for f in (atual[col].get("files") or [])]
            for nome, fu_id, aid in lista:
                arquivos.append({"type": "file_upload", "name": nome, "file_upload": {"id": fu_id}})
                vistos[aid] = "A:" + esp
                linhas_obs.append("%s: arquivo %s anexado do Mais Controle (Obras > Orçamento) — novo, falta ler"
                                  % (ROTULO[esp], nome))
                out["anexados"] += 1
            gravar[col] = {"files": arquivos}
        col_novos = nome_real(atual, COL_NOVOS, "rich_text")
        if col_novos:
            gravar[col_novos] = _rt(espacos_novos(valor(atual, COL_NOVOS), list(subidos)))
        col_obs = nome_real(atual, COL_OBS, "rich_text")
        if col_obs and linhas_obs:
            antes = str(valor(atual, COL_OBS) or "")
            novas = "\n".join("[%s robô] %s" % (hoje, l) for l in linhas_obs)
            tudo = (antes + "\n" if antes else "") + novas
            gravar[col_obs] = _rt(tudo if len(tudo) <= 1900 else "…" + tudo[-1899:])
    gravar[col_vistos] = _rt(escrever_vistos(vistos))
    notion.gravar(pid, gravar)
    out["vendedor_mc"] = bool(mudar_vendedor)
    return out


def rodar(notion, erp, http, db_id: str, aplicar: bool, hoje: str, imprimir=print) -> int:
    casas = [l for l in notion.linhas(db_id) if casa_alvo(l.get("properties") or {})]
    tot = {"casas": len(casas), "obras": 0, "anexados": 0, "ja_tinha": 0, "ambiguos": 0, "formato": 0, "falhas": 0,
           "vendedor_mc": 0}
    pend, sem_coluna = [], set()
    if not casas:
        imprimir("documentos do orçamento: nenhuma casa de rua com venda aberta")
        return 0
    obras = erp.obras()
    for linha in casas:
        pid = str(linha.get("id") or "").replace("-", "")[:8]
        try:
            r = processar_casa(notion, erp, http, linha, obras, aplicar, hoje)
        except Exception as e:   # noqa: BLE001 — uma casa não para as outras
            tot["falhas"] += 1
            pend.append("%s erro %s" % (pid, type(e).__name__))
            continue
        if r["res"] in ("sem_obra", "obra_ambigua", "sem_coluna_vistos"):
            pend.append("%s %s" % (pid, r["res"]))
            if r["res"] != "sem_coluna_vistos":
                continue
        tot["obras"] += 1
        for k in ("anexados", "ja_tinha", "ambiguos", "formato", "falhas"):
            tot[k] += r.get(k, 0)
        tot["vendedor_mc"] += 1 if r.get("vendedor_mc") else 0
        sem_coluna.update(r.get("sem_coluna") or [])
        if r.get("ambiguos"):
            pend.append("%s %d arquivo(s) com nome ambíguo — conferir no Orçamento" % (pid, r["ambiguos"]))
    modo = "" if aplicar else " (SIMULAÇÃO: sem ROBOS_APLICAR.txt nada foi gravado)"
    imprimir("casas de rua com venda aberta: %d · obra achada no MC: %d" % (tot["casas"], tot["obras"]))
    imprimir("arquivos %s: %d · já estavam no dossiê: %d · nome ambíguo (pendente): %d · formato/tamanho fora: %d · "
             "falhas: %d" % ("anexados" if aplicar else "a anexar", tot["anexados"], tot["ja_tinha"], tot["ambiguos"],
                             tot["formato"], tot["falhas"]))
    imprimir("vendedor do MC %s em %d casa(s)" % ("atualizado" if aplicar else "a atualizar", tot["vendedor_mc"]))
    if sem_coluna:
        imprimir("AVISO: a VENDAS não tem a coluna de arquivos de: %s" % ", ".join(sorted(sem_coluna)))
    for p in pend[:60]:
        imprimir("pendência: " + p)
    if len(pend) > 60:
        imprimir("pendência: … mais %d" % (len(pend) - 60))
    falhou = tot["falhas"] > 0
    imprimir("%s: documentos do orçamento — %d anexado(s), %d pendência(s)%s"
             % ("FALHOU" if falhou else "OK", tot["anexados"], len(pend), modo))
    return 1 if falhou else 0


def main(argv=None) -> int:
    from . import erp as E
    if not E.pelo_porteiro():
        print("FALHOU: SO_PELO_PORTEIRO — este robô só fala com o Mais Controle pelo Chrome do porteiro (MC_VIA=porteiro)")
        return 2
    db_id, tok = os.environ.get("DB_VENDAS", "").strip(), os.environ.get("NOTION_TOKEN", "").strip()
    if not db_id or not tok:
        print("FALHOU: falta %s em robos-portal.json (\"robos\" › \"vars\")" % ("DB_VENDAS" if not db_id else "NOTION_TOKEN"))
        return 2
    aplicar = os.environ.get("APLICAR", "").strip() == "1"
    hoje = dt.date.today().strftime("%d/%m")
    erp = E.do_ambiente()
    try:
        return rodar(NotionArquivos(tok), erp, requests.Session(), db_id, aplicar, hoje)
    except E.ErpErro as e:
        print("FALHOU: Mais Controle — %s" % str(e).split(": ")[0][:200])   # sem o corpo da resposta (pode ter dado)
        return 1
    finally:
        f = getattr(erp, "fechar", None)
        if f:
            f()


if __name__ == "__main__":
    raise SystemExit(main())
