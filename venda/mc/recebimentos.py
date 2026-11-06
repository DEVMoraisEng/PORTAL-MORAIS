# -*- coding: utf-8 -*-
"""Recebimentos da casa de rua no Mais Controle (pedido do dono, 05/11/2026; aba Recebimentos do painel da casa).

O que faz, com a venda já lançada (MC - VENDA ID):
 1. ALTERA as parcelas a receber da venda quando o valor no portal mudou — SÓ sinal, financiamento e FGTS
    (aprovação do dono de 05/11/2026; fora disso continua valendo "o robô nunca altera venda", com a exceção da
    antecipação do condomínio). Antes de gravar guarda a venda INTEIRA (JSON do GET) fora do repositório; depois
    relê e confere centavo por centavo; se não bater, grava de volta o JSON guardado (desfaz) e avisa.
    Financiamento = VALOR FINANCIADO + VALOR DO SUBSÍDIO (a mesma conta do lançamento, regras.parcelas).
    Parcela que ainda não existe (ex.: FGTS novo) é criada; zerar uma parcela que existe fica para a mão.
 2. Dá BAIXA de cada pagamento do sinal e da entrada registrado no portal que ainda não está no Mais Controle
    (3 mil num dia e 2 mil no outro = duas baixas parciais), com o valor e a data do portal, e anexa o comprovante
    na pasta de arquivos da venda. A conta bancária vem do comprovante (banco/agência/conta impressos, comparados
    com as contas do Mais Controle); sem identificar com certeza, fica a conta padrão que já está na venda (regra
    do dono: a conta vem da obra).

Gravar exige as travas da fila (servidor/robo_fila.py): o pedido veio com "aplicar" E a fila tem
"pode_gravar_recebimento": true E existe o arquivo _central/RECEBIMENTO_APLICAR.txt. Sem isso roda a PRÉVIA:
escreve o que faria e não grava nada no Mais Controle.

Uso:
    python -m venda.mc.recebimentos --page <id>              # prévia
    python -m venda.mc.recebimentos --page <id> --aplicar    # grava
    python -m venda.mc.recebimentos --page <id> --bloqueado  # pediram gravar, a trava está desligada
    python -m venda.mc.recebimentos --page <id> --marcar-erro "texto"

O resultado vai em JSON na coluna MC - RECEBIMENTOS da casa (a tela mostra por item). O stdout (log do servidor)
leva só situação e códigos — nunca nome, CPF ou valores. Rotas do ERP a conferir ao vivo: comentário em erp.py.
Repositório público: nenhum dado real aqui nem nos testes."""
from __future__ import annotations

import argparse
import copy
import datetime as _dt
import json
import mimetypes
import os
import pathlib
import re
import sys

from . import regras as R
from .erp import ErpErro, do_ambiente, faltam_segredos

CENTAVO = 0.005
COL_VENDA_ID = "MC - VENDA ID"
COL_RESULTADO = "MC - RECEBIMENTOS"
ITENS = {
    "SINAL": {"rotulo": "Sinal", "tipo": R.TIPO_SINAL, "esperado": ("CONTRATO - SINAL VALOR",), "baixa": True, "altera": True},
    "ENTRADA": {"rotulo": "Entrada", "tipo": R.TIPO_ENTRADA, "esperado": ("CONTRATO - ENTRADA VALOR",), "baixa": True,
                "altera": False},
    "FINANCIAMENTO": {"rotulo": "Financiamento", "tipo": R.TIPO_FINANCIAMENTO,
                      "esperado": ("VALOR FINANCIADO", "VALOR DO SUBSÍDIO"), "baixa": False, "altera": True},
    "FGTS": {"rotulo": "FGTS", "tipo": R.TIPO_FGTS, "esperado": ("VALOR DO FGTS",), "baixa": False, "altera": True},
}
ORDEM = ("SINAL", "ENTRADA", "FINANCIAMENTO", "FGTS")
RE_PID = re.compile(r"^[0-9a-z]{4,24}$")
RE_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
RAIZ_REPO = pathlib.Path(__file__).resolve().parents[2]


class Recusa(Exception):
    def __init__(self, codigo: str, texto: str):
        super().__init__(texto)
        self.codigo, self.texto = codigo, texto


def col_pagamentos(item: str) -> str:
    return "RECEBIMENTO - %s PAGAMENTOS" % item


def col_comprovante(item: str) -> str:
    return "RECEBIMENTO - %s COMPROVANTE" % item


def col_data(item: str) -> str:
    return "RECEBIMENTO - %s DATA" % item


def _f(x) -> float:
    try:
        return float(x or 0)
    except (TypeError, ValueError):
        return 0.0


def _r2(x) -> float:
    return round(_f(x) + 0.0, 2)


def brl(v) -> str:
    s = "%.2f" % _f(v)
    inteiro, cent = s.split(".")
    neg = inteiro.startswith("-")
    inteiro = inteiro.lstrip("-")
    partes = []
    while len(inteiro) > 3:
        partes.insert(0, inteiro[-3:])
        inteiro = inteiro[:-3]
    partes.insert(0, inteiro)
    return ("-" if neg else "") + "R$ " + ".".join(partes) + "," + cent


def data_br(iso) -> str:
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", str(iso or ""))
    return "%s/%s/%s" % (m.group(3), m.group(2), m.group(1)) if m else ""


# ----------------------------------------------------------------- leitura do Notion (puro)

def _por_chave(props: dict) -> dict:
    return {R.chave(k): v for k, v in (props or {}).items()}


def _valor(pc: dict, nome: str):
    return R._valor(pc.get(R.chave(nome)))


def esperados(props: dict) -> dict:
    """{item: valor esperado ou None}. None = coluna vazia ou ausente (o robô não mexe no que não sabe)."""
    pc, out = _por_chave(props), {}
    for item in ORDEM:
        vals = [R._num(_valor(pc, c)) for c in ITENS[item]["esperado"]]
        vals = [v for v in vals if v is not None]
        out[item] = round(sum(vals), 2) if vals else None
    return out


def _arquivos(pc: dict, nome: str) -> list:
    p = pc.get(R.chave(nome)) or {}
    return list(p.get("files") or []) if p.get("type") == "files" else []


def pagamentos(props: dict, esp: dict | None = None) -> dict:
    """{item: [pagamento]} de cada item com baixa automática. pagamento = {id, data, valor, arquivo, antigo?}.
    Lista nova (coluna RECEBIMENTO - <ITEM> PAGAMENTOS, JSON); sem ela, a confirmação antiga (DATA + comprovante)
    vira UM pagamento do valor esperado inteiro. Linha estragada da lista é ignorada (vai em "_avisos")."""
    pc, esp = _por_chave(props), esp if esp is not None else esperados(props)
    out, avisos = {}, []
    for item in ORDEM:
        bruto = _valor(pc, col_pagamentos(item))
        lista = []
        if bruto:
            try:
                dados = json.loads(bruto)
            except ValueError:
                dados = None
                avisos.append("%s: lista de pagamentos ilegível" % item)
            for x in dados if isinstance(dados, list) else []:
                pid, data, valor = str((x or {}).get("id") or ""), str((x or {}).get("data") or "")[:10], (x or {}).get("valor")
                if not RE_PID.match(pid) or not RE_ISO.match(data) or not isinstance(valor, (int, float)) or valor <= 0:
                    avisos.append("%s: pagamento ignorado (sem id, data ou valor)" % item)
                    continue
                lista.append({"id": pid, "data": data, "valor": _r2(valor), "arquivo": str(x.get("arquivo") or "")})
        elif _valor(pc, col_data(item)) and esp.get(item):
            fs = _arquivos(pc, col_comprovante(item))
            lista.append({"id": "antigo", "data": str(_valor(pc, col_data(item)))[:10], "valor": esp[item],
                          "arquivo": str((fs[-1] if fs else {}).get("name") or ""), "antigo": True})
        out[item] = sorted(lista, key=lambda p: (p["data"], p["id"]))
    out["_avisos"] = avisos
    return out


def arquivo_do_pagamento(props: dict, item: str, nome: str) -> dict | None:
    """O arquivo (objeto do Notion) do comprovante pelo NOME exato que o portal gravou."""
    if not nome:
        return None
    for f in reversed(_arquivos(_por_chave(props), col_comprovante(item))):
        if str(f.get("name") or "") == nome:
            return f
    return None


def anterior(props: dict) -> dict:
    """O resultado da rodada anterior (MC - RECEBIMENTOS), para não baixar duas vezes: {item: {pid: {...}}}."""
    t = _valor(_por_chave(props), COL_RESULTADO)
    try:
        j = json.loads(t) if t and str(t).strip().startswith("{") else {}
    except ValueError:
        j = {}
    out = {}
    for item, v in ((j.get("itens") or {}) if isinstance(j, dict) else {}).items():
        out[item] = dict((v or {}).get("pagamentos") or {})
    return out


# ----------------------------------------------------------------- a venda do ERP (puro)

def tipo_da_parcela(p: dict) -> str:
    return str((((p.get("readjustmentDetail") or {}).get("type")) or {}).get("id") or "")


def parcelas_do_item(venda: dict, item: str) -> list:
    ps = [p for p in ((venda.get("tradeReceivable") or {}).get("installments") or []) if tipo_da_parcela(p) == ITENS[item]["tipo"]]
    return sorted(ps, key=lambda p: (str(p.get("plannedDate") or "")[:10], str(p.get("id") or "")))


def data_do_recibo(r: dict) -> str:
    """[d] (erp.py): o nome do campo da data no recebimento lido de volta."""
    return str(r.get("receivingDate") or r.get("date") or r.get("dateOfReceipt") or "")[:10]


def recibos(p: dict) -> list:
    return [{"id": str(r.get("id") or ""), "valor": _r2(r.get("value")), "data": data_do_recibo(r)}
            for r in (p.get("receipts") or []) if _f(r.get("value")) > 0]


def recebido(p: dict) -> float:
    if p.get("sumOfReceivedValues") is not None:
        return _r2(p.get("sumOfReceivedValues"))
    return _r2(sum(r["valor"] for r in recibos(p)))


def falta_receber(p: dict) -> float:
    return max(0.0, _r2(_f(p.get("plannedValue")) - recebido(p)))


# ----------------------------------------------------------------- 1) alterar as parcelas (puro)

def _mais_dias(iso: str, dias: int) -> str:
    try:
        return (_dt.date.fromisoformat(str(iso)[:10]) + _dt.timedelta(days=dias)).isoformat()
    except ValueError:
        return (_dt.date.today() + _dt.timedelta(days=dias)).isoformat()


def _data_nova(venda: dict, item: str) -> str:
    """Vencimento de uma parcela que o robô cria: a do outro terceiro (FGTS/financiamento) ou data da venda + 30."""
    outro = {"FGTS": "FINANCIAMENTO", "FINANCIAMENTO": "FGTS"}.get(item)
    if outro:
        ps = parcelas_do_item(venda, outro)
        if ps and str(ps[0].get("plannedDate") or ""):
            return str(ps[0]["plannedDate"])[:10]
    base = str(venda.get("date") or (venda.get("tradeReceivable") or {}).get("referenceDate") or "")[:10]
    if item == "SINAL" and RE_ISO.match(base):
        return base
    return _mais_dias(base, R.DIAS_FINANCIAMENTO)


def plano_alteracao(venda: dict, esp: dict) -> dict:
    """O que mudar nas parcelas (só SINAL, FINANCIAMENTO e FGTS). Puro.
    {acao: NADA|ALTERAR, corpo (venda inteira já alterada), mudancas: [{item, parcela, de, para}], recusas: {item: texto},
     avisos: [texto]}"""
    out = {"acao": "NADA", "corpo": None, "mudancas": [], "recusas": {}, "avisos": []}
    corpo = copy.deepcopy(venda)
    tr = corpo.get("tradeReceivable") or {}
    inst = tr.get("installments")
    if not isinstance(inst, list):
        out["recusas"]["_venda"] = "a venda veio sem parcelas do Mais Controle"
        return out
    for item in ORDEM:
        alvo = esp.get(item)
        if alvo is None:
            continue
        ps = [p for p in inst if tipo_da_parcela(p) == ITENS[item]["tipo"]]
        atual = _r2(sum(_f(p.get("plannedValue")) for p in ps))
        if abs(atual - alvo) < CENTAVO:
            continue
        rot = ITENS[item]["rotulo"]
        if not ITENS[item]["altera"]:
            out["avisos"].append("%s: o portal diz %s e o Mais Controle %s — o robô não altera a %s; ajuste à mão" %
                                 (rot, brl(alvo), brl(atual), rot.lower()))
            continue
        if len(ps) > 1:
            out["recusas"][item] = "há %d parcelas de %s no Mais Controle — o robô não decide qual mudar; ajuste à mão" % (len(ps), rot)
            continue
        if alvo <= CENTAVO:
            if ps:
                out["recusas"][item] = ("o portal zerou o %s, mas o Mais Controle tem a parcela de %s — o robô não apaga "
                                        "parcela; remova à mão" % (rot, brl(atual)))
            continue
        if not ps:
            inst.append({"plannedValue": alvo, "plannedDate": _data_nova(venda, item), "comment": None,
                         "readjustmentDetail": {"type": {"id": ITENS[item]["tipo"]}, "table": None,
                                                "rawValue": alvo, "reference": 0}})
            out["mudancas"].append({"item": item, "parcela": None, "de": 0.0, "para": alvo})
            continue
        p = ps[0]
        rd = p.get("readjustmentDetail") or {}
        if rd.get("table"):
            out["recusas"][item] = "a parcela de %s tem índice de reajuste — o robô não altera; ajuste à mão" % rot
            continue
        rec = recebido(p)
        if alvo + CENTAVO < rec:
            out["recusas"][item] = ("o portal diz %s, mas o Mais Controle já recebeu %s nessa parcela — confira os "
                                    "pagamentos antes" % (brl(alvo), brl(rec)))
            continue
        if p.get("received") is True:
            out["recusas"][item] = "a parcela de %s já está quitada no Mais Controle — o robô não reabre; ajuste à mão" % rot
            continue
        p["plannedValue"] = alvo
        rd["rawValue"] = alvo
        p["readjustmentDetail"] = rd
        out["mudancas"].append({"item": item, "parcela": p.get("id"), "de": atual, "para": alvo})
    if not out["mudancas"]:
        return out
    if venda.get("readjustmentEnabled") is not True:
        for m in out["mudancas"]:
            out["recusas"][m["item"]] = "a venda não é do tipo reajustável (a que o robô lança) — ajuste à mão"
        out["mudancas"] = []
        return out
    soma = _r2(sum(_f(p.get("plannedValue")) for p in inst))
    tr["numberOfInstallments"] = len(inst)
    tr["grossValue"] = soma
    tr["value"] = _r2(soma - _f(tr.get("taxWithhold")))
    out.update(acao="ALTERAR", corpo=corpo)
    return out


def _parcelas_por_id(venda: dict) -> dict:
    return {str(p.get("id")): p for p in ((venda.get("tradeReceivable") or {}).get("installments") or []) if p.get("id")}


def mesma_venda(a: dict, b: dict) -> bool:
    """As parcelas (id, valor, vencimento, recebido) são as mesmas — serve para saber se o desfazer voltou tudo."""
    pa, pb = _parcelas_por_id(a), _parcelas_por_id(b)
    if set(pa) != set(pb):
        return False
    for k, p in pa.items():
        q = pb[k]
        if abs(_f(p.get("plannedValue")) - _f(q.get("plannedValue"))) >= CENTAVO or \
                str(p.get("plannedDate") or "")[:10] != str(q.get("plannedDate") or "")[:10] or \
                abs(recebido(p) - recebido(q)) >= CENTAVO:
            return False
    return True


def conferir_alteracao(antes: dict, depois: dict, pl: dict) -> list:
    """Divergências entre a venda relida e o plano (lista vazia = bateu centavo por centavo)."""
    div = []
    pa, pd = _parcelas_por_id(antes), _parcelas_por_id(depois)
    mudou = {m["parcela"]: m for m in pl["mudancas"] if m["parcela"]}
    novas = [m for m in pl["mudancas"] if not m["parcela"]]
    for k, p in pa.items():
        q = pd.get(k)
        if q is None:
            div.append("uma parcela sumiu da venda")
            continue
        alvo = mudou[k]["para"] if k in mudou else _f(p.get("plannedValue"))
        if abs(_f(q.get("plannedValue")) - alvo) >= CENTAVO:
            div.append("parcela com %s no lugar de %s" % (brl(q.get("plannedValue")), brl(alvo)))
        if str(q.get("plannedDate") or "")[:10] != str(p.get("plannedDate") or "")[:10]:
            div.append("o vencimento de uma parcela mudou")
        if abs(recebido(q) - recebido(p)) >= CENTAVO:
            div.append("o recebido de uma parcela mudou")
    extras = [q for k, q in pd.items() if k not in pa]
    for m in novas:
        achou = [q for q in extras if tipo_da_parcela(q) == ITENS[m["item"]]["tipo"] and
                 abs(_f(q.get("plannedValue")) - m["para"]) < CENTAVO]
        if len(achou) != 1:
            div.append("a parcela nova de %s não apareceu como pedida" % ITENS[m["item"]]["rotulo"])
        else:
            extras.remove(achou[0])
    if extras:
        div.append("apareceram %d parcela(s) que o robô não pediu" % len(extras))
    tr = depois.get("tradeReceivable") or {}
    soma = _r2(sum(_f(q.get("plannedValue")) for q in pd.values()))
    if tr.get("grossValue") is not None and abs(_f(tr.get("grossValue")) - soma) >= CENTAVO:
        div.append("o total da venda (%s) não é a soma das parcelas (%s)" % (brl(tr.get("grossValue")), brl(soma)))
    return div


# ----------------------------------------------------------------- 2) baixas (puro)

def plano_baixas(venda: dict, item: str, pags: list, ant: dict) -> dict:
    """Para cada pagamento do portal: já está no MC (pela rodada anterior ou por um recebimento de mesma data e valor)
    ou precisa de baixa (em quais parcelas, quanto em cada). {pagamentos: {pid: {...}}, recusa: texto|None}."""
    ps = parcelas_do_item(venda, item)
    out = {"pagamentos": {}, "recusa": None}
    if not pags:
        return out
    if not ps:
        out["recusa"] = "a venda no Mais Controle não tem parcela de %s" % ITENS[item]["rotulo"]
        return out
    todos = [(str(p.get("id")), r) for p in ps for r in recibos(p)]
    existe = {r["id"] for _, r in todos if r["id"]}
    usados = set()
    pendentes = []
    for pg in pags:
        a = ant.get(pg["id"]) or {}
        ids = [str(x) for x in (a.get("recibos") or []) if str(x)]
        if a.get("situacao") == "BAIXADO" and ids and all(i in existe and i not in usados for i in ids):
            usados.update(ids)
            out["pagamentos"][pg["id"]] = dict(a, situacao="BAIXADO")
            continue
        par = next((r for _, r in todos if r["id"] not in usados and r["data"] == pg["data"] and
                    abs(r["valor"] - pg["valor"]) < CENTAVO), None)
        if par:
            usados.add(par["id"])
            out["pagamentos"][pg["id"]] = {"situacao": "BAIXADO", "texto": "já estava baixado no Mais Controle",
                                           "recibos": [par["id"]] if par["id"] else [], "conta": a.get("conta") or "",
                                           "anexo": a.get("anexo") or ""}
            continue
        pendentes.append(pg)
    sobras = [r for _, r in todos if r["id"] not in usados]
    if pendentes and sobras:
        s = sobras[0]
        out["recusa"] = ("o Mais Controle tem baixa que não está no portal (%s em %s) — confira à mão antes; nada foi baixado "
                         "neste item" % (brl(s["valor"]), data_br(s["data"]) or "data ?"))
        for pg in pendentes:
            out["pagamentos"][pg["id"]] = {"situacao": "RECUSADO", "texto": out["recusa"]}
        return out
    livre = [[str(p.get("id")), falta_receber(p), p] for p in ps]
    for pg in pendentes:
        resto, partes = pg["valor"], []
        for lv in livre:
            if resto < CENTAVO:
                break
            if lv[1] < CENTAVO:
                continue
            v = _r2(min(resto, lv[1]))
            partes.append({"parcela": lv[0], "valor": v})
            lv[1] = _r2(lv[1] - v)
            resto = _r2(resto - v)
        if resto >= CENTAVO:   # devolve o que tinha reservado: este pagamento não entra
            for pt in partes:
                for lv in livre:
                    if lv[0] == pt["parcela"]:
                        lv[1] = _r2(lv[1] + pt["valor"])
            out["pagamentos"][pg["id"]] = {
                "situacao": "RECUSADO",
                "texto": "o pagamento de %s passa do que falta receber de %s no Mais Controle — ajuste o valor esperado "
                         "na aba Recebimentos" % (brl(pg["valor"]), ITENS[item]["rotulo"])}
            continue
        out["pagamentos"][pg["id"]] = {"situacao": "PENDENTE", "partes": partes}
    return out


# ----------------------------------------------------------------- conta bancária pelo comprovante (puro)

def texto_do_arquivo(conteudo: bytes, mime: str) -> str:
    """Texto do comprovante: PDF com camada de texto (pypdf). Foto ou PDF digitalizado: "" (fica a conta padrão)."""
    if not conteudo or "pdf" not in str(mime or "").lower():
        return ""
    try:
        import io
        import pypdf
        leitor = pypdf.PdfReader(io.BytesIO(conteudo))
        return "\n".join((pg.extract_text() or "") for pg in leitor.pages[:4])
    except Exception:   # noqa: BLE001 — sem texto não é erro: a conta padrão fica
        return ""


def _numeros(texto: str) -> set:
    out = set()
    for m in re.finditer(r"\d+(?:[.\-/]\d+)*", texto or ""):
        bloco = m.group(0)
        for x in [re.sub(r"\D", "", bloco)] + re.split(r"[.\-/]", bloco):
            x = x.lstrip("0")
            if x:
                out.add(x)
    return out


def identificar_conta(texto: str, contas: list) -> tuple:
    """(conta, "") quando UMA conta do Mais Controle tem agência E número da conta impressos no comprovante;
    senão (None, motivo). Agência curta (menos de 3 dígitos) ou conta curta (menos de 4) não contam."""
    if not str(texto or "").strip():
        return None, "o comprovante não tem texto legível"
    nums = _numeros(texto)
    achadas = []
    for c in contas or []:
        ag = R.so_digitos(c.get("agency")).lstrip("0")
        ct = R.so_digitos(c.get("account")).lstrip("0")
        ctdv = (R.so_digitos(c.get("account")) + R.so_digitos(c.get("accountDigit"))).lstrip("0")
        if len(ag) < 3 or len(ct) < 4:
            continue
        if ag in nums and (ct in nums or ctdv in nums):
            achadas.append(c)
    if len(achadas) == 1:
        return achadas[0], ""
    return None, ("nenhuma conta do Mais Controle aparece no comprovante" if not achadas
                  else "mais de uma conta do Mais Controle aparece no comprovante")


def conta_padrao(venda: dict, parcela_id: str) -> dict:
    """A conta que já está no Mais Controle: a da parcela, senão a padrão da venda (que veio da obra)."""
    tr = venda.get("tradeReceivable") or {}
    p = _parcelas_por_id(venda).get(str(parcela_id)) or {}
    return p.get("account") or tr.get("defaultAccount") or {}


def nome_anexo(item: str, pg: dict, arquivo: str) -> str:
    ext = os.path.splitext(arquivo or "")[1].lower() or ".pdf"
    return "COMPROVANTE %s %s %s%s" % (item, pg["data"], pg["id"], ext)


# ----------------------------------------------------------------- guardar a venda antes de alterar

def pasta_backup() -> pathlib.Path:
    d = os.environ.get("MC_BACKUP_VENDAS") or os.path.join(
        os.environ.get("MC_CENTRAL") or r"C:\AUTOMAÇÕES MAIS CONTROLE\_central", "backups-vendas")
    p = pathlib.Path(d).resolve()
    if p == RAIZ_REPO or RAIZ_REPO in p.parents:
        raise Recusa("BACKUP_NO_REPOSITORIO", "a pasta do backup da venda fica dentro do repositório (público) — mude MC_BACKUP_VENDAS")
    return p


def guardar_venda(venda: dict, agora: str) -> str:
    """Grava o JSON inteiro da venda FORA do repositório e devolve o caminho. Falhou = não altera nada."""
    p = pasta_backup()
    p.mkdir(parents=True, exist_ok=True)
    arq = p / ("venda-%s-%s.json" % (R.so_hex(venda.get("id")) or "sem-id", re.sub(r"\D", "", agora)[:14]))
    arq.write_text(json.dumps(venda, ensure_ascii=False, indent=1), encoding="utf-8")
    if json.loads(arq.read_text(encoding="utf-8")) != venda:
        raise Recusa("BACKUP_FALHOU", "não consegui guardar a venda antes de alterar")
    return str(arq)


def executar_alteracao(erp, venda_id: str, antes: dict, pl: dict, guardar) -> tuple:
    """Guarda, grava, relê e confere. (True, texto) ou (False, texto). Divergência = grava de volta o JSON guardado."""
    caminho = guardar(antes)
    falha = ""
    try:
        erp.alterar_venda(venda_id, pl["corpo"])
    except ErpErro as e:
        falha = str(e)[:250]
    depois = erp.ler_venda(venda_id)
    if falha and mesma_venda(antes, depois):
        return False, "o Mais Controle recusou a alteração e nada mudou (%s)" % falha
    div = ([("o Mais Controle respondeu erro: " + falha)] if falha else []) + conferir_alteracao(antes, depois, pl)
    if not div:
        return True, "; ".join("%s %s → %s" % (ITENS[m["item"]]["rotulo"], brl(m["de"]) if m["parcela"] else "(parcela nova)",
                                               brl(m["para"])) for m in pl["mudancas"])
    try:
        erp.alterar_venda(venda_id, antes)
        volta = erp.ler_venda(venda_id)
        if mesma_venda(antes, volta):
            return False, "a alteração não ficou como pedida (%s) — DESFEITA: a venda voltou a ser como era" % "; ".join(div[:3])
    except ErpErro as e:
        div.append("o desfazer falhou: %s" % str(e)[:150])
    return False, ("a alteração não ficou como pedida (%s) e o DESFAZER NÃO CONFIRMOU — a venda como era está guardada em %s; "
                   "confira no Mais Controle já" % ("; ".join(div[:3]), caminho))


# ----------------------------------------------------------------- fluxo

def _agora() -> str:
    return _dt.datetime.now().strftime("%Y-%m-%d %H:%M")


def _id_venda(valor) -> str:
    h = R.so_hex(valor)
    if not h:
        raise Recusa("SEM_VENDA_ID", "a casa não tem MC - VENDA ID: lance a venda no Mais Controle antes")
    return "%s-%s-%s-%s-%s" % (h[:8], h[8:12], h[12:16], h[16:20], h[20:])


def processar(page_id: str, notion, erp, aplicar: bool = False, bloqueado: bool = False, agora: str = "",
              guardar=None) -> dict:
    agora = agora or _agora()
    guardar = guardar or (lambda v: guardar_venda(v, agora))
    res = {"situacao": None, "codigo": None, "avisos": []}
    pg = notion.pagina(page_id) or {}
    props = pg.get("properties") or {}
    saida = {"v": 1, "em": agora, "situacao": "", "texto": "", "itens": {}}

    def item_(i):
        return saida["itens"].setdefault(i, {"situacao": "", "texto": "", "pagamentos": {}})

    def fim(situacao, texto, codigo=None):
        saida["situacao"], saida["texto"] = situacao, texto
        res["situacao"], res["codigo"], res["texto"] = situacao, codigo or situacao, texto
        try:
            if not notion.gravar_texto_longo(page_id, props, COL_RESULTADO, json.dumps(saida, ensure_ascii=False,
                                                                                         separators=(",", ":"))):
                res["avisos"].append("COLUNA_FALTANDO")
        except Exception:   # noqa: BLE001 — anotar é complemento; o resultado vai no código
            res["avisos"].append("NOTION_NAO_ANOTADO")
        return res

    try:
        base = R.so_hex(os.environ.get("DB_VENDAS"))
        if base and R.so_hex((pg.get("parent") or {}).get("database_id")) != base:
            raise Recusa("PAGINA_FORA_DE_VENDAS", "os recebimentos só valem para a casa de rua (base VENDAS)")
        vid = _id_venda(_valor(_por_chave(props), COL_VENDA_ID))
        esp = esperados(props)
        pags = pagamentos(props, esp)
        res["avisos"] += pags.pop("_avisos")
        ant = anterior(props)
        for i, v in ant.items():   # se a rodada parar no meio, o que já estava baixado continua anotado
            item_(i)["pagamentos"] = dict(v)
        venda = erp.ler_venda(vid)
        if not venda.get("id"):
            raise Recusa("VENDA_NAO_ENCONTRADA", "o Mais Controle não devolveu a venda (MC - VENDA ID)")
        pre = ("BLOQUEADO: gravar está desligado neste ambiente (trava RECEBIMENTO_APLICAR) — " if bloqueado else "")
        erro = False

        # 1) alteração das parcelas
        pl = plano_alteracao(venda, esp)
        for i, t in pl["recusas"].items():
            if i in ITENS:
                item_(i).update(situacao="RECUSADO", texto=t)
        if pl["avisos"]:
            saida["avisos"] = pl["avisos"]
        if pl["acao"] == "ALTERAR":
            alvo = ", ".join(ITENS[m["item"]]["rotulo"] for m in pl["mudancas"])
            if not aplicar:
                for m in pl["mudancas"]:
                    item_(m["item"]).update(situacao="PREVIA", texto=pre + "alteraria a parcela no Mais Controle: %s → %s" % (
                        brl(m["de"]) if m["parcela"] else "(parcela nova)", brl(m["para"])))
            else:
                ok, texto = executar_alteracao(erp, vid, venda, pl, guardar)
                for m in pl["mudancas"]:
                    item_(m["item"]).update(situacao="ALTERADO" if ok else "ERRO",
                                            texto=("parcela alterada no Mais Controle: %s → %s" % (
                                                brl(m["de"]) if m["parcela"] else "(parcela nova)", brl(m["para"]))) if ok else texto)
                if not ok:
                    return fim("ERRO", "alteração de %s: %s" % (alvo, texto), "ALTERACAO_FALHOU")
                venda = erp.ler_venda(vid)
        # na prévia as baixas são planejadas sobre a venda como ficaria depois da alteração
        venda_plano = pl["corpo"] if (pl["acao"] == "ALTERAR" and not aplicar) else venda

        # 2) baixas do sinal e da entrada
        contas = None
        for item in ORDEM:
            if not ITENS[item]["baixa"]:
                continue
            pb = plano_baixas(venda if aplicar else venda_plano, item, pags.get(item) or [], ant.get(item) or {})
            reg = item_(item)
            reg["pagamentos"] = {}
            if pb["recusa"] and not pb["pagamentos"]:
                reg["pagamentos"] = dict(ant.get(item) or {})
                reg.update(situacao="RECUSADO", texto=pb["recusa"])
                continue
            parou = False
            for pag in pags.get(item) or []:
                d = pb["pagamentos"].get(pag["id"]) or {}
                if d.get("situacao") != "PENDENTE":
                    reg["pagamentos"][pag["id"]] = d
                    continue
                if parou:
                    reg["pagamentos"][pag["id"]] = {"situacao": "AGUARDANDO", "texto": "a baixa anterior não confirmou"}
                    continue
                f = arquivo_do_pagamento(props, item, pag["arquivo"])
                conteudo, mime = b"", ""
                if f:
                    try:
                        conteudo = notion.baixar(f.get("file", {}).get("url") or f.get("external", {}).get("url"))
                        mime = mimetypes.guess_type(str(f.get("name") or ""))[0] or "application/pdf"
                    except Exception:   # noqa: BLE001
                        conteudo = b""
                conta, motivo = None, "sem comprovante"
                if conteudo:
                    if contas is None:
                        try:
                            contas = erp.contas_bancarias()
                        except ErpErro:
                            contas = []
                    conta, motivo = identificar_conta(texto_do_arquivo(conteudo, mime), contas)
                partes = d["partes"]
                ct = conta or conta_padrao(venda, partes[0]["parcela"])
                nome_ct = str(ct.get("name") or "")
                if not ct.get("id"):
                    reg["pagamentos"][pag["id"]] = {"situacao": "ERRO", "texto": "a venda não tem conta padrão no Mais Controle"}
                    erro = parou = True
                    continue
                como = ("conta do comprovante" if conta else "conta padrão (%s)" % motivo)
                if not aplicar:
                    reg["pagamentos"][pag["id"]] = {"situacao": "PREVIA", "conta": nome_ct, "texto": pre + "baixaria %s em %s na %s: %s" % (
                        brl(pag["valor"]), data_br(pag["data"]), como, nome_ct or "?")}
                    continue
                antes_ids = {r["id"] for p in parcelas_do_item(venda, item) for r in recibos(p)}
                antes_rec = {str(p.get("id")): recebido(p) for p in parcelas_do_item(venda, item)}
                try:
                    for pt in partes:
                        erp.receber_parcela(pt["parcela"], pt["valor"], pag["data"], ct["id"], str(getattr(erp, "user_id", "") or ""))
                except ErpErro as e:
                    venda = erp.ler_venda(vid)
                    reg["pagamentos"][pag["id"]] = {"situacao": "ERRO", "texto": "o Mais Controle recusou a baixa (%s) — "
                                                    "confira a venda antes de repetir" % str(e)[:200]}
                    erro = parou = True
                    continue
                venda = erp.ler_venda(vid)
                depois = {str(p.get("id")): p for p in parcelas_do_item(venda, item)}
                bateu = all(abs(recebido(depois.get(pt["parcela"]) or {}) - antes_rec.get(pt["parcela"], 0) - pt["valor"]) < CENTAVO
                            for pt in partes)
                if not bateu:
                    reg["pagamentos"][pag["id"]] = {"situacao": "ERRO", "conta": nome_ct, "texto": (
                        "a baixa foi enviada, mas o recebido da parcela não subiu %s — confira no Mais Controle antes de "
                        "repetir" % brl(pag["valor"]))}
                    erro = parou = True
                    continue
                novos = sorted(r["id"] for p in depois.values() for r in recibos(p) if r["id"] and r["id"] not in antes_ids)
                info = {"situacao": "BAIXADO", "recibos": novos, "conta": nome_ct,
                        "texto": "baixado no Mais Controle em %s (%s)" % (data_br(pag["data"]), como)}
                if conteudo:
                    try:
                        info["anexo"] = erp.anexar_se_faltar(vid, nome_anexo(item, pag, f.get("name")), conteudo, mime)
                    except ErpErro as e:
                        info["anexo"] = "ERRO"
                        info["texto"] += "; o comprovante NÃO foi anexado (%s)" % str(e)[:120]
                reg["pagamentos"][pag["id"]] = info
            sits = [v.get("situacao") for v in reg["pagamentos"].values()]
            if pb["recusa"]:
                reg.update(situacao="RECUSADO", texto=pb["recusa"])
            elif "ERRO" in sits:
                reg.update(situacao="ERRO", texto="uma baixa não deu certo — veja o pagamento")
            elif "RECUSADO" in sits:
                reg.update(situacao="RECUSADO", texto="um pagamento não cabe na parcela do Mais Controle — veja o pagamento")
            elif "PREVIA" in sits:
                reg.update(situacao="PREVIA", texto=pre + "prévia: %d baixa(s) a fazer" % sits.count("PREVIA"))
            elif sits:
                reg.update(situacao="BAIXADO", texto="baixado no Mais Controle (%d pagamento(s))" % len(sits))

        # 3) como ficou cada item no Mais Controle (a tela mostra ao lado do portal)
        for item in ORDEM:
            ps = parcelas_do_item(venda, item)
            reg = item_(item)
            reg["mc"] = {"previsto": _r2(sum(_f(p.get("plannedValue")) for p in ps)), "recebido": _r2(sum(recebido(p) for p in ps)),
                         "parcelas": len(ps)}
            if not reg["situacao"]:
                reg["situacao"] = "OK" if ps or not esp.get(item) else "SEM_PARCELA"
                if reg["situacao"] == "SEM_PARCELA":
                    reg["texto"] = "a venda no Mais Controle não tem parcela de %s" % ITENS[item]["rotulo"]
        if erro:
            return fim("ERRO", "uma baixa não deu certo — veja os itens", "BAIXA_FALHOU")
        if not aplicar:
            return fim("PREVIA", pre + "prévia: nada foi gravado no Mais Controle", "BLOQUEADO" if bloqueado else "PREVIA")
        return fim("OK", "conferido com o Mais Controle", "OK")
    except Recusa as e:
        return fim("RECUSADO", e.texto, e.codigo)


def main(argv=None) -> int:
    from .notion import Notion
    ap = argparse.ArgumentParser()
    ap.add_argument("--page", required=True)
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--bloqueado", action="store_true")
    ap.add_argument("--marcar-erro", default=None)
    a = ap.parse_args(argv)

    def sair(r, cod):
        print(json.dumps({"situacao": r.get("situacao"), "codigo": r.get("codigo"), "avisos": r.get("avisos") or []},
                         ensure_ascii=False))
        return cod

    notion = Notion(os.environ["NOTION_TOKEN"]) if os.environ.get("NOTION_TOKEN") else None

    def anotar(texto, so_se_processando=False):
        if not notion:
            return
        try:
            props = notion.pagina(a.page).get("properties") or {}
            atual = str(_valor(_por_chave(props), COL_RESULTADO) or "")
            if so_se_processando and atual and "PROCESSANDO" not in atual[:80]:
                return
            notion.gravar_texto_longo(a.page, props, COL_RESULTADO, json.dumps(
                {"v": 1, "em": _agora(), "situacao": "ERRO", "texto": texto[:300], "itens": {}}, ensure_ascii=False))
        except Exception:   # noqa: BLE001
            pass

    if a.marcar_erro is not None:
        anotar(a.marcar_erro or "o robô falhou — veja o log do servidor", so_se_processando=True)
        return sair({"situacao": "ERRO", "codigo": "ROBO_FALHOU"}, 1)
    falta = faltam_segredos(("NOTION_TOKEN",))
    if falta:
        anotar("o robô está sem configuração")
        return sair({"situacao": "ERRO", "codigo": "SEM_SEGREDOS"}, 2)
    erp = do_ambiente()
    try:
        r = processar(a.page, notion, erp, aplicar=a.aplicar and not a.bloqueado, bloqueado=a.bloqueado)
    except ErpErro as e:
        anotar("o Mais Controle recusou — " + str(e)[:250] + " — confira a venda no Mais Controle antes de repetir")
        return sair({"situacao": "ERRO", "codigo": "ERP_RECUSOU"}, 1)
    except Exception as e:   # noqa: BLE001 — nunca deixar PROCESSANDO preso
        anotar("falha inesperada (%s) — confira a venda no Mais Controle antes de repetir" % type(e).__name__)
        return sair({"situacao": "ERRO", "codigo": type(e).__name__}, 1)
    return sair(r, 1 if r.get("situacao") == "ERRO" else 0)


if __name__ == "__main__":
    sys.exit(main())
