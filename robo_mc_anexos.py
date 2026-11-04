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
  3. O nº do lançamento do relatório (ex. 21001534) não serve nas rotas da tela, que pedem UUID: o robô
     lista as parcelas a pagar da janela (GET /payable-installments/paginated-result, a lista da tela
     Financeiro › Pagamentos), acha sozinho em que campo da parcela está esse nº e pega dali o UUID do
     lançamento (tradePayable.id) e das baixas. Depois: GET /folder (origem TRADE_PAYABLE = boleto/NF/recibo;
     origem PAID = comprovante da baixa) → arquivos → GET /file/{id}/get-url (link assinado do próprio MC).
     Receita lida no código do site em 03/11; corrigida no mesmo dia pela 1ª descoberta no servidor.
  4. Link do MC que vale 24 h ou mais: usa ele (renovado toda rodada). Link mais curto: copia o arquivo para
     o bucket privado (auditoria/anexos/<lançamento>/...) e assina por 3 dias.
  5. Grava em auditoria.json a chave "anexos" — a tela lê junto com o resto, sem mudar o Apps Script.
     O robô da madrugada (GitHub) preserva essa chave quando regrava a auditoria.

MODOS:
  DESCOBRIR=1  8 páginas da lista e 3 lançamentos; imprime o FORMATO das respostas (chaves, tipo dos ids,
               contagens, validade do link) e o erro de CADA rota tentada — nunca nome, fornecedor, valor ou
               link. Não grava nada. Sai com código 1 (e a causa na última linha) se não ler nenhum lançamento.
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
PAGINAS_DESCOBERTA = int(os.environ.get("ANEXOS_PAGINAS_DESCOBERTA") or 30)


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


RE_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def _tipo_id(v):
    s = str(v or "")
    return "uuid" if RE_UUID.match(s) else ("número" if s.isdigit() else ("vazio" if not s else "texto"))


def _escalares(obj, prefixo="", prof=0, out=None):
    """(caminho, valor) dos campos simples até 3 níveis — para achar onde está o nº do lançamento."""
    out = [] if out is None else out
    if prof > 3:
        return out
    if isinstance(obj, dict):
        for k, v in obj.items():
            c = f"{prefixo}.{k}" if prefixo else k
            if isinstance(v, (dict, list)):
                _escalares(v, c, prof + 1, out)
            elif isinstance(v, (int, str)) and not isinstance(v, bool):
                out.append((c, v))
    elif isinstance(obj, list):
        for v in obj[:3]:
            _escalares(v, prefixo + "[]", prof + 1, out)
    return out


_RE_DATA = re.compile(r"^\d{4}-\d\d-\d\d")


def _num(x):
    try:
        return float(x or 0)
    except (TypeError, ValueError):
        try:
            return float(str(x).replace(".", "").replace(",", "."))
        except ValueError:
            return 0.0


def _data_iso(x):
    """04/11 (3ª descoberta): a data da lista vem como TEXTO — "AAAA-MM-DD…" ou "DD/MM/AAAA…". Sempre AAAA-MM-DD."""
    t = str(x or "").strip()
    m = re.match(r"^(\d{4})-(\d\d)-(\d\d)", t)
    if m:
        return t[:10]
    m = re.match(r"^(\d\d)/(\d\d)/(\d{4})", t)
    return "%s-%s-%s" % (m.group(3), m.group(2), m.group(1)) if m else ""


def _mascara(x):
    """A FORMA de um valor sem o valor: dígitos viram 9 ("2026-10-01" -> "9999-99-99")."""
    return re.sub(r"\d", "9", str(x))[:28] if x not in (None, "") else "vazio"


def _pegar(obj, caminho):
    for parte in caminho.split("."):
        if parte.endswith("[]"):
            parte = parte[:-2]
            obj = (obj or {}).get(parte) if isinstance(obj, dict) else None
            obj = obj[0] if isinstance(obj, list) and obj else None
        else:
            obj = obj.get(parte) if isinstance(obj, dict) else None
    return obj


class LeitorMC:
    """03/11 (2ª versão): o nº do lançamento do relatório (id_lancamento, ex. 21001534) NÃO é o id das rotas da
    tela — elas pedem UUID. Por isso o robô lista as parcelas a pagar da janela (a mesma lista da tela
    Financeiro › Pagamentos, /payable-installments/paginated-result), acha sozinho em qual campo de cada
    parcela está o nº do lançamento e pega dali os UUIDs do lançamento (tradePayable.id) e das baixas."""

    PARAMS_LISTA = [{"dateField": "PLANNED"}, {"dateField": "DATE_OF_PAYMENT"}, {}]
    ROTA_LISTA = "/payable-installments/paginated-result"

    def __init__(self, erp):
        self.erp = erp
        self.chamadas = 0
        self.erros_rota = []           # (rota, erro curto) — a descoberta mostra todos
        self.campo_num = None          # caminho do nº do lançamento dentro da parcela
        self.params_ok = None          # (nome, função página -> params) da forma de pedir a lista que funcionou
        self.tela = None               # parâmetros que a própria tela usou (dict de listas), se o porteiro viu
        self.tentativas = []           # (forma, páginas, do escopo achados) — a descoberta mostra
        self.casar_idx, self.casar_desc = {}, {}   # 04/11: (data, valor) -> {nº do lançamento}; nº -> {descrição, nº doc}
        self.janela = None                         # 04/11: (início, fim) das datas do escopo, ±7 dias
        self.casados = self.ambiguos = 0

    def _get(self, caminho, params=None):
        self.chamadas += 1
        time.sleep(0.12)
        return self.erp.pedir("GET", caminho, params=params)

    def _erro(self, rota, e):
        self.erros_rota.append((rota, f"{type(e).__name__}: {str(e)[:320]}"))

    # ---- 0) 04/11 (3ª descoberta): a lista da tela NÃO traz o nº do lançamento (só UUIDs: id, tradePayableId).
    #         O robô casa cada parcela da lista com o pagamento da auditoria pela DATA (prevista ou de pagamento) e
    #         pelo VALOR; se der mais de um, desempata pela descrição / nº do documento. Ambíguo fica de fora.
    def preparar_casamento(self, aud, alvo):
        c = aud.get("cols") or {}
        ids = c.get("id") or []
        col = lambda nome: c.get(nome) or [None] * len(ids)                     # noqa: E731
        dv, dp, v, vp, d, nd = col("dv"), col("dp"), col("v"), col("vp"), col("d"), col("nd")
        idx, desc = {}, {}
        for i, idl in enumerate(ids):
            try:
                idl = int(idl)
            except (TypeError, ValueError):
                continue
            if idl not in alvo:
                continue
            for data in {_data_iso(dv[i]), _data_iso(dp[i])} - {""}:
                for val in {round(_num(vp[i]), 2), round(_num(v[i]), 2)} - {0.0}:
                    idx.setdefault((data, val), set()).add(idl)
            desc.setdefault(idl, set()).update({N(d[i]), N(nd[i])} - {""})
        self.casar_idx, self.casar_desc = idx, desc
        # 04/11 (3ª descoberta): a lista vem em ordem de data, e a janela larga (210 dias) gastava as páginas da
        # descoberta com parcelas mais velhas que o escopo — agora a janela é a das datas do escopo (±7 dias)
        datas = sorted(d for d, _v in idx)
        if datas:
            ini = dt.date.fromisoformat(datas[0]) - dt.timedelta(days=7)
            fim = dt.date.fromisoformat(datas[-1]) + dt.timedelta(days=7)
            self.janela = (ini.isoformat(), fim.isoformat())
        return len(idx)

    def _casar(self, it):
        datas = {_data_iso(it.get(k)) for k in ("plannedDate", "dateOfPayment")} - {""}
        pago, resto = _num(it.get("sumOfPaidValues")), _num(it.get("remainingValue"))
        vals = {round(pago, 2), round(pago + resto, 2)} - {0.0}
        for b in (it.get("filteredPaids") or it.get("paids") or []):
            if isinstance(b, dict):
                bd = _data_iso(b.get("payingDate") or b.get("dateOfPayment") or b.get("date") or b.get("paymentDate"))
                bv = _num(b.get("paidValue") or b.get("value"))
                if bd:
                    datas.add(bd)
                if bv:
                    vals.add(round(bv, 2))
        cands = set()
        for data in datas:
            for val in vals:
                cands |= self.casar_idx.get((data, val), set())
        if len(cands) > 1:
            txt = {N(it.get("description")), N(it.get("documentNumber"))} - {""}
            so = {x for x in cands if self.casar_desc.get(x, set()) & txt}
            if len(so) == 1:
                cands = so
        return cands

    # ---- 1) lista de parcelas a pagar -> {nº do lançamento: {"tp": uuid, "parcelas": [...], "baixas": [...]}}
    def params_da_tela(self):
        """03/11 (2ª descoberta): sem centro de custo o MC recusa a lista ("O centro de custo deve ser
        especificado"). A aba do porteiro abre justamente Financeiro › Pagamentos, que pede essa lista com os
        filtros dela — o robô copia esses parâmetros (centro de custo incluso) e só troca a janela e a página."""
        if self.tela is None:
            f = getattr(self.erp, "pedido_da_tela", None)
            url = None
            try:
                url = f("payable-installments/paginated-result") if f else None
            except Exception as e:
                self._erro("pedido da tela (porteiro)", e)
            self.tela = parse_qs(urlparse(url).query, keep_blank_values=True) if url else {}
        return self.tela

    def _da_tela(self, base, pagina, troca=None, sem=()):
        q = {k: list(v) for k, v in base.items() if k not in sem}
        datas = [k for k, v in q.items() if v and _RE_DATA.match(str(v[0]))]
        ini, fim = self.janela or ((HOJE - dt.timedelta(days=DIAS + 120)).isoformat(),
                                                     (HOJE + dt.timedelta(days=30)).isoformat())
        for i, k in enumerate(datas):
            n = k.lower()
            eh_fim = any(x in n for x in ("end", "final", "fim", "until", "to")) and not any(x in n for x in ("start", "begin", "init", "from"))
            eh_fim = eh_fim or (i == 1 and not any(x in n for x in ("start", "begin", "init", "from")))
            orig = str(q[k][0])
            q[k] = [(fim if eh_fim else ini) + orig[10:]]          # mesmo formato (com hora, se a tela mandou)
        chave_pag = next((k for k in q if k.lower() in ("page", "pagenumber", "pagina")), "page")
        chave_tam = next((k for k in q if k.lower() in ("size", "pagesize", "limit", "tamanho")), "size")
        q[chave_pag], q[chave_tam] = [str(pagina)], ["100"]
        for k, v in (troca or {}).items():
            q[k] = [v]
        return q

    def formato_da_tela(self):
        """Nome de cada parâmetro da tela e a FORMA do valor (nunca o valor, menos as palavras-código)."""
        out = {}
        for k, v in (self.tela or {}).items():
            x = str(v[0]) if v else ""
            forma = ("data" if _RE_DATA.match(x) else "uuid" if re.match(r"^[0-9a-f-]{32,36}$", x, re.I) else
                     "número" if x.isdigit() else x if re.match(r"^[A-Z_]{1,30}$", x) else
                     "vazio" if not x else "texto")
            out[k] = forma + ("×%d" % len(v) if len(v) > 1 else "")
        return out

    def formas(self):
        """Formas de pedir a lista, da mais provável para a menos: a da tela (por data de pagamento, como
        veio, e sem filtro de situação) e, por último, as antigas (sem centro de custo — o MC costuma recusar)."""
        out, tela = [], self.params_da_tela()
        if tela:
            campo_data = next((k for k in tela if k.lower() == "datefield"), None)
            situacao = tuple(k for k in tela if any(x in k.lower() for x in ("status", "situation", "situacao")))
            if campo_data and tela[campo_data][:1] != ["DATE_OF_PAYMENT"]:
                out.append(("da tela, por data de pagamento", lambda pg, t=tela, c=campo_data: self._da_tela(t, pg, {c: "DATE_OF_PAYMENT"})))
            out.append(("da tela", lambda pg, t=tela: self._da_tela(t, pg)))
            if situacao:
                out.append(("da tela, sem filtro de situação", lambda pg, t=tela, s_=situacao: self._da_tela(t, pg, None, s_)))
        for base in self.PARAMS_LISTA:
            out.append((str(base or "sem dateField"), lambda pg, b=base: dict(
                b, page=pg, size=100, type="ALL", tradePayableType="ALL",
                startDate=(HOJE - dt.timedelta(days=DIAS + 120)).isoformat(),
                endDate=(HOJE + dt.timedelta(days=30)).isoformat())))
        return out

    def _pagina(self, forma, pagina):
        r = self._get(self.ROTA_LISTA, forma[1](pagina))
        itens = _lista(r)
        mais = bool(isinstance(r, dict) and (r.get("hasNextPage") or (r.get("last") is False)))
        return itens, mais, r

    def mapear(self, alvo, max_paginas=200):
        """Tenta as formas em ordem; fica com a 1ª que acha lançamentos do escopo (ou, se nenhuma achar, devolve
        o mapa vazio e a 1ª resposta que veio — a descoberta mostra o formato dela)."""
        primeira = None
        formas = [self.params_ok] if self.params_ok is not None else self.formas()
        for forma in formas:
            try:
                itens, mais, r0 = self._pagina(forma, 0)
            except Exception as e:
                self._erro("%s %s" % (self.ROTA_LISTA, forma[0]), e)
                continue
            primeira = r0 if primeira is None else primeira
            mapa, paginas = self._varrer(forma, alvo, itens, mais, max_paginas)
            self.tentativas.append((forma[0], paginas, len(mapa)))
            if mapa:
                self.params_ok = forma
                return mapa, r0
        return {}, primeira

    def _varrer(self, forma, alvo, itens, mais, max_paginas):
        alvo_txt = {str(x) for x in alvo}
        mapa = {}
        pagina = 0
        while True:
            for it in itens:
                if self.campo_num is None:
                    for c, v in _escalares(it):
                        if str(v) in alvo_txt:
                            self.campo_num = c
                            break
                if self.campo_num is not None:
                    num = str(_pegar(it, self.campo_num) or "")
                    if num not in alvo_txt:
                        continue
                elif self.casar_idx:                      # sem o nº na lista: casa por data e valor
                    cands = self._casar(it)
                    if len(cands) != 1:
                        self.ambiguos += len(cands) > 1
                        continue
                    num = str(next(iter(cands)))
                    self.casados += 1
                else:
                    continue
                tp = it.get("tradePayable") if isinstance(it.get("tradePayable"), dict) else {}
                tp_id = tp.get("id") or it.get("tradePayableId")
                reg = mapa.setdefault(int(num), {"tp": tp_id, "parcelas": [], "baixas": []})
                reg["tp"] = reg["tp"] or tp_id
                if it.get("id"):
                    reg["parcelas"].append(it["id"])
                b = []
                _baixas(it, b)
                reg["baixas"] += [x["id"] for x in b if x.get("id") not in reg["baixas"]]
            pagina += 1
            if not mais or pagina >= max_paginas:
                break
            try:
                itens, mais, _ = self._pagina(forma, pagina)
            except Exception as e:
                self._erro("%s %s página %d" % (self.ROTA_LISTA, forma[0], pagina), e)
                break
        return mapa, pagina

    # ---- 2) pastas e arquivos
    def pastas(self, origem, rotina_id):
        try:
            return _lista(self._get("/folder", {"id": rotina_id, "origin": origem}))
        except Exception as e:
            self._erro("/folder origin=%s" % origem, e)
            return []

    def arquivos_da_pasta(self, pasta):
        arqs = _lista(pasta.get("files")) if isinstance(pasta, dict) else []
        if not arqs and isinstance(pasta, dict) and pasta.get("id"):
            try:
                arqs = _lista((self._get("/folder/%s" % pasta["id"]) or {}).get("files"))
            except Exception as e:
                self._erro("/folder/{id}", e)
                arqs = []
        return [a for a in arqs if isinstance(a, dict) and a.get("id") and a.get("temporary") is not True]

    def link(self, arq_id):
        return _url_de(self._get("/file/%s/get-url" % arq_id))

    def anexos(self, idl, info):
        """[(origem, arquivo)] do lançamento e das baixas dele. `info` vem de mapear()."""
        if not info or not (info.get("tp") or info.get("parcelas")):
            raise RuntimeError("lançamento não achado na lista de pagamentos do MC")
        baixas = list(info.get("baixas") or [])
        tp = info.get("tp")
        if not baixas or not tp:                      # a lista não trouxe: abre a parcela (UUID)
            for pid in (info.get("parcelas") or [])[:6]:
                try:
                    ov = self._get("/payable-installments/%s/overview" % pid) or {}
                except Exception as e:
                    self._erro("/payable-installments/{uuid}/overview", e)
                    continue
                tpo = ov.get("tradePayableOverview") or ov.get("tradePayable") or {}
                tp = tp or tpo.get("id")
                b = []
                _baixas(ov, b)
                baixas += [x["id"] for x in b if x.get("id") not in baixas]
        rotinas = ([("TRADE_PAYABLE", tp)] if tp else []) + [("PAID", b) for b in baixas]
        vistos, out = set(), []
        for origem, rid in rotinas:
            for p in self.pastas(origem, rid):
                for a in self.arquivos_da_pasta(p):
                    if a["id"] in vistos:
                        continue
                    vistos.add(a["id"])
                    out.append((origem, a))
        return out, tp, baixas


# ----------------------------------------------------------------- descoberta
def chaves(obj, n=40):
    return sorted(obj.keys())[:n] if isinstance(obj, dict) else type(obj).__name__


def descobrir(leitor, alvo):
    """Só formato. Devolve 0 se leu ao menos um lançamento; 1 com a causa na última linha."""
    log("DESCOBRIR: só formato, nada gravado")
    leitor.params_da_tela()
    log(f"pedido da lista feito pela tela do porteiro: {leitor.formato_da_tela() or 'NÃO VISTO (a tela não pediu a lista em 20 s)'}")
    log(f"janela pedida ao MC: {leitor.janela or 'a larga (sem datas no escopo)'} · chaves data+valor do escopo: {len(leitor.casar_idx or {})}")
    mapa, primeira = leitor.mapear(alvo, max_paginas=PAGINAS_DESCOBERTA)
    for nome, pags, achados in leitor.tentativas:
        log(f"  forma '{nome}': {pags} página(s) lida(s), {achados} lançamento(s) do escopo")
    if primeira is not None:
        itens = _lista(primeira)
        log(f"lista de pagamentos: forma {leitor.params_ok[0] if leitor.params_ok else 'nenhuma achou o escopo'} · chaves da resposta: {chaves(primeira)} · itens na 1ª página: {len(itens)}")
        if itens:
            it = itens[0]
            log(f"  chaves da parcela: {chaves(it)}")
            log(f"  tipo do id da parcela: {_tipo_id(it.get('id'))} · tradePayable: {chaves(it.get('tradePayable'), 30)}")
            log(f"  tipo do tradePayable.id: {_tipo_id((it.get('tradePayable') or {}).get('id'))} · tipo do tradePayableId: {_tipo_id(it.get('tradePayableId'))}")
            log(f"  forma das datas/valores: plannedDate {_tipo_id(it.get('plannedDate'))} · dateOfPayment {_tipo_id(it.get('dateOfPayment'))} · sumOfPaidValues {_tipo_id(it.get('sumOfPaidValues'))} · paids {len(it.get('filteredPaids') or it.get('paids') or [])}")
            pg = (it.get("filteredPaids") or it.get("paids") or [None])[0]
            log(f"  máscara (dígito = 9): plannedDate {_mascara(it.get('plannedDate'))} · dateOfPayment {_mascara(it.get('dateOfPayment'))} · "
                f"sumOfPaidValues {_mascara(it.get('sumOfPaidValues'))} · remainingValue {_mascara(it.get('remainingValue'))}")
            if isinstance(pg, dict):
                log(f"  chaves da baixa: {chaves(pg, 30)} · máscaras: " + ", ".join(
                    f"{k} {_mascara(pg.get(k))}" for k in ("payingDate", "dateOfPayment", "date", "paymentDate", "paidValue", "value") if k in pg))
            ult = _lista(primeira)[-1]
            log(f"  1ª página vai de {_data_iso(it.get('plannedDate')) or '?'} a {_data_iso(ult.get('plannedDate')) or '?'} (plannedDate)")
            nums = [c for c, v in _escalares(it) if _tipo_id(v) == "número" and 5 <= len(str(v)) <= 10]
            log(f"  campos com número de 5 a 10 dígitos: {nums[:15]}")
    log(f"campo com o nº do lançamento: {leitor.campo_num or 'não vem na lista — casado por data e valor'} · "
        f"casados: {leitor.casados} · ambíguos (ficaram de fora): {leitor.ambiguos} · lançamentos do escopo achados ({PAGINAS_DESCOBERTA} páginas no máx.): {len(mapa)}")
    lidos = 0
    for idl in sorted(mapa, key=lambda i: alvo.get(i, ""), reverse=True)[:3]:
        log(f"— lançamento …{str(idl)[-4:]}")
        try:
            arqs, tp, baixas = leitor.anexos(idl, mapa[idl])
            lidos += 1
        except Exception as e:
            log(f"  ERRO {type(e).__name__}: {str(e)[:160]}")
            continue
        log(f"  tradePayable: {_tipo_id(tp)} · baixas: {len(baixas)} · arquivos: {len(arqs)} · por origem: "
            f"{dict((o, sum(1 for x, _ in arqs if x == o)) for o in {x for x, _ in arqs})}")
        if arqs:
            a = arqs[0][1]
            log(f"  chaves do arquivo: {chaves(a)} · tipo: {a.get('type') or a.get('mimeType')}")
            try:
                u = leitor.link(a["id"])
                log(f"  get-url: {'link ok' if u else 'SEM LINK'} · host: {urlparse(u).netloc if u else '-'} · validade: {validade_s(u) if u else '-'} s")
            except Exception as e:
                log(f"  get-url: ERRO {type(e).__name__}: {str(e)[:160]}")
    if leitor.erros_rota:
        log("erros por rota (todos):")
        for r, e in leitor.erros_rota:
            log(f"  {r}: {e}")
    log(f"chamadas ao MC: {leitor.chamadas}")
    if not lidos:
        causa = ("a lista de pagamentos do MC não respondeu" if primeira is None else
                 "nenhuma parcela da lista casou com os pagamentos da auditoria (nem pelo nº nem por data e valor)" if not leitor.campo_num and not mapa else
                 "nenhum lançamento do escopo apareceu na lista do MC" if not mapa else
                 "os lançamentos achados deram erro ao abrir as pastas")
        log(f"FALHOU: nenhum lançamento lido — {causa}.")
        return 1
    log(f"OK: {lidos} lançamento(s) lido(s) na descoberta.")
    return 0


# ----------------------------------------------------------------- rodada
def nome_seguro(s):
    s = unicodedata.normalize("NFD", str(s or "arquivo"))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^A-Za-z0-9._-]+", "_", s).strip("_")
    return (s or "arquivo")[-80:]


def rodada(leitor, aud, alvo):
    ant = (aud.get("anexos") or {}).get("itens") or {}
    mapa, primeira = leitor.mapear(alvo)
    if primeira is None:
        raise RuntimeError("a lista de pagamentos do MC não respondeu")
    if not leitor.campo_num:
        raise RuntimeError("não achei em que campo da lista do MC está o nº do lançamento")
    agora = dt.datetime.now(dt.timezone.utc)
    lim_rechecar = (HOJE - dt.timedelta(days=RECHECAR_DIAS)).isoformat()
    itens, mb, consultados, copiados, erros, renovados = {}, 0.0, 0, 0, 0, 0
    erros_lanc = [0]
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
            if idl not in mapa:
                raise RuntimeError("fora da lista do MC na janela")
            arqs, _, _ = leitor.anexos(idl, mapa[idl])
        except Exception as e:
            erros += 1
            erros_lanc[0] += 1
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
    return itens, {"consultados": consultados, "lidos": consultados - erros_lanc[0], "copiados": copiados, "mb": round(mb, 1),
                   "erros": erros, "renovados": renovados, "apagados": len(apagar), "achados_no_mc": len(mapa),
                   "chamadas": leitor.chamadas}


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
    leitor.preparar_casamento(aud, alvo)
    try:
        if DESCOBRIR:
            return descobrir(leitor, alvo)
        try:
            itens, est = rodada(leitor, aud, alvo)
        except RuntimeError as e:
            log(f"FALHOU: {e}. Nada gravado.")
            return 1
        # grava em cima da versão MAIS NOVA (o robô da madrugada pode ter regravado no meio)
        atual = sb_baixar_json()
        atual["anexos"] = {"em": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"),
                           "dias": DIAS, "escopo": ESCOPO, "itens": itens}
        tam = sb_gravar_json(atual)
        com = sum(1 for x in itens.values() if x.get("a"))
        log(f"anexos: {len(itens)} lançamentos ({com} com arquivo) · " + " · ".join(f"{k} {v}" for k, v in est.items())
            + f" · auditoria.json {tam // 1024} KB")
        if est["consultados"] and not est["lidos"]:
            log(f"FALHOU: nenhum dos {est['consultados']} lançamentos consultados foi lido no MC — veja os erros acima.")
            return 1
        log(f"OK: {est['lidos']} lançamentos lidos no MC, {com} com arquivo.")
        return 0
    finally:
        try:
            leitor.erp.fechar()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
