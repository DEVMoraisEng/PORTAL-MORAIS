#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
robo_mc_medidores.py — PORTAL-MORAIS (04/11/2026) · MEDIDORES COMPRADOS por obra

Quantos MEDIDORES cada obra (centro de custo) já comprou no Mais Controle — alimenta o alerta "MEDIDOR …
COMPRADO" da aba Ligações (ligacoes.html), que lê dist/medidores_mc.json (contrato abaixo, não mudar).

    Medidor de ENERGIA = insumo cuja descrição começa com "PADRÃO DE ENERGIA" (659, 658, 1510…)
    Medidor de ÁGUA    = insumo cuja descrição começa com "HIDROMETRO" (656). NÃO contam "CAIXA DE HIDROMETRO"
                         (654/655) nem "KIT CAVALETE P/ HIDROMETRO" (657): não começam com HIDROMETRO.
    "Comprado" = quantidade em SOLICITAÇÃO DE COMPRA já ATENDIDA ou em ORDEM DE COMPRA para o centro de custo da
                 obra, somando todas (a obra pode comprar uma casa agora e a outra depois). Cancelada não conta.
                 A mesma compra na solicitação atendida e na OC dela conta UMA vez (vale a OC).

Roda NO SERVIDOR pela aba do Chrome do porteiro (MC_VIA=porteiro) — sem login nenhum; porteiro fora = para e
avisa. Só LÊ o Mais Controle (nada é gravado no ERP):
    python servidor\\robo_fila.py --robo medidores
A publicação (dist/medidores_mc.json no repositório, commit "Medidores MC … (servidor) [skip ci]") é do
robo_fila.py, igual às Medições de contratos; aqui o robô só grava o arquivo no clone.

MODOS
  DESCOBRIR=1  não calcula nada: abre as telas de Compras na aba do porteiro, anota QUAIS chamadas a própria tela
               faz (rota e nome dos parâmetros) e o FORMATO das respostas (chaves, contagens, tipos) — nunca nome
               de fornecedor nem valor. Procura a solicitação de exemplo do dono (MEDIDORES_EXEMPLO, padrão 8192)
               e mostra em que campos estão o nº, a situação, o centro de custo, o insumo e a quantidade.
  SIMULAR=1    calcula e imprime o JSON (e as obras de MEDIDORES_CONFERIR), não grava o arquivo.

Contrato da saída (o portal já usa):
  {"ok": true, "updated_at": "ISO UTC", "data_extracao": "AAAA-MM-DD", "fonte": "Mais Controle · solicitações/OC (servidor)",
   "obras": {"TB 21 QD 50 LT 34": {"obra": "...", "energia": {"orcado": 0, "comprado": 2, "insumos": ["659 - ..."]},
                                                  "agua": {"orcado": 0, "comprado": 2, "insumos": ["656 - ..."]}}}}
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
import unicodedata
from urllib.parse import parse_qs, urlparse

SAIDA = os.path.join("dist", "medidores_mc.json")
DESCOBRIR = os.environ.get("DESCOBRIR", "").strip().lower() in ("1", "true", "sim")
SIMULAR = os.environ.get("SIMULAR", "").strip().lower() in ("1", "true", "sim")
EXEMPLO = os.environ.get("MEDIDORES_EXEMPLO", "8192").strip()
CONFERIR = [x.strip() for x in (os.environ.get("MEDIDORES_CONFERIR") or
            "TB 21 QD 50 LT 34;TB 17 QD 49 LT 11;TB 17 QD 49 LT 14").split(";") if x.strip()]

#: telas de Compras que a descoberta abre (hash do AngularJS/React do MC) — a que não existe volta para outra rota
ROTAS_COMPRAS = ["#/purchase-request", "#/purchase-order"]     # 04/11 (1ª descoberta): as duas que existem
#: 04/11 (2ª descoberta): rotas da API que o próprio código da tela (bundle) cita e que valem tentar direto
TENTAR = ["/purchase-request?page=0&size=5", "/purchase-request/paginated-result?page=0&size=5",
          "/purchase-request/search?page=0&size=5", "/purchase-requests?page=0&size=5",
          "/purchase-order?page=0&size=5", "/purchase-order/paginated-result?page=0&size=5",
          "/purchase-order/search?page=0&size=5", "/purchase-orders?page=0&size=5"]
_JS_BUNDLE = """async () => {
  const fontes = [...document.scripts].map(s => s.src).filter(Boolean);
  const achados = {};
  for (const u of fontes) {
    try {
      const t = await (await fetch(u)).text();
      const re = /["'`]([^"'`\\s]{0,60}(purchase|request|requisi|solicita|quotation|order-item|supply)[^"'`\\s]{0,60})["'`]/gi;
      let m; while ((m = re.exec(t)) && Object.keys(achados).length < 400) {
        const v = m[1]; if (v.length < 90 && !/\\s/.test(v)) achados[v] = (achados[v] || 0) + 1;
      }
    } catch (e) {}
  }
  return {fontes: fontes.map(u => u.split('/').pop().slice(0, 60)), achados};
}"""
_JS_BOTOES = """() => [...document.querySelectorAll('button, a.btn, [role=button], th, label')]
  .map(b => (b.innerText || '').trim().replace(/\\s+/g, ' ')).filter(t => t && t.length < 40).slice(0, 80)"""
HOSTS = ("legacy-api.maiscontroleerp.com.br", "prod-erp-api.maiscontroleerp.com.br")
RE_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
#: na descoberta, valores destes campos nunca aparecem (só o tipo)
SENSIVEL = re.compile(r"supplier|fornec|participant|provider|vendor|seller|name|nome|email|phone|document|cpf|cnpj|"
                      r"price|valor|value|total|amount|cost(?!centre|center)|bank|pix|address|endere", re.I)


def log(*a):
    print(*a, flush=True)


def N(s):
    s = unicodedata.normalize("NFD", str(s or ""))
    return " ".join("".join(c for c in s if unicodedata.category(c) != "Mn").upper().split())


def tipo_do_insumo(desc) -> str | None:
    d = N(desc)
    if d.startswith("PADRAO DE ENERGIA"):
        return "energia"
    if d.startswith("HIDROMETRO"):
        return "agua"
    return None


def _host(url: str) -> str:
    return url.split("://", 1)[-1].split("/", 1)[0].lower()


def _caminho(url: str) -> str:
    return "/" + url.split("://", 1)[-1].split("/", 1)[-1].split("?", 1)[0]


def _forma(v) -> str:
    s = str(v if v is not None else "")
    if v is None or s == "":
        return "vazio"
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, (int, float)):
        return "número"
    if RE_UUID.match(s):
        return "uuid"
    if re.match(r"^\d{4}-\d\d-\d\d", s):
        return "data"
    if re.match(r"^[A-Z_]{2,40}$", s):
        return s                                        # palavra-código (situação, tipo) — não é dado de ninguém
    return "texto"


def _lista(x):
    if isinstance(x, list):
        return x
    if isinstance(x, dict):
        for k in ("content", "items", "data", "results", "list"):
            if isinstance(x.get(k), list):
                return x[k]
    return []


def _achatar(obj, prefixo="", prof=0, out=None):
    """(caminho, valor) de todos os campos simples até 4 níveis (listas: só o 1º item, caminho com [])."""
    out = [] if out is None else out
    if prof > 4:
        return out
    if isinstance(obj, dict):
        for k, v in obj.items():
            c = f"{prefixo}.{k}" if prefixo else str(k)
            if isinstance(v, dict):
                _achatar(v, c, prof + 1, out)
            elif isinstance(v, list):
                out.append((c + "[#]", len(v)))
                if v and isinstance(v[0], (dict, list)):
                    _achatar(v[0], c + "[]", prof + 1, out)
            else:
                out.append((c, v))
    return out


def _mostrar(v, caminho: str) -> str:
    """O que a descoberta pode mostrar de um valor: códigos, quantidades, situações, nome de obra (TB/QD/LT) e a
    descrição de insumo de medidor. O resto, só a forma."""
    if SENSIVEL.search(caminho.split(".")[-1]) and not re.search(r"costcent|centrodecusto|work", caminho, re.I):
        return _forma(v)
    s = str(v)
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return s
    if re.match(r"^[A-Z_]{2,40}$", s) or re.match(r"^\d{1,8}$", s):
        return s
    if re.search(r"\b(TB|QD|LT|CS)\s*\d", s.upper()) or tipo_do_insumo(s) or "HIDROMETRO" in N(s):
        return s[:80]
    return _forma(v)


# ---------------------------------------------------------------------------------------------- descoberta
def descobrir() -> int:
    from venda.mc.porteiro import AbaPorteiro, PorteiroErro
    log("DESCOBRIR: só formato, nada gravado")
    try:
        aba = AbaPorteiro.abrir()
    except PorteiroErro as e:
        log(f"FALHOU: {e}")
        return 1
    page = aba._page
    pedidos = []
    respostas = []          # 3ª descoberta (04/11): o corpo das respostas JSON que a tela recebe, de QUALQUER host do MC

    def do_mc(url):
        h = _host(url)
        return h.endswith("maiscontroleerp.com.br") and not re.search(r"\.(js|css|png|svg|jpe?g|gif|woff2?|ico|map)(\?|$)", url)

    def ouvir(req):
        try:
            if do_mc(req.url) and _host(req.url) != "acessar.maiscontroleerp.com.br":
                corpo = ""
                if req.method.upper() != "GET":
                    try:
                        j = json.loads(req.post_data or "")
                        corpo = (" operationName=" + str(j.get("operationName"))) if isinstance(j, dict) and j.get("operationName") else \
                                (" corpo: " + ", ".join(f"{k}={_forma(v) if not isinstance(v, (dict, list)) else type(v).__name__}" for k, v in list(j.items())[:20]) if isinstance(j, dict) else "")
                    except Exception:
                        corpo = " corpo: (não JSON)" if req.post_data else ""
                pedidos.append((req.method.upper(), req.url, corpo))
        except Exception:
            pass

    def ouvir_resp(resp):
        try:
            if not do_mc(resp.url) or _host(resp.url) == "acessar.maiscontroleerp.com.br":
                return
            if "json" not in (resp.headers.get("content-type") or ""):
                return
            if len(respostas) < 40:          # o corpo é lido DEPOIS (fora do ouvinte do Playwright)
                respostas.append((resp.request.method.upper(), resp.url, resp.status, resp))
        except Exception:
            pass
    page.on("request", ouvir)
    page.on("response", ouvir_resp)
    # 4ª descoberta (04/11): a 3ª não viu a lista chegar por nenhuma API do MC — pode vir de worker/service worker
    # (só o CONTEXTO vê), de iframe ou de outro host (Firebase, por exemplo). Anota TUDO que não é arquivo estático.
    todos = []
    ESTATICO = re.compile(r"\.(js|css|png|svg|jpe?g|gif|woff2?|ico|map|html)(\?|$)|google-analytics|googletagmanager|"
                          r"doubleclick|clarity\.ms|satismeter|hotjar|facebook|gstatic|/event$|sentry|intercom", re.I)

    def ouvir_tudo(req):
        try:
            if not ESTATICO.search(req.url) and len(todos) < 600:
                todos.append((req.method.upper(), _host(req.url), _caminho(req.url), req.resource_type))
        except Exception:
            pass
    page.context.on("request", ouvir_tudo)
    # 5ª descoberta (04/11): as listas de Compras vêm do GraphQL no AWS (…execute-api.us-east-1.amazonaws.com/prod/graphql)
    gql = []

    def ouvir_gql(resp):
        try:
            if "execute-api" in resp.url and "/graphql" in resp.url and len(gql) < 30:
                gql.append(resp)
        except Exception:
            pass
    page.context.on("response", ouvir_gql)
    try:
        for rota in ROTAS_COMPRAS:
            n0 = len(pedidos)
            try:
                page.evaluate("h => { location.hash = h }", rota)
                page.wait_for_timeout(9000)
                final = page.evaluate("() => location.hash")
                titulo = page.evaluate("() => (document.querySelector('h1,h2,.page-title,.title,[class*=Title]') || {}).innerText || ''")
            except Exception as e:
                log(f"tela {rota}: ERRO {type(e).__name__}: {str(e)[:120]}")
                continue
            try:                                    # 2ª descoberta: o que a tela mostra e o clique em Pesquisar
                rotulos = page.evaluate(_JS_BOTOES)
                log(f"tela {rota}: botões/colunas: {rotulos}")
                for aba_nome in ("Concluída", "Em andamento", "Carregar mais"):
                    t = page.get_by_text(re.compile("^" + aba_nome), exact=False)
                    if t.count():
                        t.first.click(timeout=4000)
                        page.wait_for_timeout(5000)
                        log(f"tela {rota}: cliquei em {aba_nome}")
                for nome in ("Pesquisar", "Buscar", "Filtrar", "Consultar", "Aplicar"):
                    b = page.get_by_role("button", name=nome)
                    if b.count():
                        b.first.click(timeout=4000)
                        page.wait_for_timeout(6000)
                        log(f"tela {rota}: cliquei em {nome}")
                        break
            except Exception as e:
                log(f"tela {rota}: botões: {type(e).__name__}: {str(e)[:100]}")
            novos = pedidos[n0:]
            try:
                log(f"tela {rota}: frames: {[ (f.url or '')[:90] for f in page.frames ][:8]}")
            except Exception:
                pass
            vistos_t = sorted({x for x in todos})
            log(f"tela {rota}: TUDO que o navegador pediu até aqui (sem estáticos), {len(vistos_t)} rota(s):")
            for m, h, c, t in vistos_t:
                log(f"     {m} {h} {c} ({t})")
            todos.clear()
            log(f"tela {rota} → ficou em {final!r} · título {str(titulo).strip()[:50]!r} · {len(novos)} chamada(s) às APIs")
            vistos = set()
            for metodo, url, corpo in novos:
                chave = (metodo, _host(url), _caminho(url))
                if chave in vistos:
                    continue
                vistos.add(chave)
                q = parse_qs(urlparse(url).query, keep_blank_values=True)
                log(f"   {metodo} {_host(url)} {_caminho(url)}  parâmetros: "
                    + ", ".join(f"{k}={_forma(v[0]) if v else ''}" for k, v in sorted(q.items())) + corpo)
        # 2ª descoberta: as rotas que o código da tela cita (só texto de rota; nenhum dado)
        try:
            b = page.evaluate(_JS_BUNDLE)
            log(f"bundles da tela: {b.get('fontes')}")
            ach = b.get("achados") or {}
            rotas = sorted(k for k in ach if re.search(r"^/|^[a-z][\w-]*(/[\w{}:.-]*)*$", k) and len(k) < 80)
            log(f"rotas/recursos citados no código ({len(rotas)}):")
            for k in rotas[:250]:
                log("   " + k)
        except Exception as e:
            log(f"bundles: {type(e).__name__}: {str(e)[:120]}")
        from venda.mc.erp import LEGACY
        cab = aba.cabecalhos(HOSTS[0])
        for cam in TENTAR:
            url = LEGACY + cam
            st, texto = aba.fetch("GET", url, cab)
            extra = ""
            if st < 300:
                try:
                    j = json.loads(texto)
                    its = _lista(j)
                    extra = f" · chaves {sorted(j.keys())[:20] if isinstance(j, dict) else 'lista'} · itens {len(its)}"
                    if its and isinstance(its[0], dict):
                        extra += " · 1º item: " + ", ".join(f"{c}={_forma(v) if not c.endswith('[#]') else v}" for c, v in _achatar(its[0])[:50])
                    pedidos.append(("GET", url, ""))
                except ValueError:
                    extra = " · (não é JSON)"
            else:
                extra = " · " + texto[:120].replace("\n", " ")
            log(f"tentativa GET legacy {cam.split('?')[0]} → HTTP {st}{extra}")
        # 5ª descoberta: o GraphQL de Compras — operação, a CONSULTA (é o formato, não dado), variáveis (só a forma),
        # nome dos cabeçalhos (nunca o valor) e o formato da resposta, com a solicitação de exemplo
        log(f"GraphQL: {len(gql)} resposta(s)")
        for resp in gql:
            try:
                req = resp.request
                corpo = json.loads(req.post_data or "{}")
            except Exception:
                corpo = {}
            ops = corpo if isinstance(corpo, list) else [corpo]
            for op in ops:
                if not isinstance(op, dict):
                    continue
                q = re.sub(r"\s+", " ", str(op.get("query") or ""))
                log(f"— GraphQL {_host(resp.url).split('.')[0]} operação {op.get('operationName')!r} → HTTP {resp.status}")
                log(f"   cabeçalhos do pedido: {sorted(k for k in (req.headers or {}) if not k.startswith(':'))}")
                log(f"   consulta: {q[:1800]}")
                vs = op.get("variables") or {}
                log("   variáveis: " + ", ".join(f"{c}={_forma(v) if not c.endswith('[#]') else v}" for c, v in _achatar(vs)[:40]))
            try:
                j = resp.json()
            except Exception as e:
                log(f"   resposta ilegível ({type(e).__name__})")
                continue
            dados = (j or {}).get("data") if isinstance(j, dict) else None
            if isinstance(j, dict) and j.get("errors"):
                log(f"   errors: {str(j.get('errors'))[:300]}")
            for nome, v in (dados or {}).items():
                its = _lista(v) if isinstance(v, (dict, list)) else []
                if isinstance(v, dict) and not its:
                    its = next((x for x in v.values() if isinstance(x, list)), [])
                log(f"   data.{nome}: {sorted(v.keys())[:20] if isinstance(v, dict) else type(v).__name__} · itens {len(its)}")
                if its and isinstance(its[0], dict):
                    log("   campos do 1º item: " + ", ".join(f"{c}={_forma(x) if not c.endswith('[#]') else x}" for c, x in _achatar(its[0])[:80]))
                    ex = next((it for it in its if EXEMPLO and any(str(x) == EXEMPLO for _c, x in _achatar(it))), None)
                    if ex is not None:
                        log(f"   ★ {EXEMPLO} nesta resposta:")
                        for c, x in _achatar(ex):
                            log(f"      {c} = {x if c.endswith('[#]') else _mostrar(x, c)}")
        # 3ª descoberta: o que as telas RECEBERAM (qualquer host do MC), com a solicitação de exemplo
        log(f"respostas JSON recebidas pelas telas: {len(respostas)}")
        for metodo, url, st, resp in respostas:
            try:
                j = resp.json()
            except Exception as e:
                log(f"— {metodo} {_host(url)} {_caminho(url)} → HTTP {st} · corpo ilegível ({type(e).__name__})")
                continue
            itens = _lista(j) if not (isinstance(j, dict) and isinstance(j.get("data"), dict)) else \
                next((v for v in (j["data"] or {}).values() if isinstance(v, (list, dict))), [])
            itens = _lista(itens) if isinstance(itens, dict) else itens
            log(f"— {metodo} {_host(url)} {_caminho(url)} → HTTP {st} · chaves {sorted(j.keys())[:15] if isinstance(j, dict) else 'lista'} · itens {len(itens) if isinstance(itens, list) else '-'}")
            if isinstance(itens, list) and itens and isinstance(itens[0], dict):
                log("   campos do 1º item: " + ", ".join(f"{c}={_forma(v) if not c.endswith('[#]') else v}" for c, v in _achatar(itens[0])[:70]))
                ex = next((it for it in itens if EXEMPLO and any(str(v) == EXEMPLO for _c, v in _achatar(it))), None)
                if ex is not None:
                    log(f"   ★ {EXEMPLO} nesta resposta:")
                    for c, v in _achatar(ex):
                        log(f"      {c} = {v if c.endswith('[#]') else _mostrar(v, c)}")
        # as listas das telas de compras: formato da resposta e a solicitação de exemplo
        candidatos, feitos = [], set()
        for metodo, url, _corpo in pedidos:
            c = _caminho(url)
            if metodo != "GET" or not re.search(r"purchase|request|requisi|order|compra|solicit", c, re.I):
                continue
            if (c, _host(url)) in feitos:
                continue
            feitos.add((c, _host(url)))
            candidatos.append(url)
        log(f"listas candidatas: {len(candidatos)}")
        for url in candidatos[:12]:
            cab = aba.cabecalhos(_host(url))
            st, texto = aba.fetch("GET", url, cab)
            log(f"— GET {_host(url).split('.')[0]} {_caminho(url)} → HTTP {st}")
            if st >= 300:
                log(f"   recusa: {texto[:200]}")
                continue
            try:
                j = json.loads(texto)
            except ValueError:
                log("   (não é JSON)")
                continue
            itens = _lista(j)
            log(f"   chaves da resposta: {sorted(j.keys())[:30] if isinstance(j, dict) else type(j).__name__} · itens: {len(itens)}")
            if itens and isinstance(itens[0], dict):
                log("   campos do 1º item: " + ", ".join(f"{c}={_forma(v) if not c.endswith('[#]') else v}" for c, v in _achatar(itens[0])[:60]))
                ex = next((it for it in itens if EXEMPLO and any(str(v) == EXEMPLO for _c, v in _achatar(it))), None)
                if ex is not None:
                    log(f"   ★ solicitação/OC {EXEMPLO} nesta lista:")
                    for c, v in _achatar(ex):
                        log(f"      {c} = {v if c.endswith('[#]') else _mostrar(v, c)}")
                    iid = ex.get("id")
                    if iid:
                        base = url.split("?", 1)[0].rstrip("/")
                        for det in (f"{base}/{iid}", re.sub(r"/(paginated-result|paginated|list|search)$", "", base) + f"/{iid}"):
                            st2, t2 = aba.fetch("GET", det, cab)
                            log(f"   detalhe {_caminho(det)} → HTTP {st2}")
                            if st2 < 300:
                                try:
                                    for c, v in _achatar(json.loads(t2)):
                                        log(f"      {c} = {v if c.endswith('[#]') else _mostrar(v, c)}")
                                except ValueError:
                                    pass
                                break
                else:
                    log(f"   (a {EXEMPLO} não está nesta página)")
    finally:
        aba.fechar()
    log("FIM da descoberta — mande o resultado para o chat.")
    return 0


# ----------------------------------------------------------------------------------------------- cálculo
def somar(compras) -> dict:
    """compras = [(obra, insumo_codigo, insumo_descricao, quantidade)] já filtradas (atendidas / OC, sem canceladas
    e sem repetir a mesma compra). Devolve o dicionário "obras" do contrato."""
    saida = {}
    for obra, cod, desc, qtd in compras:
        tp = tipo_do_insumo(desc)
        if not tp or not obra:
            continue
        o = saida.setdefault(obra, {"obra": obra})
        t = o.setdefault(tp, {"orcado": 0, "comprado": 0, "insumos": []})
        try:
            t["comprado"] += float(qtd or 0)
        except (TypeError, ValueError):
            continue
        t["insumos"].append(("%s - %s" % (cod, desc)) if cod else str(desc))
    for o in saida.values():
        for tp in ("energia", "agua"):
            if tp in o:
                o[tp]["comprado"] = int(round(o[tp]["comprado"]))
                o[tp]["insumos"] = sorted(set(o[tp]["insumos"]))
    return {k: v for k, v in saida.items()
            if (v.get("energia") or {}).get("comprado") or (v.get("agua") or {}).get("comprado")}


def documento(obras: dict, hoje: dt.date | None = None) -> dict:
    return {"ok": True, "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "data_extracao": (hoje or dt.date.today()).isoformat(),
            "fonte": "Mais Controle · solicitações/OC (servidor)", "obras": obras}


def main() -> int:
    if DESCOBRIR:
        return descobrir()
    log("FALHOU: a leitura das solicitações/OC ainda não está pronta — rode a descoberta (DESCOBRIR=1) e mande o "
        "resultado para o chat.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
