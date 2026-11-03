#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
robo_mc_anexos.py — PORTAL-MORAIS (03/11/2026) · anexos dos pagamentos na Auditoria Financeira

Traz do Mais Controle os arquivos (boleto, NF, recibo, comprovante) dos pagamentos que a Auditoria
Financeira mostra, para abrir direto da linha do pagamento (📎).

Roda NO SERVIDOR, pela aba do Chrome do porteiro (MC_VIA=porteiro) — sem login nenhum:
    python servidor\\robo_fila.py --robo anexos
Só LÊ o Mais Controle. Nada é gravado no ERP.

O que faz, em ordem:
  1. Baixa a auditoria publicada (bucket privado "analise", auditoria/auditoria.json).
  2. Escolhe os lançamentos: pagamentos dos últimos ANEXOS_DIAS dias (padrão 90) com algum alerta
     (classificação diferente de OK ou alerta de fiscalização). ANEXOS_ESCOPO=todos pega todos os do período.
  3. Para cada lançamento: GET /trade-payables/{id} (lançamento) → pasta do lançamento (origem
     TRADE_PAYABLE) e as baixas (origem PAID, onde costuma ficar o comprovante) → GET /folder → arquivos
     → GET /file/{id}/get-url (link assinado do próprio MC). Receita lida no código do site em 03/11.
  4. Link do MC que vale 24 h ou mais: usa ele (renovado toda rodada). Link mais curto: copia o arquivo para
     o bucket privado (auditoria/anexos/<lançamento>/...) e assina por 3 dias.
  5. Grava em auditoria.json a chave "anexos" — a tela lê junto com o resto, sem mudar o Apps Script.
     O robô da madrugada (GitHub) preserva essa chave quando regrava a auditoria.

MODOS:
  DESCOBRIR=1  só 3 lançamentos; imprime o FORMATO das respostas (chaves, contagens, validade do link) —
               nunca nome de arquivo, fornecedor ou valor. Não grava nada.
  ANEXOS_MAX_ITENS (padrão 700) lançamentos consultados por rodada; os já vistos e sem pagamento recente
               não são consultados de novo (só têm o link renovado, quando é link do MC).

SEGREDOS (servidor, robos-portal.json › "robos"): SUPABASE_URL em "vars" e "supabase_key_arquivo" com a
service key (o dono cola no arquivo; ninguém vê).
Log curto: contagens e códigos — nunca nome de arquivo, fornecedor, valor ou link.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
import time
import unicodedata
from urllib.parse import parse_qs, quote, urlparse

import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
BUCKET, CAMINHO = "analise", "auditoria/auditoria.json"
PASTA = "auditoria/anexos"
DIAS = int(os.environ.get("ANEXOS_DIAS") or 90)
ESCOPO = (os.environ.get("ANEXOS_ESCOPO") or "alertas").strip().lower()
MAX_ITENS = int(os.environ.get("ANEXOS_MAX_ITENS") or 700)
MAX_MB_RODADA = float(os.environ.get("ANEXOS_MAX_MB") or 250)
RECHECAR_DIAS = 20                 # pagamento recente: confere de novo (comprovante costuma entrar depois)
VALIDADE_COPIA_S = 3 * 86400
DESCOBRIR = os.environ.get("DESCOBRIR", "").strip().lower() in ("1", "true", "sim")
HOJE = dt.date.today()


def log(*a):
    print(*a, flush=True)


def N(s):
    s = unicodedata.normalize("NFD", str(s or ""))
    return " ".join("".join(c for c in s if unicodedata.category(c) != "Mn").upper().split())


# ----------------------------------------------------------------- Supabase
def _h(extra=None):
    h = {"apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY}
    h.update(extra or {})
    return h


def sb_baixar_json():
    r = requests.get(f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{CAMINHO}", headers=_h(), timeout=180)
    r.raise_for_status()
    return r.json()


def sb_gravar_json(conteudo):
    corpo = json.dumps(conteudo, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8")
    r = requests.post(f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{CAMINHO}", data=corpo, timeout=240,
                      headers=_h({"Content-Type": "application/json", "x-upsert": "true", "Cache-Control": "no-cache"}))
    if r.status_code >= 300:
        raise RuntimeError(f"Storage HTTP {r.status_code}: {r.text[:200]}")
    return len(corpo)


def sb_subir(caminho, conteudo, mime):
    r = requests.post(f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{quote(caminho)}", data=conteudo, timeout=240,
                      headers=_h({"Content-Type": mime or "application/octet-stream", "x-upsert": "true"}))
    if r.status_code >= 300:
        raise RuntimeError(f"upload HTTP {r.status_code}: {r.text[:200]}")


def sb_assinar(caminho, segundos=VALIDADE_COPIA_S):
    r = requests.post(f"{SUPABASE_URL}/storage/v1/object/sign/{BUCKET}/{quote(caminho)}", timeout=60,
                      headers=_h({"Content-Type": "application/json"}), data=json.dumps({"expiresIn": segundos}))
    r.raise_for_status()
    u = (r.json() or {}).get("signedURL") or (r.json() or {}).get("signedUrl") or ""
    return (SUPABASE_URL + "/storage/v1" + u) if u.startswith("/") else u


def sb_apagar(caminhos):
    if not caminhos:
        return
    requests.delete(f"{SUPABASE_URL}/storage/v1/object/{BUCKET}", timeout=60,
                    headers=_h({"Content-Type": "application/json"}), data=json.dumps({"prefixes": caminhos}))


# ----------------------------------------------------------------- escolha dos lançamentos
def escolher(aud):
    c, d = aud["cols"], aud["dict"]
    st = d.get("st") or []
    lim = (HOJE - dt.timedelta(days=DIAS)).isoformat()
    com_fiscal = {int(f[1]) for f in (aud.get("fiscal") or []) if isinstance(f, (list, tuple)) and len(f) > 1}
    ultimo_pg = {}
    for i, idl in enumerate(c["id"]):
        dp = c["dp"][i] or ""
        if not idl or dp < lim:
            continue
        rot = st[c["st"][i]] if isinstance(c["st"][i], int) and c["st"][i] < len(st) else str(c["st"][i])
        if ESCOPO != "todos" and rot == "OK" and i not in com_fiscal:
            continue
        ultimo_pg[int(idl)] = max(ultimo_pg.get(int(idl), ""), dp)
    return ultimo_pg                      # {id do lançamento: data do último pagamento}


# ----------------------------------------------------------------- Mais Controle
def _lista(x):
    if isinstance(x, list):
        return x
    if isinstance(x, dict):
        for k in ("content", "items", "folders", "files", "data"):
            if isinstance(x.get(k), list):
                return x[k]
    return []


def _baixas(obj, achados):
    """Baixas (pagamentos) dentro do lançamento: objetos com payingDate e id."""
    if isinstance(obj, dict):
        if obj.get("id") and ("payingDate" in obj or "paidValue" in obj):
            achados.append(obj)
        for v in obj.values():
            _baixas(v, achados)
    elif isinstance(obj, list):
        for v in obj:
            _baixas(v, achados)


def _url_de(resp):
    if isinstance(resp, str):
        return resp.strip('"') if resp.strip('"').startswith("http") else ""
    if isinstance(resp, dict):
        for k in ("url", "signedUrl", "downloadUrl", "value", "link"):
            if isinstance(resp.get(k), str) and resp[k].startswith("http"):
                return resp[k]
        for v in resp.values():
            if isinstance(v, str) and v.startswith("http"):
                return v
    return ""


def validade_s(url):
    """Segundos de validade do link assinado (S3: X-Amz-Expires ou Expires=epoch). None se não der para saber."""
    q = {k.lower(): v[0] for k, v in parse_qs(urlparse(url).query).items()}
    if "x-amz-expires" in q:
        try:
            return int(q["x-amz-expires"])
        except ValueError:
            return None
    if "expires" in q:
        try:
            return int(q["expires"]) - int(time.time())
        except ValueError:
            return None
    return None


class LeitorMC:
    def __init__(self, erp):
        self.erp = erp
        self.chamadas = 0
        self.rota_lanc = None          # qual endpoint respondeu o lançamento

    def _get(self, caminho, params=None):
        self.chamadas += 1
        time.sleep(0.12)
        return self.erp.pedir("GET", caminho, params=params)

    def lancamento(self, idl):
        rotas = [self.rota_lanc] if self.rota_lanc else ["/trade-payables/%s", "/payable-installments/%s/overview"]
        ult = None
        for r in rotas:
            try:
                j = self._get(r % idl)
                if j:
                    self.rota_lanc = r
                    return j
            except Exception as e:
                ult = e
        if ult:
            raise ult
        return None

    def pastas(self, origem, rotina_id):
        try:
            return _lista(self._get("/folder", {"id": rotina_id, "origin": origem}))
        except Exception:
            return []

    def arquivos_da_pasta(self, pasta):
        arqs = _lista(pasta.get("files")) if isinstance(pasta, dict) else []
        if not arqs and isinstance(pasta, dict) and pasta.get("id"):
            try:
                arqs = _lista((self._get("/folder/%s" % pasta["id"]) or {}).get("files"))
            except Exception:
                arqs = []
        return [a for a in arqs if isinstance(a, dict) and a.get("id") and a.get("temporary") is not True]

    def link(self, arq_id):
        return _url_de(self._get("/file/%s/get-url" % arq_id))

    def anexos(self, idl):
        """[(origem, arquivo)] do lançamento e das baixas dele."""
        lanc = self.lancamento(idl) or {}
        rotinas = [("TRADE_PAYABLE", idl)]
        tp = lanc.get("tradePayable") if isinstance(lanc.get("tradePayable"), dict) else lanc
        if isinstance(tp, dict) and tp.get("id") and str(tp.get("id")) != str(idl):
            rotinas.append(("TRADE_PAYABLE", tp["id"]))
        baixas = []
        _baixas(lanc, baixas)
        for b in baixas:
            rotinas.append(("PAID", b["id"]))
        vistos, out = set(), []
        for origem, rid in rotinas:
            for p in self.pastas(origem, rid):
                for a in self.arquivos_da_pasta(p):
                    if a["id"] in vistos:
                        continue
                    vistos.add(a["id"])
                    out.append((origem, a))
        return out, lanc, baixas


# ----------------------------------------------------------------- descoberta
def chaves(obj, n=40):
    return sorted(obj.keys())[:n] if isinstance(obj, dict) else type(obj).__name__


def descobrir(leitor, ids):
    log("DESCOBRIR: só formato, nada gravado")
    for idl in ids[:3]:
        log(f"— lançamento …{str(idl)[-4:]}")
        try:
            arqs, lanc, baixas = leitor.anexos(idl)
        except Exception as e:
            log(f"  lançamento: ERRO {type(e).__name__}: {str(e)[:160]}")
            continue
        log(f"  rota do lançamento: {leitor.rota_lanc}  chaves: {chaves(lanc)}")
        log(f"  folderId no lançamento: {'sim' if isinstance(lanc, dict) and lanc.get('folderId') else 'não'} · baixas achadas: {len(baixas)}"
            + (f" (chaves: {chaves(baixas[0], 25)})" if baixas else ""))
        log(f"  arquivos: {len(arqs)} · por origem: {dict((o, sum(1 for x, _ in arqs if x == o)) for o in {x for x, _ in arqs})}")
        if arqs:
            a = arqs[0][1]
            log(f"  chaves do arquivo: {chaves(a)} · tipo: {a.get('type') or a.get('mimeType')}")
            try:
                u = leitor.link(a["id"])
                log(f"  get-url: {'link ok' if u else 'SEM LINK'} · host: {urlparse(u).netloc if u else '-'} · validade: {validade_s(u) if u else '-'} s")
            except Exception as e:
                log(f"  get-url: ERRO {type(e).__name__}: {str(e)[:160]}")
    log(f"chamadas ao MC: {leitor.chamadas}")


# ----------------------------------------------------------------- rodada
def nome_seguro(s):
    s = unicodedata.normalize("NFD", str(s or "arquivo"))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^A-Za-z0-9._-]+", "_", s).strip("_")
    return (s or "arquivo")[-80:]


def rodada(leitor, aud, alvo):
    ant = (aud.get("anexos") or {}).get("itens") or {}
    agora = dt.datetime.now(dt.timezone.utc)
    lim_rechecar = (HOJE - dt.timedelta(days=RECHECAR_DIAS)).isoformat()
    itens, mb, consultados, copiados, erros, renovados = {}, 0.0, 0, 0, 0, 0
    apagar = []
    # lançamentos que saíram da janela: apaga as cópias
    for idl, it in ant.items():
        if int(idl) not in alvo:
            apagar += [a["p"] for a in it.get("a", []) if a.get("p")]
    ordem = sorted(alvo, key=lambda i: alvo[i], reverse=True)       # pagamento mais recente primeiro
    for idl in ordem:
        it_ant = ant.get(str(idl))
        precisa = it_ant is None or alvo[idl] >= lim_rechecar
        if not precisa or consultados >= MAX_ITENS or mb >= MAX_MB_RODADA:
            if it_ant:
                itens[str(idl)] = renovar(leitor, it_ant, agora) if it_ant.get("a") else it_ant
                renovados += 1 if it_ant.get("a") else 0
            continue
        consultados += 1
        try:
            arqs, _, _ = leitor.anexos(idl)
        except Exception as e:
            erros += 1
            if erros <= 5:
                log(f"  ! lançamento …{str(idl)[-4:]}: {type(e).__name__}: {str(e)[:120]}")
            if it_ant:
                itens[str(idl)] = it_ant
            continue
        lista, ja = [], {a.get("f"): a for a in (it_ant or {}).get("a", [])}
        for origem, a in arqs:
            reg = {"f": a["id"], "n": str(a.get("name") or "arquivo")[:120], "t": a.get("type") or a.get("mimeType") or "",
                   "o": "P" if origem == "PAID" else "L", "s": a.get("sizeInBytes") or a.get("size") or 0}
            try:
                u = leitor.link(a["id"])
                v = validade_s(u) if u else None
                if u and (v is None or v >= 86400):
                    reg.update({"u": u, "x": (agora + dt.timedelta(seconds=v or 86400)).isoformat(timespec="minutes")})
                elif u:
                    antigo = ja.get(a["id"])
                    if antigo and antigo.get("p"):
                        reg["p"] = antigo["p"]
                    else:
                        r = requests.get(u, timeout=120)
                        r.raise_for_status()
                        caminho = f"{PASTA}/{idl}/{a['id']}-{nome_seguro(reg['n'])}"
                        sb_subir(caminho, r.content, reg["t"])
                        reg["p"], reg["s"] = caminho, len(r.content)
                        mb += len(r.content) / 1e6
                        copiados += 1
                    reg.update({"u": sb_assinar(reg["p"]), "x": (agora + dt.timedelta(seconds=VALIDADE_COPIA_S)).isoformat(timespec="minutes")})
            except Exception as e:
                erros += 1
                if erros <= 5:
                    log(f"  ! arquivo de …{str(idl)[-4:]}: {type(e).__name__}: {str(e)[:120]}")
            lista.append(reg)
        itens[str(idl)] = {"v": agora.isoformat(timespec="minutes"), "a": lista}
    sb_apagar(apagar)
    return itens, {"consultados": consultados, "copiados": copiados, "mb": round(mb, 1), "erros": erros,
                   "renovados": renovados, "apagados": len(apagar), "chamadas": leitor.chamadas}


def renovar(leitor, it, agora):
    """Renova links que vencem nas próximas 36 h (link do MC: pede de novo; cópia: assina de novo)."""
    lim = (agora + dt.timedelta(hours=36)).isoformat(timespec="minutes")
    for a in it.get("a", []):
        if a.get("x") and a["x"] > lim:
            continue
        try:
            if a.get("p"):
                a["u"], a["x"] = sb_assinar(a["p"]), (agora + dt.timedelta(seconds=VALIDADE_COPIA_S)).isoformat(timespec="minutes")
            else:
                u = leitor.link(a["f"])
                v = validade_s(u) if u else None
                if u:
                    a["u"], a["x"] = u, (agora + dt.timedelta(seconds=v or 86400)).isoformat(timespec="minutes")
        except Exception:
            pass
    return it


def main():
    if not (SUPABASE_URL and SUPABASE_KEY):
        log("faltam SUPABASE_URL / SUPABASE_SERVICE_KEY (robos-portal.json › robos)")
        return 2
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from venda.mc.erp import do_ambiente, pelo_porteiro
    if not pelo_porteiro():
        log("este robô só roda no servidor (MC_VIA=porteiro)")
        return 2
    aud = sb_baixar_json()
    alvo = escolher(aud)
    log(f"lançamentos no escopo ({ESCOPO}, {DIAS} dias): {len(alvo)}")
    leitor = LeitorMC(do_ambiente())
    try:
        if DESCOBRIR:
            descobrir(leitor, sorted(alvo, key=lambda i: alvo[i], reverse=True))
            return 0
        itens, est = rodada(leitor, aud, alvo)
        # grava em cima da versão MAIS NOVA (o robô da madrugada pode ter regravado no meio)
        atual = sb_baixar_json()
        atual["anexos"] = {"em": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"),
                           "dias": DIAS, "escopo": ESCOPO, "itens": itens}
        tam = sb_gravar_json(atual)
        com = sum(1 for x in itens.values() if x.get("a"))
        log(f"anexos: {len(itens)} lançamentos ({com} com arquivo) · " + " · ".join(f"{k} {v}" for k, v in est.items())
            + f" · auditoria.json {tam // 1024} KB")
        return 1 if est["erros"] and not com else 0
    finally:
        try:
            leitor.erp.fechar()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
