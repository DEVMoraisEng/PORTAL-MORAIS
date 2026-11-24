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
    chave = json.dumps({k: plano.get(k) for k in ("parcelas", "favorecido_id", "comissao", "ja_lancado", "pix")},
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
MAX_PAGINAS_DIA = 10          # payable-installments de UM dia: mais que isso = lista incompleta, recusa
_RE_LANCADA = re.compile(r"^LANÇADA \| título (\S+) \| R\$ ([\d.]+,\d{2})")
_RE_ROTULO_PIX = re.compile(r"^(CHAVE ALEAT[OÓ]RIA|ALEAT[OÓ]RIA|E-?MAIL|CPF|CNPJ|TELEFONE|CELULAR)(?:\s*:\s*|\s+)(.+)$",
                            re.I)
_ROTULOS = {"CHAVE ALEATORIA": "ALEATÓRIA", "ALEATORIA": "ALEATÓRIA", "EMAIL": "E-MAIL", "E-MAIL": "E-MAIL",
            "CPF": "CPF", "CNPJ": "CNPJ", "TELEFONE": "TELEFONE", "CELULAR": "TELEFONE"}


def _hoje() -> str:
    return _dt.date.today().isoformat()


def _agora() -> str:
    return _dt.datetime.now().strftime("%d/%m %H:%M")


def pix_da_chave(texto) -> str | None:
    """Chave solta (ou já com o tipo na frente) -> "<TIPO>: <chave>"; None se vazia.
    Tipo: @ = E-MAIL; + = TELEFONE; só dígitos: 14 = CNPJ, 11 = CPF se o CPF for válido (senão TELEFONE),
    10 = TELEFONE; o resto = ALEATÓRIA."""
    s = " ".join(str(texto or "").split()).strip(" :")
    if not s:
        return None
    m = _RE_ROTULO_PIX.match(s)
    if m:
        return "%s: %s" % (_ROTULOS[R.chave(m.group(1))], m.group(2).strip())
    if "@" in s:
        tipo = "E-MAIL"
    elif s.startswith("+"):
        tipo = "TELEFONE"
    elif re.fullmatch(r"[\d.\-/() ]+", s):
        d = R.so_digitos(s)
        tipo = {14: "CNPJ", 10: "TELEFONE"}.get(len(d)) or (
            ("CPF" if R.cpf_valido(d) else "TELEFONE") if len(d) == 11 else "ALEATÓRIA")
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
    """As linhas `LANÇADA | …` da coluna: nunca se apagam (são o que já foi lançado)."""
    return [ln for ln in str(texto or "").split("\n") if ln.startswith("LANÇADA |")]


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


def titulos_no_erp(erp, casa: int, datas) -> set:
    """Ids dos títulos A PAGAR com descrição "COMISSÃO CORRETOR UNIDADE NN…" vencendo em cada dia pedido.
    Uma consulta por dia (nunca varrer meses). Parcela sem id do título entra como "" (= desconhecido)."""
    prefixo = R.chave("COMISSÃO CORRETOR UNIDADE %02d" % casa)
    ids = set()
    for d in sorted(set(datas)):
        pagina = 0
        while True:
            j = erp.pedir("GET", "/payable-installments/paginated-result", params={
                "page": pagina, "size": 3000, "type": "ALL", "onlyWork": "false", "dateField": "PLANNED",
                "costCentreType": "ALL", "conciliationType": "ALL", "tradePayableType": "ALL",
                "batchOperationType": "NONE", "startDate": d, "endDate": d})
            if not isinstance(j, dict):
                raise ErpErro("lista de contas a pagar em formato inesperado")
            for x in j.get("content") or []:
                desc = R.chave(x.get("description"))
                if desc.startswith(prefixo) and not desc[len(prefixo):len(prefixo) + 1].isdigit():
                    ids.add(str(x.get("tradePayableId") or x.get("launchId") or ""))
            if not j.get("hasNextPage"):
                break
            pagina += 1
            if pagina >= MAX_PAGINAS_DIA:
                raise ErpErro("contas a pagar de %s com páginas demais; parei para não decidir com lista incompleta" % d)
    return ids


def _doc(p: dict) -> str:
    return R.so_digitos(p.get("cpf")) or R.so_digitos(p.get("cnpj"))


def candidatos(erp, cpf: str | None, email: str | None) -> list[dict]:
    """Corretor pelo CPF + fornecedores com o mesmo e-mail (a imobiliária dele). Únicos, só ACTIVE.
    Da busca por e-mail, cadastro que traz outro e-mail fica de fora (a busca do ERP é por trecho)."""
    out, vistos = [], set()
    achados = list(erp.participantes_por_documento(cpf) or []) if cpf else []
    if email:
        alvo = email.strip().lower()
        for p in _lista(erp.pedir("GET", "/participants", params={"role": "SUPPLIER", "keyword": email, "page": 0,
                                                                   "size": 20, "sort": "name"})):
            if p.get("email") and str(p["email"]).strip().lower() != alvo:
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
            achadas.append({"documento": R.so_digitos(R._valor(por.get("CPF/CNPJ"))),
                            "pix": pix_da_chave(R._valor(por.get("CHAVE PIX")))})
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
                                                       _fmt_doc(_doc(c)), c.get("_pix") or "sem Pix") for c in cands]


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

    def gravar(texto) -> None:
        if len(texto) > LIMITE_COLUNA and hasattr(notion, "gravar_texto_longo"):
            if not notion.gravar_texto_longo(page_id, ctx["props"], COL_ESTADO, texto):
                res["avisos"].append("COLUNA_FALTANDO")
        elif notion.gravar_textos(page_id, ctx["props"], {COL_ESTADO: texto}):
            res["avisos"].append("COLUNA_FALTANDO")

    def fim(situacao, bloco, codigo=None, depois=(), obrigatorio=False):
        texto = "\n".join(([bloco] if bloco else []) + ctx["hist"] + list(depois))
        res["situacao"], res["codigo"], res["texto"] = situacao, codigo or situacao, texto
        for tentativa in range(2 if obrigatorio else 1):
            try:
                gravar(texto)
                break
            except Exception:   # noqa: BLE001 — anotar é complemento; o resultado vai no código
                if tentativa == (1 if obrigatorio else 0):
                    res["avisos"].append("NOTION_NAO_ANOTADO")
                    if obrigatorio:
                        res["codigo"] = "LANCADA_SEM_ANOTAR"
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

        # 3. já lançado: a coluna manda; título no ERP que a coluna não conhece = recusa
        ja, ids_coluna = ja_da_coluna(ctx["hist"])
        fora = titulos_no_erp(erp, d["casa"], [p["data"] for p in parcelas]) - ids_coluna
        if fora:
            raise Recusa("TITULO_FORA_DA_COLUNA", "o Mais Controle já tem título de comissão desta unidade num dos "
                         "vencimentos pedidos que a coluna MC - COMISSÃO não registra (lançado à mão?) — confira")

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
            c["_pix"] = pix_do_banco(c.get("bankAccount"))
            if not c["_pix"] and _doc(c):
                if cad is None:
                    cad = _cadastro_corretor(notion, d.get("corretor")) or {}
                # a chave do cadastro de corretores é do corretor: só vale para o cadastro com o documento dele
                if cad.get("pix") and _doc(c) in {R.so_digitos(contato.get("documento")), cad.get("documento")}:
                    c["_pix"] = cad["pix"]
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
                 "Saldo da comissão: %s de %s" % (reais(saldo), reais(comissao))] + _linhas_candidatos(cands)),
                "ESCOLHER_FAVORECIDO")

        # 6. Pix
        pix = fav.get("_pix")
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
                 "pix": pix}
        assin = assinatura(plano)

        # 8. prévia
        if not aplicar:
            linhas = ["PRÉVIA OK [#%s] | %s" % (assin, desc),
                      "Favorecido: %s | %s" % (" ".join(str(fav.get("name") or "").split()), _fmt_doc(_doc(fav))),
                      "Pix: " + pix,
                      "Parcelas: " + _parcelas_txt(parcelas),
                      "Conta: " + str(conta.get("name") or conta["id"]),
                      "Saldo da comissão: %s de %s" % (reais(saldo), reais(comissao))]
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

    # POST uma vez só; dali em diante nada repete o POST
    try:
        r = erp.pedir("POST", "/trade-payables", corpo=corpo, params={"userApprovesSaleCreation": "true"})
    except ErpErro as e:
        if re.search(r"HTTP 4\d\d", str(e)):
            return fim("RECUSADO", "ERRO: o Mais Controle recusou o título (%s) — nada foi lançado; CONFIRA no Mais "
                       "Controle antes de pedir de novo" % str(e)[:250], "ERP_RECUSOU")
        r = None
    except Exception:   # noqa: BLE001 — rede caiu no meio: pode ter gravado
        r = None
    tpid = r.get("id") if isinstance(r, dict) else None
    if not tpid:
        return fim("INCERTO", "INCERTO: o Mais Controle não devolveu o id — CONFIRA antes de repetir (o título pode "
                   "ter sido criado; procure \"%s\")" % desc, "INCERTO")

    total = round(sum(p["valor"] for p in parcelas), 2)
    k, bate = 0, False
    try:
        enviados = 0
        for i, p in enumerate(parcelas, 1):
            try:
                pdf = recibo(_linhas_recibo(d, venda, cliente, fav, pix, comissao, p, i, n), TITULO_RECIBO)
                if erp.anexar_titulo(str(tpid), nome_recibo(d["casa"], p, i, n), pdf) < 300:
                    enviados += 1
            except Exception:   # noqa: BLE001 — recibo que não subiu aparece em "recibos: k/n"
                res["avisos"].append("RECIBO_NAO_ANEXADO")
        k = enviados
        try:
            conf = erp.pedir_core("GET", "/attachments/v2", params={"entityIds": tpid, "entityOrigin": "TRADE_PAYABLE"})
            if isinstance(conf, list):
                k = len(conf)
        except Exception:   # noqa: BLE001
            res["avisos"].append("ANEXOS_NAO_CONFERIDOS")
        bate = _releitura_bate(erp.pedir("GET", "/trade-payables/%s" % tpid) or {}, parcelas, total, fav["id"])
    except Exception:   # noqa: BLE001 — o título existe: a linha LANÇADA sai de qualquer jeito
        bate = False
    linha = "LANÇADA | título %s | %s | %d parcela(s) | recibos: %d/%d | %s" % (tpid, reais(total), n, k, n, _agora())
    if not bate:
        linha += " — releitura NÃO bateu: confira no Mais Controle"
    return fim("LANCADA", "", "LANCADA", depois=[linha], obrigatorio=True)


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
        print(json.dumps({"situacao": res.get("situacao"), "codigo": res.get("codigo"),
                          "avisos": res.get("avisos") or []}, ensure_ascii=False))
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
            notion.gravar_textos(a.page, props, {COL_ESTADO: "\n".join(["ERRO: " + texto[:300]] + _historico(atual))})
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
