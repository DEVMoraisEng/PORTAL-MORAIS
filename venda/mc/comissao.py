# -*- coding: utf-8 -*-
"""Comissão do corretor do condomínio lançada pelo portal (spec aprovada em 24/11/2026).

O portal pede pela fila do servidor (mc-venda, acao "comissao"); este robô lê a linha da BANCO DE DADOS VENDAS
CONDOMÍNIO, monta UM título A PAGAR (à vista ou Parcelado) para o corretor (ou a imobiliária dele), com o recibo
de cada parcela anexado, e escreve a prévia/resultado em MC - COMISSÃO. Grava só com --aplicar (as 3 chaves da
fila) E o carimbo [#hash] da prévia vista. Repositório público: nenhum dado real aqui nem nos testes.

Regras puras no começo; `processar` (Notion + ERP) e `main` (CLI da fila) no fim.
    python -m venda.mc.comissao --page <id> --parcelas V@D;V@D [--favorecido <id>] [--aplicar|--bloqueado]
    python -m venda.mc.comissao --page <id> --marcar-erro "texto"
O stdout (log do servidor) leva só situação, código e avisos — nunca nome nem valor.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import os
import re
import sys

from . import condominio as C
from . import regras as R
from .distrato import QUEM_PAGA
from .erp import ErpErro, do_ambiente, faltam_segredos
from .recibo_pdf import recibo

COL_ESTADO = "MC - COMISSÃO"
MAX_PARCELAS = 6
_RE_PARC = re.compile(r"^(\d{1,7}(?:\.\d{1,2})?)@(\d{4}-\d{2}-\d{2})$")


class Recusa(Exception):
    def __init__(self, codigo: str, texto: str):
        super().__init__(texto)
        self.codigo, self.texto = codigo, texto


def ler_parcelas(texto: str, hoje: str) -> list[dict]:
    itens = [x for x in str(texto or "").split(";") if x.strip()]
    if not itens or len(itens) > MAX_PARCELAS:
        raise Recusa("PARCELAS_INVALIDAS", "informe de 1 a %d parcelas" % MAX_PARCELAS)
    base = _dt.date.fromisoformat(hoje)
    out = []
    for x in itens:
        m = _RE_PARC.match(x.strip())
        if not m:
            raise Recusa("PARCELAS_INVALIDAS", "parcela ilegível: %s" % x.strip()[:40])
        v, d = round(float(m.group(1)), 2), m.group(2)
        try:
            dd = _dt.date.fromisoformat(d)
        except ValueError:
            raise Recusa("PARCELAS_INVALIDAS", "data inválida: %s" % d)
        if v <= 0:
            raise Recusa("PARCELAS_INVALIDAS", "parcela tem de ser maior que zero")
        if not (base - _dt.timedelta(days=30) <= dd <= base + _dt.timedelta(days=400)):
            raise Recusa("PARCELAS_INVALIDAS", "vencimento fora do prazo aceito: %s" % d)
        out.append({"valor": v, "data": d})
    return out


def conferir_saldo(parcelas: list[dict], comissao: float, ja_lancado: float) -> float:
    if not comissao or comissao <= 0:
        raise Recusa("SEM_COMISSAO", "a venda não tem comissão (coluna COMISSÃO vazia ou venda direta)")
    if (ja_lancado or 0.0) < 0:
        raise Recusa("JA_LANCADO_INVALIDO", "valor já lançado inválido (negativo)")
    saldo = round(comissao - (ja_lancado or 0.0), 2)
    pedido = round(sum(p["valor"] for p in parcelas), 2)
    if pedido > saldo + 0.005:
        raise Recusa("ACIMA_DO_SALDO", "parcelas somam %s e o saldo da comissão é %s" % (reais(pedido), reais(saldo)))
    return saldo


def reais(v: float) -> str:
    s = "%.2f" % v
    i, c = s.split(".")
    return "R$ " + "{:,}".format(int(i)).replace(",", ".") + "," + c


def descricao(unidade: int, cliente: str) -> str:
    return ("COMISSÃO CORRETOR UNIDADE %02d - %s" % (unidade, " ".join(str(cliente or "").upper().split())))[:150]


def observacao(pix: str, corretor: str, comissao: float, parcelas: list[dict]) -> str:
    """`pix` já vem como "<tipo>: <chave>" (ex.: "CNPJ: 00000000000191")."""
    vals = {p["valor"] for p in parcelas}
    ps = ("%d x %s" % (len(parcelas), reais(parcelas[0]["valor"]))) if len(vals) == 1 else         " + ".join(reais(p["valor"]) for p in parcelas)
    return "PIX %s. Corretor %s. Comissão total %s em %s." % (
        pix, " ".join(str(corretor or "").upper().split()), reais(comissao), ps)


def nome_recibo(unidade: int, parcela: dict, i: int, n: int) -> str:
    d = parcela["data"]
    data = "%s-%s-%s" % (d[8:10], d[5:7], d[0:4])
    valor = ("%.2f" % parcela["valor"]).replace(".", ",")
    meio = (" PARCELA %d-%d" % (i, n)) if n > 1 else ""
    return "%s - COMISSAO UNIDADE %02d%s - %s.pdf" % (valor, unidade, meio, data)


def corpo_titulo(parcelas, descricao_, obs, participante_id, categoria_id, forma_id, conta, work, condicao,
                 responsavel_id, hoje) -> dict:
    total = round(sum(p["valor"] for p in parcelas), 2)
    n = len(parcelas)
    tipo = condicao.get("type")
    if tipo and tipo != ("FINANCING" if n > 1 else "IN_CASH"):
        raise ValueError("condição de pagamento não bate com o número de parcelas")
    corpo = {
        "paymentCondition": {"id": condicao["id"], "type": "FINANCING" if n > 1 else "IN_CASH",
                             "financing": n > 1, "recurring": False},
        "installments": [{"plannedDate": p["data"], "plannedValue": p["valor"], "markedAsPaid": False, "order": i}
                         for i, p in enumerate(parcelas)],
        "numberOfInstallments": n,
        "value": total,
        "description": descricao_,
        "comment": obs,
        "participant": {"id": participante_id},
        "referenceDate": parcelas[0]["data"],
        "date": hoje + "T00:00:00",
        "category": {"id": categoria_id},
        "whoPays": work.get("defaultWhoPays") or QUEM_PAGA,
        "costCentreType": "WORK",
        "costCentreDetails": [{"value": total, "percentage": 100,
                               "work": {"id": work["id"], "name": work.get("name"),
                                        "status": work.get("status") or "IN_PROGRESS"}}],
        "paymentMethod": {"id": forma_id},
        "numberPrecision": 2,
        "markedAsPaid": False,
        "account": {"id": conta["id"], "name": conta.get("name")},
        "freightageValue": 0, "otherValue": 0, "ipiValue": 0, "discountValue": 0,
    }
    if n > 1:
        corpo["numberOfFinancingInstallments"] = n
    if responsavel_id:
        corpo["responsible"] = {"id": responsavel_id}
    return corpo


def assinatura(plano: dict) -> str:
    chave = json.dumps({k: plano.get(k) for k in ("parcelas", "favorecido_id", "comissao", "ja_lancado", "pix",
                                               "conta_id", "descricao")},
                       sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(chave.encode("utf-8")).hexdigest()[:8]


def assinatura_do_texto(texto) -> str | None:
    m = re.search(r"\[#([0-9a-f]{8})\]", str(texto or ""))
    return m.group(1) if m else None


# ----------------------------------------------------------------- Tarefa 3: robô (Notion + ERP)

CATEGORIA = "Comissão Venda de Casa"
FORMA = "Pix"
TITULO_RECIBO = "RECIBO DE COMISSÃO DE CORRETAGEM"
LIMITE_COLUNA = 1900          # Notion.gravar_textos corta em 1900; acima disso, gravar_texto_longo
PEDACO_DIAS = 92              # payable-installments: a janela da venda vai em pedaços de no máximo 92 dias
TAMANHO_PAGINA = 200          # página cheia (= 200) pede a próxima; menos que isso = acabou
MAX_PAGINAS = 50              # num pedaço: mais que isso = lista incompleta, recusa
_RE_LANCADA = re.compile(r"^LANÇADA \| título (\S+) \| R\$ ([\d.]+,\d{2})")
_RE_INCERTO = re.compile(r"^INCERTO \| .* \| datas ([\d,\-]+) \| R\$ [\d.]+,\d{2} \|")
_PREFIXOS_HIST = ("LANÇADA |", "INCERTO |", "INCERTO CONFERIDO |")
# tipo escrito antes da chave ("CPF 111…", "CNPJ: …", "E-MAIL - …", "EVP …"): o rótulo explícito MANDA no tipo
_RE_ROTULO_PIX = re.compile(r"^(CHAVE ALEAT[OÓ]RIA|ALEAT[OÓ]RIA|EVP|E-?MAIL|CPF|CNPJ|TELEFONE|CELULAR)"
                            r"(?:\s*:\s*|\s+-\s+|\s+)(.+)$", re.I)
_SO_ROTULO = {"CHAVE ALEATORIA", "ALEATORIA", "EVP", "EMAIL", "E-MAIL", "CPF", "CNPJ", "TELEFONE", "CELULAR"}
_TIPO_DO_ROTULO = (("CHAVE ALEATORIA", "ALEATÓRIA"), ("ALEATORIA", "ALEATÓRIA"), ("EVP", "ALEATÓRIA"),
                   ("EMAIL", "E-MAIL"), ("E-MAIL", "E-MAIL"), ("CPF", "CPF"), ("CNPJ", "CNPJ"),
                   ("TELEFONE", "TELEFONE"), ("CELULAR", "TELEFONE"))


class PixDuvidoso(ValueError):
    """Chave de 14 dígitos, sem rótulo, que não é um CNPJ válido: alguém confere o cadastro antes de pagar."""
    def __init__(self, chave: str):
        super().__init__(chave)
        self.chave = chave


def _hoje() -> str:
    return _dt.date.today().isoformat()


def _agora() -> str:
    return _dt.datetime.now().strftime("%d/%m %H:%M")


def pix_da_chave(texto) -> str | None:
    """Chave -> "<TIPO>: <chave>"; None se vazia. Rótulo explícito na frente (CPF, CNPJ, CELULAR/TELEFONE, E-MAIL,
    ALEATÓRIA/EVP) MANDA no tipo. Sem rótulo: @ = E-MAIL; + = TELEFONE; só dígitos: 14 = CNPJ se o DV do CNPJ
    fecha (senão PixDuvidoso), 11 = CPF se o CPF for válido (senão TELEFONE), 10 = TELEFONE; o resto = ALEATÓRIA."""
    s = " ".join(str(texto or "").split()).strip(" :-–")
    m = _RE_ROTULO_PIX.match(s)
    rotulo = None
    if m:
        rotulo = next(t for k, t in _TIPO_DO_ROTULO if R.chave(m.group(1)) == R.chave(k))
        s = m.group(2).strip(" :-–")
    if not s or R.chave(s) in _SO_ROTULO:
        return None
    if rotulo:
        tipo = rotulo
    elif "@" in s:
        tipo = "E-MAIL"
    elif s.startswith("+"):
        tipo = "TELEFONE"
    elif re.fullmatch(r"[\d.\-/() ]+", s):
        d = R.so_digitos(s)
        if len(d) == 14:
            if not R.cnpj_valido(d):
                raise PixDuvidoso(s)
            tipo = "CNPJ"
        elif len(d) == 11:
            tipo = "CPF" if R.cpf_valido(d) else "TELEFONE"
        else:
            tipo = "TELEFONE" if len(d) == 10 else "ALEATÓRIA"
    else:
        tipo = "ALEATÓRIA"
    return "%s: %s" % (tipo, s)


def pix_do_banco(texto) -> str | None:
    """`bankAccount` do fornecedor no ERP: só vale o que começa com PIX ("PIX: <chave>")."""
    s = " ".join(str(texto or "").split())
    if not R.chave(s).startswith("PIX"):
        return None
    return pix_da_chave(s[3:])


def _historico(texto) -> list[str]:
    """As linhas `LANÇADA | …`, `INCERTO | …` e `INCERTO CONFERIDO | …` da coluna: nunca se apagam."""
    return [ln for ln in str(texto or "").split("\n") if ln.startswith(_PREFIXOS_HIST)]


def _pendente() -> Recusa:
    return Recusa("INCERTO_PENDENTE", "um lançamento anterior ficou INCERTO e não deu para conferir no Mais "
                  "Controle se o título foi criado — nada foi feito; peça de novo mais tarde ou confira à mão")


def resolver_incertos(erp, hist: list[str], titulos) -> list[str]:
    """Cada `INCERTO | … | datas D1,D2 | …` (anotado ANTES do POST) é conferido na leitura da obra (`titulos`, de
    titulos_no_erp; None = a leitura falhou): título da unidade com parcela numa data DELE que a coluna não conhece
    -> `LANÇADA | título <id> | R$ <valor do ERP> | … | confirmado depois do incerto` (conta no já lançado); nenhum
    -> `INCERTO CONFERIDO | não criado | <datas> | …` (não conta). ERP fora do ar, título sem id ou sem valor ->
    Recusa INCERTO_PENDENTE: nunca seguir com INCERTO aberto."""
    out = []
    for ln in hist:
        if not ln.startswith("INCERTO |"):
            out.append(ln)
            continue
        m = _RE_INCERTO.match(ln)
        datas = [x for x in (m.group(1).split(",") if m else []) if x]
        if not datas or titulos is None:
            raise _pendente()
        conhecidos = ja_da_coluna(out + hist)[1]
        novos = {tid for tid, t in titulos.items() if tid not in conhecidos and t["datas"] & set(datas)}
        if "" in novos:
            raise _pendente()
        pendente = _pendente()
        achadas = []
        for tid in sorted(novos):
            try:
                t = erp.pedir("GET", "/trade-payables/%s" % tid) or {}
                valor = round(float(t.get("value") or 0), 2)
            except Exception:   # noqa: BLE001
                raise pendente from None
            if valor <= 0:
                raise pendente
            achadas.append("LANÇADA | título %s | %s | %d parcela(s) | recibos: não conferidos | %s | confirmado "
                           "depois do incerto" % (tid, reais(valor), len(t.get("installments") or []), _agora()))
        out += achadas or ["INCERTO CONFERIDO | não criado | %s | %s" % (",".join(datas), _agora())]
    return out


def ja_da_coluna(hist: list[str]) -> tuple[float, set]:
    total, ids = 0.0, set()
    for ln in hist:
        m = _RE_LANCADA.match(ln)
        if m:
            ids.add(m.group(1))
            total += float(m.group(2).replace(".", "").replace(",", "."))
    return round(total, 2), ids


def _lista(j) -> list:
    if isinstance(j, list):
        return j
    if isinstance(j, dict):
        return j.get("content") or []
    return []


def janela_da_venda(assinatura, hoje: str) -> list[tuple[str, str]]:
    """Pedaços (início, fim), de no máximo PEDACO_DIAS dias, sem buraco, de (assinatura do contrato, ou hoje−400)
    − 30 dias até hoje + 400 (o último vencimento que ler_parcelas aceita)."""
    h = _dt.date.fromisoformat(hoje)
    try:
        base = _dt.date.fromisoformat(str(assinatura or "")[:10])
    except ValueError:
        base = h - _dt.timedelta(days=400)
    ini = min(base, h) - _dt.timedelta(days=30)
    fim = h + _dt.timedelta(days=400)
    out = []
    while ini <= fim:
        f = min(ini + _dt.timedelta(days=PEDACO_DIAS - 1), fim)
        out.append((ini.isoformat(), f.isoformat()))
        ini = f + _dt.timedelta(days=1)
    return out


def _valor_parcela(x: dict) -> float:
    """Valor de uma parcela da lista de contas a pagar: o previsto, se vier; senão o que falta + o que já foi pago."""
    for k in ("plannedValue", "value"):
        if x.get(k) not in (None, ""):
            return round(float(x[k]), 2)
    return round(float(x.get("remainingValue") or 0) + float(x.get("sumOfPaidValues") or 0), 2)


def titulos_no_erp(erp, casa: int, work_id, pedacos) -> dict:
    """Títulos A PAGAR "COMISSÃO CORRETOR UNIDADE NN…" (NN sem confundir 07 com 070) da OBRA da venda, na janela
    inteira: {tradePayableId: {"valor": soma das parcelas, "n": parcelas, "datas": {AAAA-MM-DD}}}. Parcela sem
    tradePayableId entra no id "" (= desconhecido). Sempre onlyWork=true&workId (sem ele o ERP varre a empresa)."""
    if not work_id:
        raise ErpErro("sem a obra da venda não consulto as contas a pagar")
    prefixo = R.chave("COMISSÃO CORRETOR UNIDADE %02d" % casa)
    out, vistos = {}, set()
    for ini, fim in pedacos:
        pagina = 0
        while True:
            j = erp.pedir("GET", "/payable-installments/paginated-result", params={
                "page": pagina, "size": TAMANHO_PAGINA, "type": "ALL", "onlyWork": "true", "workId": work_id,
                "dateField": "PLANNED", "costCentreType": "ALL", "conciliationType": "ALL",
                "tradePayableType": "ALL", "batchOperationType": "NONE", "startDate": ini, "endDate": fim})
            itens = j.get("content") if isinstance(j, dict) else None
            if not isinstance(itens, list):
                raise ErpErro("lista de contas a pagar em formato inesperado")
            for x in itens:
                if not isinstance(x, dict):
                    raise ErpErro("parcela de contas a pagar em formato inesperado")
                desc = R.chave(x.get("description"))
                if not desc.startswith(prefixo) or desc[len(prefixo):len(prefixo) + 1].isdigit():
                    continue
                chave_item = str(x.get("id") or "")
                if chave_item and chave_item in vistos:     # a mesma parcela em dois pedidos: conta uma vez
                    continue
                vistos.add(chave_item)
                t = out.setdefault(str(x.get("tradePayableId") or ""), {"valor": 0.0, "n": 0, "datas": set()})
                t["valor"] = round(t["valor"] + _valor_parcela(x), 2)
                t["n"] += 1
                t["datas"].add(str(x.get("plannedDate") or "")[:10])
            tem_proxima = j.get("hasNextPage")   # o aviso do ERP manda; sem ele vale a página cheia
            if tem_proxima is not True and (tem_proxima is not None or len(itens) < TAMANHO_PAGINA):
                break
            pagina += 1
            if pagina >= MAX_PAGINAS:
                raise ErpErro("contas a pagar de %s a %s com páginas demais; parei para não decidir com lista "
                              "incompleta" % (ini, fim))
    return out


def _doc(p: dict) -> str:
    return R.so_digitos(p.get("cpf")) or R.so_digitos(p.get("cnpj"))


def candidatos(erp, cpf: str | None, email: str | None) -> list[dict]:
    """Corretor pelo CPF + fornecedores com o mesmo e-mail (a imobiliária dele). Únicos, só ACTIVE.
    Da busca por e-mail só entra o cadastro com o MESMO e-mail (a busca do ERP é por trecho; sem e-mail = fora)."""
    out, vistos = [], set()
    achados = list(erp.participantes_por_documento(cpf) or []) if cpf else []
    if email:
        alvo = email.strip().lower()
        for p in _lista(erp.pedir("GET", "/participants", params={"role": "SUPPLIER", "keyword": email, "page": 0,
                                                                   "size": 20, "sort": "name"})):
            if not isinstance(p, dict) or str(p.get("email") or "").strip().lower() != alvo:
                continue
            achados.append(p)
    for p in achados:
        if not isinstance(p, dict) or not p.get("id") or p["id"] in vistos or p.get("status") != "ACTIVE":
            continue
        vistos.add(p["id"])
        out.append(p)
    return out


def _cadastro_corretor(notion, nome) -> dict | None:
    """Linha do corretor na CORRETORES – CONTRATO (pelo nome): {"documento", "pix"}; None se não achar ou repetida."""
    db = os.environ.get("DB_CORRETORES", "").strip()
    if not db or not nome:
        return None
    alvo, achadas = R.chave(nome), []
    for ln in notion.linhas(db) or []:
        props = ln.get("properties") or {}
        por = {R.chave(k): v for k, v in props.items()}
        tit = next((R._valor(v) for v in props.values() if isinstance(v, dict) and v.get("type") == "title"), None)
        if R.chave(tit) == alvo:
            c = {"documento": R.so_digitos(R._valor(por.get("CPF/CNPJ"))), "pix": None}
            try:
                c["pix"] = pix_da_chave(R._valor(por.get("CHAVE PIX")))
            except PixDuvidoso as e:
                c["duvidoso"] = e.chave
            achadas.append(c)
    return achadas[0] if len(achadas) == 1 else None


def _fmt_doc(d: str) -> str:
    if len(d) == 11:
        return "%s.%s.%s-%s" % (d[:3], d[3:6], d[6:9], d[9:])
    if len(d) == 14:
        return "%s.%s.%s/%s-%s" % (d[:2], d[2:5], d[5:8], d[8:12], d[12:])
    return d or "sem CPF/CNPJ"


def _parcelas_txt(parcelas: list[dict]) -> str:
    n = len(parcelas)
    return "; ".join("%d/%d %s em %s" % (i, n, reais(p["valor"]), R.data_br(p["data"]))
                     for i, p in enumerate(parcelas, 1))


def _linhas_candidatos(cands: list[dict]) -> list[str]:
    return ["Candidatos:"] + ["- %s | %s | %s | %s" % (c["id"], " ".join(str(c.get("name") or "").split()),
                                                       _fmt_doc(_doc(c)), c.get("_pix") or (
                                                           "PIX DUVIDOSO " + c["_duvidoso"] if c.get("_duvidoso")
                                                           else "sem Pix")) for c in cands]


def _pix_nao_e_o_documento(pix: str, fav: dict) -> bool:
    """Chave CPF/CNPJ diferente do documento do favorecido (só avisa; o cadastro do ERP pode estar certo)."""
    tipo, _, chave = str(pix or "").partition(": ")
    return tipo in ("CPF", "CNPJ") and bool(_doc(fav)) and R.so_digitos(chave) != _doc(fav)


def _por_nome(itens, nome) -> dict | None:
    alvo = R.chave(nome)
    return next((x for x in itens or [] if isinstance(x, dict) and R.chave(x.get("name")) == alvo), None)


def _linhas_recibo(d: dict, venda: dict, cliente: str, fav: dict, pix: str, comissao: float, p: dict,
                   i: int, n: int) -> list[tuple[str, str]]:
    """Só valores curtos (o recibo quebra valor longo e recusa o que não cabe numa página)."""
    return [("Empreendimento", (venda.get("work") or {}).get("name") or d.get("endereco") or "-"),
            ("Unidade", "%02d" % d["casa"]), ("Comprador", cliente),
            ("Valor de venda", reais(d["total"]) if d.get("total") else "-"),
            ("Comissão total", reais(comissao)), ("Corretor", " ".join(str(d.get("corretor") or "").upper().split())),
            ("Favorecido", " ".join(str(fav.get("name") or "").split())), ("CPF/CNPJ", _fmt_doc(_doc(fav))),
            ("Chave Pix", pix), ("Parcela", "%d/%d" % (i, n)), ("Valor desta parcela", reais(p["valor"])),
            ("Vencimento", R.data_br(p["data"]))]


def _sem_pdf(nome) -> str:
    """Nome do anexo sem a extensão .pdf (a conferência do ERP devolve sem ela)."""
    s = str(nome or "").strip()
    return s[:-4] if s.lower().endswith(".pdf") else s


def _assinatura_contrato(props: dict) -> str | None:
    """DATA DE ASSINATURA DO CONTRATO da linha (ISO) — início da janela onde se procuram títulos no ERP."""
    alvo = R.chave(C.COL_LINHA["assinatura"])
    return next((R._data(R._valor(v)) for k, v in (props or {}).items() if R.chave(k) == alvo), None)


def _releitura_bate(depois: dict, parcelas: list[dict], total: float, fav_id: str) -> bool:
    ps = (depois or {}).get("installments") or []
    try:
        lidas = sorted((str(x.get("plannedDate") or "")[:10], round(float(x.get("plannedValue") or 0), 2)) for x in ps)
        valor = float((depois or {}).get("value") or 0)
    except (TypeError, ValueError):
        return False
    pedidas = sorted((p["data"], round(p["valor"], 2)) for p in parcelas)
    return (abs(valor - total) < 0.01 and lidas == pedidas
            and str(((depois or {}).get("participant") or {}).get("id") or "") == str(fav_id))


def processar(page_id: str, notion, erp, parcelas_txt: str, favorecido_id: str = "", aplicar: bool = False,
              bloqueado: bool = False, hoje: str = "") -> dict:
    """Prévia (padrão) ou lançamento (aplicar) de UM título A PAGAR da comissão. Nunca deixa exceção escapar:
    o resultado vai em {"situacao", "codigo", "avisos", "texto"} e na coluna MC - COMISSÃO (com o histórico
    `LANÇADA | …` sempre preservado). Nunca repete o POST: sem id na resposta = INCERTO."""
    res = {"situacao": None, "codigo": None, "avisos": [], "texto": ""}
    hoje = hoje or _hoje()
    aplicar = bool(aplicar) and not bloqueado
    ctx = {"props": {}, "hist": []}

    def gravar(texto) -> bool:
        """True = gravou; False = a coluna não existe."""
        if len(texto) > LIMITE_COLUNA and hasattr(notion, "gravar_texto_longo"):
            ok = notion.gravar_texto_longo(page_id, ctx["props"], COL_ESTADO, texto)
        else:
            ok = not notion.gravar_textos(page_id, ctx["props"], {COL_ESTADO: texto})
        if not ok:
            res["avisos"].append("COLUNA_FALTANDO")
        return bool(ok)

    def tentar(texto, tentativas) -> bool:
        """Grava `texto` na coluna; True = gravou. Exceção do Notion não escapa (vira aviso e False)."""
        for tentativa in range(tentativas):
            try:
                return gravar(texto)
            except Exception:   # noqa: BLE001 — o resultado vai no código
                if tentativa == tentativas - 1:
                    res["avisos"].append("NOTION_NAO_ANOTADO")
        return False

    def fim(situacao, bloco, codigo=None, depois=(), obrigatorio=False):
        texto = "\n".join(([bloco] if bloco else []) + ctx["hist"] + list(depois))
        res["situacao"], res["codigo"], res["texto"] = situacao, codigo or situacao, texto
        if not tentar(texto, 2 if obrigatorio else 1) and obrigatorio:
            res["codigo"] = situacao + "_SEM_ANOTAR"
        return res

    try:
        pg = notion.pagina(page_id) or {}
        props = ctx["props"] = pg.get("properties") or {}
        estado = ""
        for k, v in props.items():
            if R.chave(k) == R.chave(COL_ESTADO):
                estado = str(R._valor(v) or "")
        ctx["hist"] = _historico(estado)

        # 1. só condomínio, com comissão, depois da venda no ERP
        db = os.environ.get("DB_VENDAS_COND", "").strip()
        if not db:
            raise Recusa("SEM_DB_VENDAS_COND", "falta a variável DB_VENDAS_COND: sem ela o robô não sabe se é condomínio")
        if not C.e_linha_do_condominio(pg, db):
            raise Recusa("SO_CONDOMINIO", "a comissão pelo portal é só para venda do condomínio")
        d = C.dados_da_linha(props, page_id)
        fx = C.fluxo(props)
        if fx.get("semComissao") or (fx.get("livre") or {}).get("semComissao"):
            raise Recusa("SEM_COMISSAO", "a venda é sem comissão (isenção no fluxo / venda direta)")
        comissao = d.get("comissao")
        if not comissao or comissao <= 0:
            raise Recusa("SEM_COMISSAO", "a venda não tem comissão (coluna COMISSÃO vazia)")
        vid = str(d.get("venda_id_atual") or "").strip()
        if not vid:
            raise Recusa("SEM_VENDA_ID", "a venda ainda não está no Mais Controle (falta MC - VENDA ID)")
        if not d.get("casa"):
            raise Recusa("SEM_UNIDADE", "a linha não tem o número da UNIDADE")

        # 2. parcelas, venda, obra e conta
        parcelas = ler_parcelas(parcelas_txt, hoje)
        venda = erp.ler_venda(vid) or {}
        cliente = " ".join(str((venda.get("customer") or {}).get("name") or "").split())
        work = venda.get("work") or {}
        if not venda.get("id") or not cliente or not work.get("id"):
            raise Recusa("VENDA_NAO_ENCONTRADA", "o Mais Controle não devolveu a venda com cliente e obra")
        conta = (erp.obra(work["id"]) or {}).get("defaultAccount") or {}
        if not conta.get("id"):
            raise Recusa("OBRA_SEM_CONTA", "a obra da venda não tem conta padrão no Mais Controle")

        # 3. já lançado: a coluna + todo título da unidade que o ERP tem na obra, na janela inteira da venda
        try:
            titulos = titulos_no_erp(erp, d["casa"], work["id"], janela_da_venda(_assinatura_contrato(props), hoje))
        except Exception:   # noqa: BLE001
            if any(ln.startswith("INCERTO |") for ln in ctx["hist"]):
                raise _pendente() from None
            raise
        havia_incerto = any(ln.startswith("INCERTO |") for ln in ctx["hist"])
        ctx["hist"] = resolver_incertos(erp, ctx["hist"], titulos)
        if havia_incerto and aplicar:
            # o saldo mudou (ou o incerto foi descartado) depois da prévia que o dono viu: nunca lançar na sequência
            ultima = next((ln for ln in reversed(ctx["hist"]) if ln.startswith(("LANÇADA |", "INCERTO CONFERIDO |"))), "")
            achou = "LANÇADA" if ultima.startswith("LANÇADA |") else "INCERTO CONFERIDO"
            raise Recusa("INCERTO_RESOLVIDO_PECA_PREVIA", "havia um lançamento com resultado incerto; ele foi conferido "
                         "no Mais Controle (%s). Peça uma prévia nova antes de lançar." % achou)
        if "" in titulos:
            raise Recusa("TITULO_SEM_ID", "o Mais Controle tem parcela de comissão desta unidade sem o id do título "
                         "— nada foi feito; confira no Mais Controle")
        ids_coluna = ja_da_coluna(ctx["hist"])[1]
        adotados = []
        for tid in sorted(set(titulos) - ids_coluna):   # lançado à mão (ou anotação perdida): entra no já lançado
            t = titulos[tid]
            if t["valor"] <= 0:
                raise Recusa("TITULO_SEM_VALOR", "o Mais Controle tem o título de comissão %s desta unidade sem valor "
                             "— nada foi feito; confira no Mais Controle" % tid)
            ctx["hist"].append("LANÇADA | título %s | %s | %d parcela(s) | encontrado no ERP | %s"
                               % (tid, reais(t["valor"]), t["n"], _agora()))
            adotados.append(tid)
        ja, ids_coluna = ja_da_coluna(ctx["hist"])
        ja_txt = []
        if ja > 0:
            ja_txt = ["Já lançado no Mais Controle: %s em %d título(s)%s" % (
                reais(ja), len(ids_coluna), (" — encontrado(s) no ERP agora: %s" % ", ".join(adotados))
                if adotados else "")]

        # 4. saldo
        saldo = conferir_saldo(parcelas, comissao, ja)

        # 5. favorecido
        contato = C.contato_corretor(props)
        cands = candidatos(erp, contato.get("documento"), contato.get("email"))
        if not cands:
            raise Recusa("SEM_FAVORECIDO", "o corretor não está cadastrado no Mais Controle (nem pelo CPF nem pelo "
                         "e-mail) — cadastre-o e peça de novo")
        cad = None
        for c in cands:
            try:
                c["_pix"] = pix_do_banco(c.get("bankAccount"))
            except PixDuvidoso as e:
                c["_pix"], c["_duvidoso"] = None, e.chave
                continue
            if not c["_pix"] and _doc(c):
                if cad is None:
                    cad = _cadastro_corretor(notion, d.get("corretor")) or {}
                # a chave do cadastro de corretores é do corretor: só vale para o cadastro com o documento dele
                if _doc(c) in {R.so_digitos(contato.get("documento")), cad.get("documento")}:
                    if cad.get("pix"):
                        c["_pix"] = cad["pix"]
                    elif cad.get("duvidoso"):
                        c["_duvidoso"] = cad["duvidoso"]
        fav_id = str(favorecido_id or "").strip()
        if fav_id:
            fav = next((c for c in cands if str(c["id"]) == fav_id), None)
            if not fav:
                raise Recusa("FAVORECIDO_INVALIDO", "o favorecido escolhido não está entre os cadastros do corretor")
        elif len(cands) == 1:
            fav = cands[0]
        else:
            if aplicar:
                raise Recusa("ESCOLHER_FAVORECIDO", "há %d cadastros possíveis: escolha quem recebe na prévia" % len(cands))
            return fim("PREVIA", "\n".join(
                ["ESCOLHER FAVORECIDO: há %d cadastros no Mais Controle que podem receber — escolha um" % len(cands),
                 "Parcelas: " + _parcelas_txt(parcelas),
                 "Saldo da comissão: %s de %s" % (reais(saldo), reais(comissao))] + ja_txt + _linhas_candidatos(cands)),
                "ESCOLHER_FAVORECIDO")

        # 6. Pix
        pix = fav.get("_pix")
        if not pix and fav.get("_duvidoso"):
            raise Recusa("PIX_DUVIDOSO", "a chave Pix %s tem 14 dígitos mas não é um CNPJ válido — confira o cadastro "
                         "do favorecido (ponha o tipo na frente, ex.: \"PIX: ALEATÓRIA <chave>\") e peça de novo"
                         % fav["_duvidoso"])
        if not pix:
            raise Recusa("SEM_PIX", "o favorecido não tem chave Pix (nem no cadastro do Mais Controle nem na "
                         "CORRETORES – CONTRATO) — cadastre a chave e peça de novo")

        # 7. catálogo
        n = len(parcelas)
        categoria = _por_nome(erp.pedir("GET", "/categories/all"), CATEGORIA)
        if not categoria or not categoria.get("id"):
            raise Recusa("CATALOGO_FALTANDO", "o Mais Controle não tem a categoria \"%s\"" % CATEGORIA)
        forma = _por_nome(erp.pedir("GET", "/payment-methods/all"), FORMA)
        if not forma or not forma.get("id"):
            raise Recusa("CATALOGO_FALTANDO", "o Mais Controle não tem a forma de pagamento \"%s\"" % FORMA)
        tipo = "FINANCING" if n > 1 else "IN_CASH"
        condicao = erp.condicao_por_tipo(tipo)
        if not condicao or not condicao.get("id"):
            raise Recusa("CATALOGO_FALTANDO", "o Mais Controle não tem condição de pagamento %s"
                         % ("Parcelado" if n > 1 else "à vista"))
        desc = descricao(d["casa"], cliente)
        obs = observacao(pix, d.get("corretor"), comissao, parcelas)
        try:
            corpo = corpo_titulo(parcelas, desc, obs, fav["id"], categoria["id"], forma["id"], conta, work, condicao,
                                 str(getattr(erp, "user_id", "") or ""), hoje)
        except ValueError:
            raise Recusa("CATALOGO_FALTANDO", "a condição de pagamento do Mais Controle não bate com %d parcela(s)" % n)

        plano = {"parcelas": parcelas, "favorecido_id": str(fav["id"]), "comissao": comissao, "ja_lancado": ja,
                 "pix": pix, "conta_id": str(conta["id"]), "descricao": desc}
        assin = assinatura(plano)

        # 8. prévia
        if not aplicar:
            linhas = ["PRÉVIA OK [#%s] | %s" % (assin, desc),
                      "Favorecido: %s | %s" % (" ".join(str(fav.get("name") or "").split()), _fmt_doc(_doc(fav))),
                      "Pix: " + pix,
                      "Parcelas: " + _parcelas_txt(parcelas),
                      "Conta: " + str(conta.get("name") or conta["id"]),
                      "Saldo da comissão: %s de %s" % (reais(saldo), reais(comissao))] + ja_txt
            if _pix_nao_e_o_documento(pix, fav):
                linhas.append("ATENÇÃO: a chave Pix (CPF/CNPJ) não é o documento do favorecido")
            if len(cands) > 1:
                linhas += _linhas_candidatos(cands)
            pre = "BLOQUEADO: gravar está desligado neste ambiente — " if bloqueado else ""
            return fim("PREVIA", pre + "\n".join(linhas), "BLOQUEADO" if bloqueado else "PREVIA")

        # 9. aplicar: só o que a prévia mostrou
        if assinatura_do_texto(estado) != assin:
            raise Recusa("PREVIA_DESATUALIZADA", "a comissão, as parcelas, o favorecido ou o Pix mudaram depois da "
                         "prévia (ou não há prévia) — nada foi lançado; peça a prévia de novo")
    except Recusa as e:
        return fim("RECUSADO", "RECUSADO: " + e.texto, e.codigo)
    except ErpErro as e:
        return fim("ERRO", "ERRO: o Mais Controle recusou a consulta (%s) — nada foi lançado" % str(e)[:250],
                   "ERP_RECUSOU")
    except Exception as e:   # noqa: BLE001 — nunca deixar exceção escapar (nem PROCESSANDO preso)
        return fim("ERRO", "ERRO: falha inesperada (%s) — nada foi lançado" % type(e).__name__, type(e).__name__)

    # rastro ANTES do POST: se o processo morrer em qualquer ponto daqui em diante, a próxima execução acha esta
    # linha e confere no ERP (resolver_incertos). Sem o rastro gravado, não posta.
    total = round(sum(p["valor"] for p in parcelas), 2)
    primeira = str(estado or "").split("\n")[0]
    bloco_proc = primeira if R.chave(primeira).startswith("PROCESSANDO") else "PROCESSANDO (lançamento) — robô"
    datas = ",".join(dict.fromkeys(p["data"] for p in parcelas))
    marca = "INCERTO | %s | datas %s | %s | %s" % (desc, datas, reais(total), _agora())
    if not tentar("\n".join([bloco_proc] + ctx["hist"] + [marca]), 2):
        return fim("RECUSADO", "RECUSADO: não consegui anotar na coluna %s o lançamento que ia fazer — nada foi "
                   "lançado; peça de novo" % COL_ESTADO, "NAO_ANOTADO")

    # POST uma vez só; dali em diante nada repete o POST
    try:
        r = erp.pedir("POST", "/trade-payables", corpo=corpo, params={"userApprovesSaleCreation": "true"})
    except ErpErro as e:
        if re.match(r"^[A-Z]+ \S+ -> HTTP 4\d\d:", str(e)):   # o status do próprio pedido, não um citado no corpo
            return fim("RECUSADO", "ERRO: o Mais Controle recusou o título (%s) — nada foi lançado; CONFIRA no Mais "
                       "Controle antes de pedir de novo" % str(e)[:250], "ERP_RECUSOU")
        r = None
    except Exception:   # noqa: BLE001 — rede caiu no meio: pode ter gravado
        r = None
    tpid = r.get("id") if isinstance(r, dict) else None
    if not tpid:
        return fim("INCERTO", "INCERTO: o Mais Controle não devolveu o id — CONFIRA antes de repetir (o título pode "
                   "ter sido criado; procure \"%s\"). A próxima execução confere no Mais Controle." % desc, "INCERTO",
                   depois=[marca], obrigatorio=True)
    res["titulo"] = str(tpid)

    # logo depois do POST: INCERTO -> LANÇADA (recibos pendentes). Se falhar, o INCERTO que ficou é resolvido depois.
    base = "LANÇADA | título %s | %s | %d parcela(s) | " % (tpid, reais(total), n)
    trocou = tentar("\n".join([bloco_proc] + ctx["hist"] + [base + "recibos: pendentes | " + _agora()]), 2)

    bate, ok_nomes, conferidos = False, [], None
    try:
        for i, p in enumerate(parcelas, 1):
            nome = nome_recibo(d["casa"], p, i, n)
            try:
                pdf = recibo(_linhas_recibo(d, venda, cliente, fav, pix, comissao, p, i, n), TITULO_RECIBO)
                st = erp.anexar_titulo(str(tpid), nome, pdf)
                if isinstance(st, int) and 200 <= st < 300:
                    ok_nomes.append(nome)
                else:
                    res["avisos"].append("RECIBO_NAO_ANEXADO")
            except Exception:   # noqa: BLE001 — recibo que não subiu aparece em "recibos: k/n"
                res["avisos"].append("RECIBO_NAO_ANEXADO")
        try:
            conf = erp.pedir_core("GET", "/attachments/v2", params={"entityIds": tpid, "entityOrigin": "TRADE_PAYABLE"})
            if not isinstance(conf, list):
                raise ErpErro("lista de anexos em formato inesperado")
            # medido ao vivo (24/11): o nome vem em "filename", sem a extensão; name/fileName de reserva
            nomes = {_sem_pdf(x.get(c)) for x in conf if isinstance(x, dict) for c in ("filename", "name", "fileName")}
            nomes.discard("")
            conferidos = sum(1 for nm in ok_nomes if _sem_pdf(nm) in nomes)
        except Exception:   # noqa: BLE001
            res["avisos"].append("ANEXOS_NAO_CONFERIDOS")
        bate = _releitura_bate(erp.pedir("GET", "/trade-payables/%s" % tpid) or {}, parcelas, total, fav["id"])
    except Exception:   # noqa: BLE001 — o título existe: a linha LANÇADA sai de qualquer jeito
        bate = False
    recibos_txt = ("recibos: %d/%d" % (conferidos, n)) if conferidos is not None else (
        "recibos: NÃO CONFERIDOS (%d enviados)" % len(ok_nomes))
    linha = base + recibos_txt + " | " + _agora()
    if not bate:
        linha += " — releitura NÃO bateu: confira no Mais Controle"
    fim("LANCADA", "", "LANCADA", depois=[linha], obrigatorio=True)
    if res["codigo"] == "LANCADA_SEM_ANOTAR" and trocou:
        res["codigo"] = "LANCADA"            # a linha LANÇADA (recibos pendentes) ficou; só a contagem não entrou
        res["avisos"].append("RECIBOS_NAO_ANOTADOS")
    return res


def main(argv=None) -> int:
    from .notion import Notion
    ap = argparse.ArgumentParser()
    ap.add_argument("--page", required=True)
    ap.add_argument("--parcelas", default="", help="V@AAAA-MM-DD;V@AAAA-MM-DD (até %d)" % MAX_PARCELAS)
    ap.add_argument("--favorecido", default="", help="id do favorecido escolhido na prévia")
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--bloqueado", action="store_true")
    ap.add_argument("--marcar-erro", default=None, help="o servidor falhou antes do robô: só anota o erro")
    a = ap.parse_args(argv)

    def sair(res, cod):
        out = {"situacao": res.get("situacao"), "codigo": res.get("codigo"), "avisos": res.get("avisos") or []}
        if str(res.get("codigo") or "").endswith("_SEM_ANOTAR") and res.get("titulo"):
            out["titulo"] = res["titulo"]      # id do título (não é dado pessoal): para achar no ERP à mão
        print(json.dumps(out, ensure_ascii=False))
        return cod

    notion = Notion(os.environ["NOTION_TOKEN"]) if os.environ.get("NOTION_TOKEN") else None

    def anotar(texto, so_se_processando=False):
        if not notion:
            return
        try:
            props = notion.pagina(a.page).get("properties") or {}
            atual = ""
            for k, v in props.items():
                if R.chave(k) == R.chave(COL_ESTADO):
                    atual = str(R._valor(v) or "")
            if so_se_processando and atual and not R.chave(atual).startswith("PROCESSANDO"):
                return
            novo = "\n".join(["ERRO: " + texto[:300]] + _historico(atual))
            if len(novo) > LIMITE_COLUNA and hasattr(notion, "gravar_texto_longo"):
                notion.gravar_texto_longo(a.page, props, COL_ESTADO, novo)
            else:
                notion.gravar_textos(a.page, props, {COL_ESTADO: novo})
        except Exception:   # noqa: BLE001
            pass

    if a.marcar_erro is not None:
        anotar(a.marcar_erro or "o robô do servidor falhou", so_se_processando=True)
        return sair({"situacao": "ERRO", "codigo": "ROBO_FALHOU"}, 1)
    if faltam_segredos(("NOTION_TOKEN",)):
        anotar("o robô está sem configuração")
        return sair({"situacao": "ERRO", "codigo": "SEM_SEGREDOS"}, 2)
    try:
        erp = do_ambiente()
        res = processar(a.page, notion, erp, a.parcelas, favorecido_id=a.favorecido,
                        aplicar=a.aplicar and not a.bloqueado, bloqueado=a.bloqueado, hoje=_hoje())
    except Exception as e:   # noqa: BLE001 — processar não deixa escapar; isto cobre o do_ambiente
        anotar("falha inesperada (%s) — nada foi lançado" % type(e).__name__)
        return sair({"situacao": "ERRO", "codigo": type(e).__name__}, 1)
    return sair(res, 0 if res.get("situacao") == "PREVIA" or res.get("codigo") == "LANCADA" else 1)


if __name__ == "__main__":
    sys.exit(main())
