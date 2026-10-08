# -*- coding: utf-8 -*-
"""Distrato no Mais Controle (entrega 8) — a ÚNICA exceção à regra "a automação nunca altera nem
exclui venda do ERP", aberta pelo dono em 07/10/2026, e só por este caminho: prévia mostrada na
tela, confirmação com senha, e então o robô.

Regra do dono:
- houve sinal/pagamento recebido (RETIDO ou DEVOLVIDO) -> na venda ficam SÓ as parcelas de fato
  recebidas e a descrição ganha " (Distrato)";
- nada foi recebido -> a venda é EXCLUÍDA do ERP.

Uso (o workflow mc-venda.yml chama com acao=distrato):
    python -m venda.mc.distrato --page <id> --recebeu sim --destino retido              # PRÉVIA
    python -m venda.mc.distrato --page <id> --recebeu sim --destino retido --aplicar    # grava (MC_APLICAR=1)
    python -m venda.mc.distrato --page <id> ... --bloqueado    # pediram gravar, MC_APLICAR desligado
    python -m venda.mc.distrato --page <id> --marcar-erro "texto"

A PRÉVIA roda na página da venda (base VENDAS, que ainda tem "MC - VENDA ID") e escreve o texto
em "MC - DISTRATO". O APLICAR roda na página do ARQUIVO do distrato (base DISTRATOS — a linha da
venda já foi limpa pelo portal) e só grava se:
  - a página é da base DB_DISTRATOS (variável do repositório; sem ela, recusa);
  - as respostas (recebeu/destino) do pedido batem com as do arquivo;
  - a assinatura [#xxxxxxxx] recalculada agora bate com a da prévia aceita ("PRÉVIA ACEITA");
  - a venda é reajustável (a rota de exclusão/alteração usada aqui é a da venda reajustável);
  - nenhuma parcela foi recebida em parte, e o que o ERP diz bate com a resposta da tela.

Rotas e o que é [CERTO]/[SUPOSIÇÃO]: venda/mc/DISTRATO-ERP.md.
O log do Actions é PÚBLICO: o stdout leva só situação e códigos."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import sys

from . import regras as R
from .erp import Erp, ErpErro

SUFIXO = " (Distrato)"
COL_VENDA_ID = "MC - VENDA ID"
COL_ESTADO = "MC - DISTRATO"          # texto: prévia/resultado do robô (VENDAS e DISTRATOS)
COL_PREVIA_ACEITA = "PRÉVIA ACEITA"   # texto (DISTRATOS): cópia da prévia que a pessoa confirmou
COL_SINAL = "HOUVE SINAL"             # select SIM / NÃO (DISTRATOS)
COL_DESTINO = "DESTINO DO SINAL"      # select RETIDO / DEVOLVIDO / NÃO HOUVE (DISTRATOS)
CENTAVO = 0.005
DIAS_DEVOLUCAO = 30                   # data padrão da devolução: hoje + 30
QUEM_PAGA = "CLIENT"                  # o mesmo das contas a pagar que o app já lança (guias, aportes)


class Recusa(Exception):
    def __init__(self, codigo: str, texto: str):
        super().__init__(texto)
        self.codigo, self.texto = codigo, texto


# ----------------------------------------------------------------- regra pura

def _f(x) -> float:
    try:
        return float(x or 0)
    except (TypeError, ValueError):
        return 0.0


def tem_recebimento(parc: dict) -> bool:
    """Mesma regra do botão "Remover" do ERP (hasAnyReceipt): algum recebimento com valor, juros ou
    desconto. Também vale o resumo da parcela (received / sumOfReceivedValues)."""
    for r in parc.get("receipts") or []:
        if _f(r.get("value")) > 0 or _f(r.get("interestValue")) > 0 or _f(r.get("discountValue")) > 0:
            return True
    return bool(parc.get("received")) or _f(parc.get("sumOfReceivedValues")) > CENTAVO


def recebida_em_parte(parc: dict) -> bool:
    """Tem recebimento, mas ainda tem saldo em aberto (não está quitada)."""
    if not tem_recebimento(parc) or parc.get("received"):
        return False
    pend = parc.get("pendingValue")
    if pend is None:   # sem o campo: compara o recebido com o previsto
        return _f(parc.get("sumOfReceivedValues")) + CENTAVO < _f(parc.get("plannedValue"))
    return _f(pend) > CENTAVO


def _linha(p: dict) -> dict:
    return {"id": p.get("id"), "data": str(p.get("plannedDate") or "")[:10],
            "valor": round(_f(p.get("plannedValue")), 2),
            "recebido": round(_f(p.get("sumOfReceivedValues")), 2)}


def descricao_nova(desc: str) -> str:
    d = (desc or "").rstrip()
    return d if d.upper().endswith(SUFIXO.strip().upper()) else d + SUFIXO


def normalizar(recebeu: str, destino: str) -> tuple[bool, str]:
    r = R.chave(recebeu)
    if r not in ("SIM", "NAO"):
        raise Recusa("RESPOSTA_INVALIDA", "resposta de \"Houve sinal/pagamento recebido?\" inválida (use sim ou nao)")
    d = R.chave(destino)
    if r == "SIM" and d not in ("RETIDO", "DEVOLVIDO"):
        raise Recusa("RESPOSTA_INVALIDA", "houve recebimento: falta dizer se o valor será RETIDO ou DEVOLVIDO")
    return r == "SIM", (d if r == "SIM" else "")


def plano(venda: dict, recebeu: bool, destino: str = "") -> dict:
    """O que o distrato faria nesta venda do ERP. Puro (não chama nada).
    acao: EXCLUIR | ALTERAR | NADA (já está como o distrato deixa). Recusa -> exceção Recusa."""
    if not venda or not venda.get("id"):
        raise Recusa("VENDA_NAO_ENCONTRADA", "o Mais Controle não devolveu a venda")
    if venda.get("readjustmentEnabled") is not True:
        raise Recusa("VENDA_NAO_REAJUSTAVEL", "a venda não é do tipo reajustável (a que o robô cria); "
                     "faça o distrato dela à mão no Mais Controle")
    tr = venda.get("tradeReceivable") or {}
    parcelas = tr.get("installments")
    if not isinstance(parcelas, list) or not parcelas:
        raise Recusa("VENDA_SEM_PARCELAS", "a venda veio sem parcelas — confira no Mais Controle")
    parciais = [p for p in parcelas if recebida_em_parte(p)]
    if parciais:
        raise Recusa("PARCELA_RECEBIDA_EM_PARTE",
                     "há parcela recebida só em parte (%s) — o robô não decide o que fica dela; "
                     "ajuste à mão no Mais Controle" % ", ".join(_linha(p)["data"] for p in parciais[:5]))
    recebidas = [p for p in parcelas if tem_recebimento(p)]
    abertas = [p for p in parcelas if not tem_recebimento(p)]
    base = {"venda_id": venda["id"], "descricao": venda.get("description") or "",
            "obra": ((venda.get("work") or {}).get("name") or ""), "recebeu": recebeu, "destino": destino,
            "mantidas": [_linha(p) for p in recebidas], "removidas": [_linha(p) for p in abertas],
            "descricao_nova": None, "corpo": None}
    if not recebeu:
        if recebidas:
            raise Recusa("ERP_TEM_RECEBIMENTO",
                         "a tela diz que NÃO houve recebimento, mas o Mais Controle mostra %d parcela(s) recebida(s) "
                         "(R$ %.2f). Se houve sinal, refaça respondendo SIM; se o recebimento foi lançado por engano, "
                         "estorne no Mais Controle antes" % (len(recebidas), sum(x["recebido"] for x in base["mantidas"])))
        return dict(base, acao="EXCLUIR")
    if not recebidas:
        raise Recusa("ERP_SEM_RECEBIMENTO",
                     "a tela diz que HOUVE recebimento, mas nenhuma parcela da venda está recebida no Mais Controle. "
                     "Dê baixa do que foi recebido no Mais Controle e peça a prévia de novo")
    nova = descricao_nova(base["descricao"])
    if not abertas and nova == base["descricao"]:
        return dict(base, acao="NADA", descricao_nova=nova)
    corpo = copy.deepcopy(venda)
    ctr = corpo["tradeReceivable"]
    ids = {p.get("id") for p in recebidas}
    ctr["installments"] = [p for p in ctr["installments"] if p.get("id") in ids]
    soma = round(sum(_f(p.get("plannedValue")) for p in ctr["installments"]), 2)
    ctr["numberOfInstallments"] = len(ctr["installments"])
    ctr["grossValue"] = soma                                   # [SUPOSIÇÃO] ver DISTRATO-ERP.md
    ctr["value"] = round(soma - _f(ctr.get("taxWithhold")), 2)
    corpo["description"] = nova
    return dict(base, acao="ALTERAR", descricao_nova=nova, corpo=corpo)


def _data_iso(s) -> str:
    """'aaaa-mm-dd' ou 'dd/mm/aaaa' -> 'aaaa-mm-dd'; '' se vazio; Recusa se inválida."""
    import datetime as _dt
    t = str(s or "").strip()
    if not t:
        return ""
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return _dt.datetime.strptime(t[:10], fmt).date().isoformat()
        except ValueError:
            pass
    raise Recusa("DATA_INVALIDA", "data da devolução inválida (%s)" % t[:20])


def _valor_num(s):
    """'10.000,50' / '10000.50' / 10000.5 -> 10000.5; None se vazio; Recusa se inválido."""
    if s is None or str(s).strip() == "":
        return None
    if isinstance(s, (int, float)):
        return round(float(s), 2)
    t = str(s).strip().replace("R$", "").replace(" ", "")
    if "," in t:
        t = t.replace(".", "").replace(",", ".")
    try:
        return round(float(t), 2)
    except ValueError:
        raise Recusa("VALOR_INVALIDO", "valor a devolver inválido (%s)" % str(s)[:20])


def plano_devolucao(pl: dict, venda: dict, valor=None, data: str = "", hoje: str = "", categoria_id: str = "",
                    forma_id: str = "", conta: dict | None = None, condicao: dict | None = None,
                    responsavel_id: str = "") -> dict | None:
    """Conta a pagar da devolução do sinal (decisão do dono, 07/10/2026). Só quando o destino é DEVOLVIDO.
    Padrão: valor = total recebido; data = hoje + 30. Puro.
    Devolve {valor, data, corpo|None, aviso|None}. corpo None = a prévia avisa e o resto do distrato segue."""
    import datetime as _dt
    if pl.get("destino") != "DEVOLVIDO":
        return None
    recebido = round(sum(x["recebido"] for x in pl["mantidas"]), 2)
    v = _valor_num(valor)
    v = recebido if v is None else v
    if v <= 0:
        raise Recusa("VALOR_INVALIDO", "valor a devolver tem de ser maior que zero")
    if v > recebido + 0.01:
        raise Recusa("DEVOLVER_MAIS_QUE_RECEBIDO", "valor a devolver (%s) maior que o recebido no Mais Controle (%s)"
                     % (_brl(v), _brl(recebido)))
    base = hoje or _dt.date.today().isoformat()
    d = _data_iso(data) or (_dt.date.fromisoformat(base) + _dt.timedelta(days=DIAS_DEVOLUCAO)).isoformat()
    dev = {"valor": v, "data": d, "corpo": None, "aviso": None}
    cliente = (venda.get("customer") or {}).get("id")
    work = venda.get("work") or {}
    faltas = []
    if not categoria_id:
        faltas.append("falta a variável NATUREZA_DEVOLUCAO_ID (categoria do título) no repositório")
    if not cliente:
        faltas.append("a venda não tem cliente no Mais Controle")
    if not work.get("id"):
        faltas.append("a venda não tem obra no Mais Controle")
    if not (conta or {}).get("id"):
        faltas.append("a obra não tem conta padrão no Mais Controle")
    if not (condicao or {}).get("id"):
        faltas.append("o Mais Controle não tem condição de pagamento à vista")
    if faltas:
        dev["aviso"] = "a conta a pagar da devolução NÃO será lançada: " + "; ".join(faltas) + " — lance à mão"
        return dev
    desc = "DEVOLUÇÃO DE SINAL (Distrato) - " + (pl.get("descricao") or "")[:150]
    corpo = {
        "paymentCondition": {"id": condicao["id"], "type": condicao.get("type") or "IN_CASH",
                             "financing": False, "recurring": False},
        "installments": [{"plannedDate": d, "plannedValue": v, "markedAsPaid": False, "order": 0}],
        "numberOfInstallments": 1,
        "value": v,
        "description": desc,
        "participant": {"id": cliente},
        "referenceDate": d,
        "date": base + "T00:00:00",
        "category": {"id": categoria_id},
        "whoPays": work.get("defaultWhoPays") or QUEM_PAGA,
        "costCentreType": "WORK",
        "costCentreDetails": [{"value": v, "percentage": 100,
                               "work": {"id": work["id"], "name": work.get("name"),
                                        "status": work.get("status") or "IN_PROGRESS"}}],
        "numberPrecision": 2,
        "markedAsPaid": False,             # é conta A PAGAR: a devolução ainda vai ser feita
        "account": {"id": conta["id"], "name": conta.get("name")},
        "freightageValue": 0, "otherValue": 0, "ipiValue": 0, "discountValue": 0,
    }
    if responsavel_id:
        corpo["responsible"] = {"id": responsavel_id}
    if forma_id:
        corpo["paymentMethod"] = {"id": forma_id}
    dev["corpo"] = corpo
    return dev


def assinatura(pl: dict) -> str:
    """8 caracteres que mudam se a venda, a ação, as parcelas mantidas/removidas, a descrição, as
    respostas da tela ou a devolução (valor, data, se será lançada) mudarem entre a prévia e o aplicar."""
    dev = pl.get("devolucao") or {}
    chave = [pl["venda_id"], pl["acao"], sorted(str(x["id"]) for x in pl["mantidas"]),
             sorted(str(x["id"]) for x in pl["removidas"]), pl.get("descricao_nova") or "",
             bool(pl["recebeu"]), pl.get("destino") or ""]
    if dev:   # sem devolução a chave fica igual à de antes (prévias já gravadas continuam valendo)
        chave.append([dev.get("valor"), dev.get("data"), bool(dev.get("corpo"))])
    return hashlib.sha1(json.dumps(chave, ensure_ascii=False).encode("utf-8")).hexdigest()[:8]


def marcador_devolucao(dev: dict | None) -> str:
    """O portal lê isto da prévia para gravar VALOR A DEVOLVER e DATA DA DEVOLUÇÃO no arquivo e
    repassar ao robô no aplicar (assim o aplicar usa exatamente o que a prévia mostrou)."""
    return "[devolver=%.2f em %s]" % (dev["valor"], dev["data"]) if dev else ""


def marcador(recebeu: bool, destino: str) -> str:
    """O que o portal confere antes de aceitar a confirmação: as respostas da prévia."""
    return "[recebeu=%s destino=%s]" % ("sim" if recebeu else "nao", (destino or "-").lower())


def _brl(v: float) -> str:
    return ("R$ %.2f" % v).replace(".", ",")


def _parcs(xs: list[dict], n: int = 6) -> str:
    t = "; ".join("%s %s" % (x["data"], _brl(x["valor"])) for x in xs[:n])
    return t + ("; …" if len(xs) > n else "")


def texto_devolucao(dev: dict | None) -> str:
    if not dev:
        return ""
    if dev.get("corpo"):
        return (" LANÇAR CONTA A PAGAR da devolução: %s para o cliente da venda, vencimento %s, na obra e conta "
                "da venda." % (_brl(dev["valor"]), dev["data"]))
    return " ATENÇÃO: " + (dev.get("aviso") or "a conta a pagar da devolução não será lançada") + "."


def texto_previa(pl: dict) -> str:
    dev = pl.get("devolucao")
    cab = "DISTRATO PRÉVIA OK [#%s] %s%s — venda %s (\"%s\", obra %s): " % (
        assinatura(pl), marcador(pl["recebeu"], pl["destino"]),
        (" " + marcador_devolucao(dev)) if dev else "", pl["venda_id"], pl["descricao"][:70], pl["obra"][:60])
    if pl["acao"] == "EXCLUIR":
        return cab + ("EXCLUIR a venda do Mais Controle — nenhuma parcela recebida; %d parcela(s) em aberto somando %s."
                      % (len(pl["removidas"]), _brl(sum(x["valor"] for x in pl["removidas"]))))
    if pl["acao"] == "NADA":
        return cab + ("a venda já está como o distrato deixa (só parcelas recebidas e \"(Distrato)\" na descrição); "
                      "nada a mudar na venda." + texto_devolucao(dev))
    return cab + ("ALTERAR a venda: MANTER %d parcela(s) recebida(s) (%s); REMOVER %d parcela(s) em aberto somando %s (%s); "
                  "descrição passa a \"%s\". Valor recebido %s.%s" % (
                      len(pl["mantidas"]), _parcs(pl["mantidas"]), len(pl["removidas"]),
                      _brl(sum(x["valor"] for x in pl["removidas"])), _parcs(pl["removidas"]),
                      pl["descricao_nova"][:90], "RETIDO (fica com a empresa)" if pl["destino"] == "RETIDO"
                      else "DEVOLVIDO", texto_devolucao(dev)))


def assinatura_do_texto(texto) -> str | None:
    return R.assinatura_da_situacao(texto)


# ----------------------------------------------------------------- ERP

def ler_venda(erp, venda_id: str) -> dict:
    return erp.pedir("GET", "/sales/%s" % venda_id) or {}


def _sem_excecao(resp, o_que: str) -> None:
    """O site trata como falha uma resposta 200 com 'exception' (ver DISTRATO-ERP.md)."""
    if isinstance(resp, dict) and (resp.get("exception") or resp.get("error")):
        raise ErpErro("%s: o ERP respondeu com erro (%s)" % (o_que, str(resp.get("message") or resp.get("exception"))[:200]))


def condicao_a_vista(erp) -> dict | None:
    """GET /payment-conditions/all — a condição pelo TYPE (o nome muda de instalação para instalação)."""
    for c in erp.pedir("GET", "/payment-conditions/all") or []:
        if c.get("type") == "IN_CASH" or c.get("inCash"):
            return c
    return None


def lancar_devolucao(erp, dev: dict | None) -> str:
    """POST /trade-payables (o mesmo do app nas guias e aportes) e confere relendo. Nunca derruba o distrato
    já aplicado na venda: devolve o trecho do texto dizendo o que aconteceu."""
    if not dev:
        return ""
    if not dev.get("corpo"):
        return "; conta a pagar da devolução NÃO lançada (" + (dev.get("aviso") or "?")[:200] + ")"
    try:
        r = erp.pedir("POST", "/trade-payables", corpo=dev["corpo"], params={"userApprovesSaleCreation": "true"}) or {}
        _sem_excecao(r, "conta a pagar")
        tpid = r.get("id")
        if not tpid:
            return "; conta a pagar da devolução: o ERP não devolveu o id — CONFIRA no Mais Controle antes de lançar à mão"
        depois = erp.pedir("GET", "/trade-payables/%s" % tpid) or {}
        ps = depois.get("installments") or []
        ok = len(ps) == 1 and str(ps[0].get("plannedDate") or "")[:10] == dev["data"] and \
            abs(_f(ps[0].get("plannedValue")) - dev["valor"]) < 0.01
        return "; conta a pagar da devolução LANÇADA (título %s, %s em %s)%s" % (
            tpid, _brl(dev["valor"]), dev["data"], "" if ok else " — mas a releitura não bateu: confira no Mais Controle")
    except ErpErro as e:
        return "; conta a pagar da devolução NÃO lançada (o ERP recusou: %s) — lance à mão" % str(e)[:200]


def executar(erp, pl: dict) -> str:
    """Grava no ERP o que o plano diz e CONFERE relendo. Devolve o texto do resultado."""
    t = _executar_venda(erp, pl)
    return t + lancar_devolucao(erp, pl.get("devolucao"))


def _executar_venda(erp, pl: dict) -> str:
    vid = pl["venda_id"]
    if pl["acao"] == "NADA":
        return "DISTRATO APLICADO — a venda %s já estava como o distrato deixa; nada mudou nela" % vid
    if pl["acao"] == "EXCLUIR":
        _sem_excecao(erp.pedir("DELETE", "/sales/%s" % vid), "exclusão")
        try:
            depois = ler_venda(erp, vid)
        except ErpErro:
            depois = {}
        if depois.get("id"):
            raise ErpErro("o ERP aceitou a exclusão, mas a venda %s ainda abre — confira no Mais Controle" % vid)
        return "DISTRATO APLICADO — venda %s EXCLUÍDA do Mais Controle (%d parcela(s) em aberto)" % (vid, len(pl["removidas"]))
    _sem_excecao(erp.pedir("PUT", "/readjustment-sales/%s" % vid, corpo=pl["corpo"]), "alteração")
    depois = ler_venda(erp, vid)
    ficou = {p.get("id") for p in ((depois.get("tradeReceivable") or {}).get("installments") or [])}
    queria = {x["id"] for x in pl["mantidas"]}
    if ficou != queria or (depois.get("description") or "") != pl["descricao_nova"]:
        raise ErpErro("o ERP aceitou a alteração, mas a venda %s não ficou como a prévia (parcelas: %d de %d; "
                      "descrição %s) — confira no Mais Controle" % (vid, len(ficou), len(queria),
                                                                     "ok" if (depois.get("description") or "") == pl["descricao_nova"] else "diferente"))
    return ("DISTRATO APLICADO — venda %s ALTERADA no Mais Controle: ficaram %d parcela(s) recebida(s), %d em aberto "
            "removida(s); descrição \"%s\"" % (vid, len(pl["mantidas"]), len(pl["removidas"]), pl["descricao_nova"][:90]))


# ----------------------------------------------------------------- fluxo

def _txt(props: dict, nome: str) -> str:
    alvo = R.chave(nome)
    for k, v in (props or {}).items():
        if R.chave(k) == alvo:
            return str(R._valor(v) or "").strip()
    return ""


def _id_limpo(s) -> str:
    return "".join(ch for ch in str(s or "").lower() if ch in "0123456789abcdef")


def processar(page_id: str, notion, erp, recebeu: str, destino: str, aplicar: bool = False,
              bloqueado: bool = False, valor=None, data: str = "", hoje: str = "") -> dict:
    """valor/data: da devolução (só com destino DEVOLVIDO); vazios = padrão (recebido, hoje+30).
    No aplicar o portal repassa os que a prévia mostrou ([devolver=V em D])."""
    res = {"situacao": None, "codigo": None, "avisos": []}
    pg = notion.pagina(page_id) or {}
    props = pg.get("properties") or {}

    def fim(situacao, texto, codigo=None):
        res["situacao"], res["codigo"], res["texto"] = situacao, codigo or situacao, texto
        try:
            if notion.gravar_textos(page_id, props, {COL_ESTADO: texto}):
                res["avisos"].append("COLUNA_FALTANDO")
        except Exception:   # noqa: BLE001 — anotar é complemento; o resultado vai no código
            res["avisos"].append("NOTION_NAO_ANOTADO")
        return res

    try:
        rec, dest = normalizar(recebeu, destino)
        vid = _txt(props, COL_VENDA_ID)
        if not vid:
            raise Recusa("SEM_VENDA_ID", "a página não tem MC - VENDA ID: o robô não sabe qual venda do Mais Controle mexer "
                         "(se a venda foi lançada à mão, faça o distrato dela à mão)")
        if aplicar:
            base = _id_limpo(os.environ.get("DB_DISTRATOS"))
            if not base:
                raise Recusa("SEM_DB_DISTRATOS", "falta a variável DB_DISTRATOS no repositório: sem ela o robô não aplica distrato")
            if _id_limpo((pg.get("parent") or {}).get("database_id")) != base:
                raise Recusa("PAGINA_FORA_DE_DISTRATOS", "o distrato só é aplicado a partir de uma página da base DISTRATOS")
            if R.chave(_txt(props, COL_ESTADO)).startswith("DISTRATO APLICADO"):
                return fim("JA_APLICADO", _txt(props, COL_ESTADO), "JA_APLICADO")
            r_arq, d_arq = normalizar("SIM" if R.chave(_txt(props, COL_SINAL)) == "SIM" else "NAO",
                                      _txt(props, COL_DESTINO))
            if (r_arq, d_arq) != (rec, dest):
                raise Recusa("RESPOSTA_DIFERENTE_DO_ARQUIVO", "as respostas do pedido não batem com as do arquivo do distrato")
        venda = ler_venda(erp, vid)
        pl = plano(venda, rec, dest)
        if dest == "DEVOLVIDO":
            work_id = (venda.get("work") or {}).get("id")
            conta = ((erp.obra(work_id) or {}).get("defaultAccount") or {}) if work_id else {}
            pl["devolucao"] = plano_devolucao(
                pl, venda, valor, data, hoje=hoje, categoria_id=os.environ.get("NATUREZA_DEVOLUCAO_ID", "").strip(),
                forma_id=os.environ.get("FORMA_PAGAMENTO_DEVOLUCAO_ID", "").strip(), conta=conta,
                condicao=condicao_a_vista(erp), responsavel_id=str(getattr(erp, "user_id", "") or ""))
        if not aplicar:
            pre = ("BLOQUEADO: gravar no Mais Controle está desligado neste ambiente (MC_APLICAR) — " if bloqueado else "")
            return fim("PREVIA", pre + texto_previa(pl), "BLOQUEADO" if bloqueado else "PREVIA")
        vista = assinatura_do_texto(_txt(props, COL_PREVIA_ACEITA))
        if not vista or vista != assinatura(pl):
            raise Recusa("PREVIA_DESATUALIZADA", "a venda no Mais Controle mudou depois da prévia (ou não há prévia aceita) — "
                         "nada foi feito; confira e faça o ajuste à mão, ou peça nova prévia")
        return fim("APLICADO", executar(erp, pl), "APLICADO_" + pl["acao"])
    except Recusa as e:
        return fim("RECUSADO", "DISTRATO RECUSADO: " + e.texto, e.codigo)


def main(argv=None) -> int:
    from .notion import Notion
    ap = argparse.ArgumentParser()
    ap.add_argument("--page", required=True)
    ap.add_argument("--recebeu", default="")
    ap.add_argument("--destino", default="")
    ap.add_argument("--valor", default="", help="devolução: valor a devolver (vazio = o recebido)")
    ap.add_argument("--data", default="", help="devolução: vencimento aaaa-mm-dd (vazio = hoje + 30)")
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--bloqueado", action="store_true")
    ap.add_argument("--marcar-erro", default=None)
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
            atual = _txt(props, COL_ESTADO)
            if so_se_processando and atual and not R.chave(atual).startswith("PROCESSANDO"):
                return
            notion.gravar_textos(a.page, props, {COL_ESTADO: "DISTRATO ERRO: " + texto[:300]})
        except Exception:   # noqa: BLE001
            pass

    if a.marcar_erro is not None:
        anotar(a.marcar_erro or "o robô falhou — veja o GitHub Actions", so_se_processando=True)
        return sair({"situacao": "ERRO", "codigo": "WORKFLOW_FALHOU"}, 1)
    falta = [n for n in ("NOTION_TOKEN", "MC_ROBO_EMAIL", "MC_ROBO_SENHA") if not os.environ.get(n)]
    if falta:
        anotar("o robô está sem configuração (segredos do GitHub)")
        return sair({"situacao": "ERRO", "codigo": "SEM_SEGREDOS"}, 2)
    erp = Erp(os.environ["MC_ROBO_EMAIL"].strip(), os.environ["MC_ROBO_SENHA"].strip(chr(13) + chr(10)),
              aparelho=os.environ.get("MC_ROBO_APARELHO", "").strip())
    try:
        res = processar(a.page, notion, erp, a.recebeu, a.destino,
                        aplicar=a.aplicar and not a.bloqueado, bloqueado=a.bloqueado, valor=a.valor, data=a.data)
    except ErpErro as e:
        anotar("o Mais Controle recusou — " + str(e)[:250] + " — confira a venda no Mais Controle antes de repetir")
        return sair({"situacao": "ERRO", "codigo": "ERP_RECUSOU"}, 1)
    except Exception as e:   # noqa: BLE001 — nunca deixar PROCESSANDO preso
        anotar("falha inesperada (%s) — confira a venda no Mais Controle antes de repetir" % type(e).__name__)
        return sair({"situacao": "ERRO", "codigo": type(e).__name__}, 1)
    return sair(res, 0 if res.get("situacao") in ("PREVIA", "APLICADO", "JA_APLICADO") else 1)


if __name__ == "__main__":
    sys.exit(main())
