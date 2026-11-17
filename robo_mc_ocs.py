#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
robo_mc_ocs.py — PORTAL-MORAIS (16/11/2026) · CONFERÊNCIA DE COMPRAS (OC) no Mapa de Obras

Pedido do dono (16/11/2026, documento "automação 1"): o pagamento de algumas OCs só sai depois que o engenheiro
confirma, no Mapa de Obras, que a entrega/serviço foi finalizado. Cada OC nova destes fornecedores vira um alerta
OBRA · FORNECEDOR · Nº OC · DATA DA OC · ENGENHEIRO · SERVIÇO FINALIZADO? (SIM/NÃO). Com o SIM o robô faz, no MC:

  ROBÔ 1 — conferência da ENTREGA (Rocha Mármores e Granitos, VIDRO ALVES)        ação "APROVAR"
      (16/11, dono) OC aprovada no MC e SEM lançamento volta para "Aguardando aprovação" e vira alerta;
      na OC: Aprovação  "Em aberto / aguardando aprovação"  →  "Aprovado"
             e depois Status da Compra  →  "Aguardando".
      OC que já está aprovada no MC não é mexida (nem o status da compra: não volta "Entregue" para "Aguardando").
  ROBÔ 2 — conferência do SERVIÇO (Serralheria do Fabio)                          ação "PARCELA"
      no lançamento da OC ($ Lançamento › Ir para lançamento › Editar lançamento):
      vencimento da 2ª PARCELA  →  próximo DIA ÚTIL depois do dia em que o engenheiro marcou SIM
      (se esse dia já passou, o próximo dia útil a partir de hoje). Parcela já paga não é mexida.

Os dois rodam juntos neste script (uma aba do porteiro só, um de cada vez no Mais Controle):
    python servidor\\robo_fila.py --robo ocs
  1. lê as OCs no GraphQL de Compras do MC — o MESMO pedido que a tela Compras › Ordem de Compra faz (o robô copia
     a consulta e os filtros da própria tela, como o robô de medidores faz com as solicitações);
  2. guarda as OCs dos fornecedores acima (criadas a partir de OCS_A_PARTIR_DE e, da Rocha / VIDRO ALVES, também as
     ANTIGAS ainda sem lançamento e sem aprovação — últimos OCS_ANTIGAS_MESES meses) na tabela oc_conferencia do
     Supabase ORÇADO/REALIZADO — o Mapa de Obras lê dali pelo Apps Script (ações ocLista / ocResponder);
  3. para cada OC com SIM e ainda não feita, faz a mudança no MC PELA TELA (os mesmos campos e botões que uma
     pessoa usa), confere relendo a tela e grava o resultado na linha (FEITO / ERRO / SIMULADO).

TRAVA DE GRAVAR NO ERP — só do dono: o arquivo  _central\\OCS_APLICAR.txt  (vazio). Sem ele o robô SIMULA: abre a
OC (e o lançamento), acha os campos, escreve na linha o que faria e NÃO salva nada. O ROBOS_APLICAR.txt dos outros
robôs não liga este (de propósito: este mexe em aprovação e pagamento).

MODOS
  DESCOBRIR=1   só formato, nada gravado (nem no Supabase): a consulta que a tela faz, a forma dos campos de uma
                OC, os fornecedores e os códigos de aprovação/status que aparecem; e, com OCS_EXEMPLO=<nº da OC>,
                os rótulos, listas e botões da tela de edição dessa OC (e da janela de lançamento).
  OCS_SO=<nº>   só esta OC nas ações (para a primeira vez de verdade, com cuidado).

Roda NO SERVIDOR pela aba do Chrome do porteiro (MC_VIA=porteiro) — sem login nenhum; porteiro fora = para e avisa.
Precisa de SUPABASE_URL e SUPABASE_SERVICE_KEY (o robo_fila.py põe, como no robô de anexos).
Saída: última linha = resumo; código 0 tudo certo, 1 alguma OC deu erro ou a leitura falhou.
Pode rodar duas vezes seguidas: OC já aprovada / parcela já com a data certa = FEITO sem mexer de novo.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

# ------------------------------------------------------------------------------------------- configuração
CENTRAL = pathlib.Path(os.environ.get("MC_CENTRAL") or r"C:\AUTOMAÇÕES MAIS CONTROLE\_central")
CHAVE_APLICAR = CENTRAL / "OCS_APLICAR.txt"
DESCOBRIR = os.environ.get("DESCOBRIR", "").strip().lower() in ("1", "true", "sim")
EXEMPLO = os.environ.get("OCS_EXEMPLO", "").strip()
SO = os.environ.get("OCS_SO", "").strip()
#: 16/11 (dono): o alerta vale para as OCs GERADAS daqui para frente — as antigas já foram pagas/conferidas à mão.
A_PARTIR_DE = os.environ.get("OCS_A_PARTIR_DE", "2026-11-16").strip()
#: 16/11 (dono, tarde): também entram as OCs ANTIGAS da Rocha / VIDRO ALVES que ainda NÃO têm lançamento criado (o
#: pagamento não saiu) e ainda não foram aprovadas — com o SIM o robô aprova igual. Até quantos meses para trás:
ANTIGAS_MESES = int(os.environ.get("OCS_ANTIGAS_MESES") or 6)
#: OC antiga em que a lista não diz se tem lançamento: o robô abre "$ Lançamento" na tela. No máximo isto por rodada
#: (as que têm lançamento ficam anotadas em _central\ocs-com-lancamento.json e não são abertas de novo).
MAX_CONFERIR = int(os.environ.get("OCS_MAX_CONFERIR") or 30)
COM_LANCAMENTO = CENTRAL / "ocs-com-lancamento.json"
#: 16/11 (dono, depois da 1ª descoberta): as OCs da Rocha / VIDRO ALVES já chegam "Aprovado" no MC. As que NÃO têm
#: lançamento voltam para "Aguardando aprovação" (o pagamento fica esperando o SIM do engenheiro). No máximo isto por rodada.
MAX_VOLTAR = int(os.environ.get("OCS_MAX_VOLTAR") or 40)
#: 16/11 (dono, tarde): arquivo na aba "Arquivos" da OC = NF anexada → a linha fica VERMELHA no mapa com "NF anexada".
#: Confere toda OC da conferência ainda não feita (no máximo isto por rodada).
MAX_ANEXOS = int(os.environ.get("OCS_MAX_ANEXOS") or 200)
LEGACY = "https://legacy-api.maiscontroleerp.com.br/maiscontrole/services"
CORE = "https://prod-erp-api.maiscontroleerp.com.br"
MAX_TENTATIVAS = 3          # ERRO volta a ser tentado até aqui; depois fica para fazer à mão (o mapa mostra)
TABELA = "oc_conferencia"
MC = "https://acessar.maiscontroleerp.com.br/"
HOST_COMPRAS = "z8brf7qvn1.execute-api.us-east-1.amazonaws.com"      # GraphQL de Compras (o mesmo das solicitações)

#: fornecedor (como está no MC, sem acento e em maiúsculas — basta conter) → ação
FORNECEDORES = {
    "ROCHA MARMORES E GRANITOS": "APROVAR",
    "VIDRO ALVES": "APROVAR",
    "SERRALHERIA DO FABIO": "PARCELA",
}

APROVADO = {"APPROVED", "APROVADO", "APROVADA"}
CANCELADA = {"CANCELED", "CANCELLED", "CANCELADO", "CANCELADA", "REJECTED", "REFUSED", "REPROVADO", "REPROVADA",
             "RECUSADO", "RECUSADA", "DENIED", "NEGADO", "NEGADA"}


#: 16/11: a saída só aparecia no fim (a fila guarda o stdout) — este arquivo mostra, linha a linha, onde o robô está
AO_VIVO = CENTRAL / "logs" / "ocs-ao-vivo.txt"
#: 16/11: 1ª rodada gravando ficou parada >20 min sem dizer onde. Passou disto, o robô sai sozinho com o passo na
#: última linha (a fila só derrubava em 40 min e sem guardar a saída).
LIMITE_S = int(os.environ.get("OCS_LIMITE_S") or 25 * 60)
_PASSO = {"txt": "começando"}


def log(*a):
    print(*a, flush=True)
    try:
        with open(AO_VIVO, "a", encoding="utf-8") as f:
            f.write("%s %s\n" % (time.strftime("%H:%M:%S"), " ".join(str(x) for x in a)))
    except Exception:       # noqa: BLE001 — o arquivo é só para acompanhar
        pass


def passo(txt: str) -> None:
    """Marca onde o robô está (vai para o ocs-ao-vivo.txt e para a mensagem se o tempo estourar)."""
    _PASSO["txt"] = txt
    try:
        with open(AO_VIVO, "a", encoding="utf-8") as f:
            f.write("%s   … %s\n" % (time.strftime("%H:%M:%S"), txt))
    except Exception:       # noqa: BLE001
        pass


def vigia(limite_s: int = LIMITE_S):
    """Relógio de segurança: se a rodada passar de `limite_s`, imprime o passo onde parou e encerra (código 1).
    Não fecha o Chrome central (os._exit não passa pelo aba.fechar) — no máximo sobra a aba do robô aberta."""
    import threading

    def estourou():
        log("FALHOU: a rodada passou de %d min parada em: %s" % (limite_s // 60, _PASSO["txt"]))
        os._exit(1)
    t = threading.Timer(limite_s, estourou)
    t.daemon = True
    t.start()
    return t


def N(s) -> str:
    s = unicodedata.normalize("NFD", str(s if s is not None else ""))
    return " ".join("".join(c for c in s if unicodedata.category(c) != "Mn").upper().split())


def acao_do_fornecedor(nome) -> tuple[str, str] | None:
    """('ROCHA MARMORES E GRANITOS', 'APROVAR') ou None. Aceita sufixo/razão social ("… LTDA", "… - ME")."""
    n = N(nome)
    if not n:
        return None
    extra = os.environ.get("OCS_FORNECEDORES", "")       # "NOME=ACAO;NOME=ACAO" (opcional, sem mexer no código)
    tabela = dict(FORNECEDORES)
    for par in extra.split(";"):
        if "=" in par:
            k, v = par.split("=", 1)
            if N(v) in ("APROVAR", "PARCELA") and N(k):
                tabela[N(k)] = N(v)
    for chave, acao in tabela.items():
        if chave in n:
            return chave, acao
    return None


# ------------------------------------------------------------------------------------------- dias úteis
def pascoa(ano: int) -> dt.date:
    a, b, c = ano % 19, ano // 100, ano % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l_ = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l_) // 451
    mes = (h + l_ - 7 * m + 114) // 31
    dia = ((h + l_ - 7 * m + 114) % 31) + 1
    return dt.date(ano, mes, dia)


def feriados(ano: int) -> set:
    """Feriados nacionais + os móveis em que banco não abre (carnaval, sexta-feira santa, Corpus Christi)."""
    fixos = {(1, 1), (4, 21), (5, 1), (9, 7), (10, 12), (11, 2), (11, 15), (11, 20), (12, 25)}
    p = pascoa(ano)
    moveis = {p - dt.timedelta(days=48), p - dt.timedelta(days=47), p - dt.timedelta(days=2), p + dt.timedelta(days=60)}
    return {dt.date(ano, m, d) for m, d in fixos} | moveis


def dia_util(d: dt.date) -> bool:
    return d.weekday() < 5 and d not in feriados(d.year)


def proximo_dia_util(d: dt.date) -> dt.date:
    d = d + dt.timedelta(days=1)
    while not dia_util(d):
        d += dt.timedelta(days=1)
    return d


def data_da_parcela(marcado: dt.date, hoje: dt.date) -> dt.date:
    """Próximo dia útil depois do SIM. Se o robô chegou atrasado e esse dia já passou: o próximo dia útil a partir
    de hoje (hoje mesmo, se for útil) — nunca uma data no passado."""
    alvo = proximo_dia_util(marcado)
    if alvo < hoje:
        alvo = hoje if dia_util(hoje) else proximo_dia_util(hoje)
    return alvo


def dia_local(iso: str | None) -> dt.date | None:
    """'2026-11-16T21:30:00+00:00' (respondido_em, UTC) → a data em Goiânia (UTC-3)."""
    if not iso:
        return None
    try:
        t = dt.datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return None
    if t.tzinfo is None:
        return t.date()
    return (t.astimezone(dt.timezone(dt.timedelta(hours=-3)))).date()


def br(d: dt.date) -> str:
    return d.strftime("%d/%m/%Y")


def mesma_data(texto, d: dt.date) -> bool:
    """O valor do campo (dd/mm/aaaa ou AAAA-MM-DD) é o dia d?"""
    t = str(texto or "").strip()
    return t in (br(d), d.isoformat())


# ------------------------------------------------------------------------------------------- OC do GraphQL
_CH_FORN = re.compile(r"supplier|participant|provider|vendor|fornec|seller", re.I)
_CH_OBRA = re.compile(r"work|obra|costcent|cost_cent", re.I)
_CH_LANC = re.compile(r"payable|lancament|installment|financial", re.I)
_NOMES = ("name", "nome", "tradeName", "fantasyName", "companyName", "corporateName", "description", "title")


def _nome(v) -> str:
    """Nome de um objeto do GraphQL (fornecedor, obra): name / person.name / … — ou o próprio texto."""
    if isinstance(v, str):
        return v.strip()
    if isinstance(v, dict):
        for k in _NOMES:
            if isinstance(v.get(k), str) and v[k].strip():
                return v[k].strip()
        for k in ("person", "participant", "company", "work", "task"):
            if isinstance(v.get(k), dict):
                x = _nome(v[k])
                if x:
                    return x
    return ""


def _primeiro(no: dict, chaves) -> object:
    for k in chaves:
        if k in no and no[k] not in (None, ""):
            return no[k]
    return None


def oc_do_no(no: dict) -> dict:
    """Campos que importam de uma OC (nó da lista do GraphQL), sem depender do nome exato de cada campo."""
    forn = ""
    for k, v in no.items():
        if _CH_FORN.search(k):
            forn = _nome(v)
            if forn:
                break
    obras = []

    def achar_obras(x, prof=0):
        if prof > 3:
            return
        if isinstance(x, dict):
            for k, v in x.items():
                if _CH_OBRA.search(k):
                    if isinstance(v, list):
                        for it in v:
                            nm = _nome(it.get("work")) if isinstance(it, dict) and isinstance(it.get("work"), dict) else _nome(it)
                            if nm and nm not in obras:
                                obras.append(nm)
                    else:
                        nm = _nome(v)
                        if nm and nm not in obras:
                            obras.append(nm)
                elif isinstance(v, (dict, list)) and not _CH_FORN.search(k):
                    achar_obras(v, prof + 1)
        elif isinstance(x, list):
            for it in x[:20]:
                achar_obras(it, prof + 1)
    achar_obras(no)
    num = _primeiro(no, ("number", "code", "numero"))
    try:
        num = int(num) if num is not None else None
    except (TypeError, ValueError):
        num = None
    tem_lanc = None                 # True/False se a lista diz; None = a lista não traz (o robô confere na tela)
    for k, v in no.items():
        if _CH_LANC.search(k) and not _CH_FORN.search(k):
            if isinstance(v, bool):
                tem_lanc = v
            elif isinstance(v, (list, dict)):
                tem_lanc = bool(v)
            elif isinstance(v, (int, float)):
                tem_lanc = v > 0
            elif v is None:
                tem_lanc = False
            if tem_lanc:
                break
    criada = str(_primeiro(no, ("creationDate", "createdAt", "creationDateTime", "createdDate", "date")) or "")[:10]
    aprov = str(_primeiro(no, ("approvalStatus", "approval", "approvalSituation")) or "")
    status = str(_primeiro(no, ("purchaseStatus", "deliveryStatus", "status", "situation")) or "")
    return {"oc_id": str(no.get("id") or ""), "numero": num, "fornecedor": forn,
            "obra": " · ".join(obras)[:300] or None,
            "descricao": str(_primeiro(no, ("description", "title")) or "")[:300] or None,
            "criada_em": criada if re.match(r"^\d{4}-\d\d-\d\d$", criada) else None,
            "aprovacao_mc": aprov.upper() or None, "status_compra_mc": status.upper() or None,
            "cancelada": N(aprov) in CANCELADA or N(status) in CANCELADA, "tem_lancamento": tem_lanc,
            # 16/11: a lista já diz se a aba Arquivos tem algo (hasAnyFile) — só abre as pastas de quem tem
            "tem_arquivo": no.get("hasAnyFile") if isinstance(no.get("hasAnyFile"), bool) else None}


def antigas_desde(hoje: dt.date | None = None) -> str:
    hoje = hoje or dt.date.today()
    m = hoje.month - ANTIGAS_MESES
    ano, mes = hoje.year + (m - 1) // 12, (m - 1) % 12 + 1
    return dt.date(ano, mes, 1).isoformat()


def interessa(oc: dict, desde: str = A_PARTIR_DE, antigas: str | None = None) -> tuple[str, str, bool] | None:
    """(fornecedor da lista, ação, antiga?) se a OC pode entrar na conferência; None se não.
    Nova = criada a partir de `desde`. Antiga = de `antigas` até `desde`, só de APROVAR (Rocha / VIDRO ALVES) e só se
    não tiver lançamento (a lista dizendo que tem, fica fora; sem saber, quem chama confere na tela)."""
    if not oc.get("oc_id") or not re.match(r"^[0-9a-fA-F-]{36}$", oc["oc_id"]):
        return None
    f = acao_do_fornecedor(oc.get("fornecedor"))
    if not f:
        return None
    if not oc.get("criada_em") or oc["criada_em"] >= desde:
        return f[0], f[1], False
    if f[1] != "APROVAR" or oc["criada_em"] < (antigas or antigas_desde()) or oc.get("tem_lancamento") is True:
        return None
    return f[0], f[1], True


def linhas_novas_e_atualizadas(ocs: list, existentes: dict, sem_lancamento=None,
                               antigas: str | None = None) -> tuple[list, list]:
    """(novas, atualizar). OC de APROVAR que já está APROVADA no MC só entra se NÃO tiver lançamento (16/11: o robô
    volta ela para "Aguardando aprovação" — ver para_voltar).
    OC antiga em que a lista não diz se há lançamento: `sem_lancamento(oc)` decide (True = entra; None = não deu para
    saber agora, fica para a próxima rodada). A linha que já existe só recebe os campos do MC — nunca a resposta."""
    novas, atual = [], []
    agora = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    for oc in ocs:
        f = interessa(oc, antigas=antigas) if oc.get("oc_id") not in existentes else \
            (acao_do_fornecedor(oc.get("fornecedor")) or (None, None)) + (False,)
        if not f or not f[0]:
            continue
        mc = {k: oc.get(k) for k in ("numero", "obra", "descricao", "criada_em", "aprovacao_mc", "status_compra_mc",
                                     "cancelada")}
        mc["visto_em"] = agora
        if oc["oc_id"] in existentes:
            # 16/11: o upsert do PostgREST é um INSERT … ON CONFLICT — o Postgres confere NOT NULL (fornecedor, acao)
            # antes do conflito. Sem eles, a linha que já existe dava HTTP 400 (23502). Vão sempre, iguais aos de antes.
            reg = existentes[oc["oc_id"]] or {}
            atual.append(dict(mc, oc_id=oc["oc_id"], fornecedor=reg.get("fornecedor") or oc.get("fornecedor") or f[0],
                              acao=reg.get("acao") or f[1]))
            continue
        if oc.get("cancelada"):
            continue
        if f[1] == "APROVAR" and N(oc.get("aprovacao_mc")) in APROVADO:
            # 16/11 (dono): aprovada SEM lançamento entra (o robô volta para "Aguardando aprovação"); com lançamento, não
            if oc.get("tem_lancamento") is True:
                continue
            if oc.get("tem_lancamento") is None and not (sem_lancamento and sem_lancamento(oc)):
                continue
        elif f[2] and oc.get("tem_lancamento") is None and not (sem_lancamento and sem_lancamento(oc)):
            continue
        novas.append(dict(mc, oc_id=oc["oc_id"], fornecedor=oc.get("fornecedor") or f[0], acao=f[1]))
    return novas, atual


def para_voltar(ocs: list, existentes: dict, novas: list, antigas: str | None = None) -> list:
    """OCs da Rocha / VIDRO ALVES que o robô volta para "Aguardando aprovação": na conferência, sem lançamento, APROVADAS
    no MC, não canceladas, sem SIM do engenheiro e ainda não feitas pelo robô. Decide pelo estado do MC a cada rodada
    (se alguém aprovar de novo à mão antes do SIM, volta de novo)."""
    na_conf = dict(existentes)
    for x in novas:
        na_conf.setdefault(x["oc_id"], {"acao": x["acao"], "resposta": None, "robo_situacao": None})
    lim = antigas or antigas_desde()
    out = []
    for oc in ocs:
        reg = na_conf.get(oc.get("oc_id"))
        if not reg or reg.get("acao") != "APROVAR" or reg.get("resposta") == "SIM" or reg.get("robo_situacao") == "FEITO":
            continue
        if oc.get("cancelada") or oc.get("tem_lancamento") is not False or N(oc.get("aprovacao_mc")) not in APROVADO:
            continue
        if oc.get("criada_em") and oc["criada_em"] < lim:
            continue
        out.append(oc)
    return sorted(out, key=lambda o: (o.get("criada_em") or "", o.get("numero") or 0))


# ------------------------------------------------------------------------------------------- Supabase
class Supa:
    def __init__(self, url: str, chave: str):
        self.url, self.chave = url.rstrip("/"), chave

    @classmethod
    def do_ambiente(cls) -> "Supa":
        url, chave = os.environ.get("SUPABASE_URL", "").strip(), os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
        if not url or not chave:
            raise RuntimeError("falta SUPABASE_URL / SUPABASE_SERVICE_KEY (chave \"robos\" do robos-portal.json: "
                               "supabase_key_arquivo e vars.SUPABASE_URL)")
        return cls(url, chave)

    def pedir(self, metodo: str, caminho: str, corpo=None, prefer: str = ""):
        cab = {"apikey": self.chave, "Authorization": "Bearer " + self.chave, "Accept": "application/json"}
        if corpo is not None:
            cab["Content-Type"] = "application/json"
        if prefer:
            cab["Prefer"] = prefer
        req = urllib.request.Request(self.url + "/rest/v1/" + caminho, method=metodo, headers=cab,
                                     data=json.dumps(corpo).encode("utf-8") if corpo is not None else None)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                txt = r.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            corpo_erro = e.read().decode("utf-8", "replace")[:300]
            if e.code == 404 and TABELA in corpo_erro:
                raise RuntimeError("a tabela %s não existe no Supabase — rode supabase/oc_conferencia.sql no SQL Editor"
                                   % TABELA) from None
            raise RuntimeError("Supabase HTTP %s em %s: %s" % (e.code, caminho.split("?")[0], corpo_erro)) from None
        return json.loads(txt) if txt.strip() else None

    def existentes(self) -> dict:
        l = self.pedir("GET", TABELA + "?select=oc_id,fornecedor,acao,resposta,robo_situacao&limit=5000") or []
        return {x["oc_id"]: x for x in l}

    def gravar(self, linhas: list) -> None:
        """Upsert por oc_id. O PostgREST exige as MESMAS chaves em todas as linhas de um lote: agrupa por chaves
        (a conferida tem os anexos). Toda linha leva fornecedor e acao (NOT NULL — o INSERT do upsert confere)."""
        grupos: dict = {}
        for ln in linhas:
            grupos.setdefault(tuple(sorted(ln)), []).append(ln)
        for lote in grupos.values():
            for i in range(0, len(lote), 200):
                self.pedir("POST", TABELA + "?on_conflict=oc_id", lote[i:i + 200],
                           prefer="resolution=merge-duplicates,return=minimal")

    def pendentes(self) -> list:
        """SIM do engenheiro, OC não cancelada, robô ainda não fez (ou simulou / errou menos de MAX_TENTATIVAS)."""
        q = (TABELA + "?resposta=eq.SIM&cancelada=is.false&or=(robo_situacao.is.null,robo_situacao.eq.SIMULADO,"
             "and(robo_situacao.eq.ERRO,robo_tentativas.lt.%d))&order=respondido_em.asc&limit=100" % MAX_TENTATIVAS)
        return self.pedir("GET", q) or []

    def resultado(self, linha: dict, situacao: str, msg: str) -> None:
        """Só grava se a resposta ainda é SIM (o engenheiro pode ter voltado para NÃO enquanto o robô trabalhava)."""
        corpo = {"robo_situacao": situacao, "robo_msg": str(msg)[:500],
                 "robo_em": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}
        if situacao == "ERRO":
            corpo["robo_tentativas"] = int(linha.get("robo_tentativas") or 0) + 1
        self.pedir("PATCH", TABELA + "?oc_id=eq.%s&resposta=eq.SIM" % linha["oc_id"], corpo, prefer="return=minimal")


# ------------------------------------------------------------------------------------------- leitura das OCs
def _cursor(v: dict) -> bool:
    return "first" in v or "after" in v


def _com_data(orig, dia: dt.date) -> str:
    orig = str(orig or "")
    return dia.isoformat() + (orig[10:] if re.match(r"^\d{4}-\d\d-\d\d", orig) else "")


def _lista_da_resposta(j: dict) -> tuple[list, dict]:
    """(nós, pageInfo) do 1º campo de data que tenha nodes/edges/items."""
    for v in ((j or {}).get("data") or {}).values():
        if isinstance(v, dict):
            if isinstance(v.get("nodes"), list):
                return v["nodes"], v.get("pageInfo") or {}
            if isinstance(v.get("edges"), list):
                return [e.get("node") or {} for e in v["edges"]], v.get("pageInfo") or {}
            if isinstance(v.get("items"), list):
                return v["items"], v.get("pageInfo") or {}
        if isinstance(v, list):
            return v, {}
    return [], {}


_ESTATICO = re.compile(r"\.(js|css|png|jpe?g|gif|svg|woff2?|ttf|ico|map)(\?|$)", re.I)
_RAIZ_GQL = re.compile(r"\{\s*(\w+)\s*[({]")
VISTOS_TELA: list = []          # 16/11: o que a tela Ordem de Compra pediu (para a descoberta e para o erro)


def _host_de(url: str) -> str:
    return url.split("://", 1)[-1].split("/", 1)[0].lower()


def _caminho_de(url: str) -> str:
    return "/" + url.split("://", 1)[-1].split("/", 1)[-1].split("?", 1)[0]


def _resumo_pedido(metodo: str, url: str, corpo: str) -> str:
    """'POST host /caminho [graphql: raiz1, raiz2]' — só nomes, nunca dados."""
    extra = ""
    if "/graphql" in url and corpo:
        try:
            q = (json.loads(corpo) or {}).get("query") or ""
        except Exception:
            q = ""
        raizes = [r for r in _RAIZ_GQL.findall(q) if r not in ("query", "mutation")][:4]
        extra = " [graphql: %s]" % ", ".join(raizes or ["?"])
    return "%s %s %s%s" % (metodo, _host_de(url), re.sub(r"[0-9a-f]{8}-[0-9a-f-]{27}", "{id}", _caminho_de(url)), extra)


def _lista_rest(j) -> list:
    """Lista de OCs numa resposta REST: a própria lista ou content/items/data/list/result."""
    if isinstance(j, list):
        return j
    if isinstance(j, dict):
        for k in ("content", "items", "data", "list", "result", "results", "purchaseOrders"):
            if isinstance(j.get(k), list):
                return j[k]
    return []


def capturar_lista(aba) -> dict:
    """Abre Compras › Ordem de Compra na aba do porteiro e guarda o pedido que a TELA fez para listar as OCs.
    16/11 (1ª rodada no servidor): a tela NÃO pediu `purchaseOrder(` com pageInfo ao GraphQL de Compras — então aceita
    os dois jeitos: GraphQL (qualquer consulta com "purchaseOrder" que devolva uma lista) ou REST do MC (rota com
    "purchase-order" que devolva uma lista de objetos com id). Guarda TUDO que a tela pediu em VISTOS_TELA."""
    page = aba._page
    pedidos, respostas = [], []
    VISTOS_TELA.clear()

    def ouvir(req):
        try:
            if _ESTATICO.search(req.url) or req.resource_type in ("image", "font", "stylesheet", "script", "document"):
                return
            h = _host_de(req.url)
            if "maiscontroleerp.com.br" not in h and "execute-api" not in h:
                return
            pedidos.append(req)
            r = _resumo_pedido(req.method, req.url, req.post_data or "")
            if r not in VISTOS_TELA and len(VISTOS_TELA) < 80:
                VISTOS_TELA.append(r)
        except Exception:
            pass

    def ouvir_resp(resp):
        try:
            if resp.request in pedidos:
                respostas.append(resp)
        except Exception:
            pass

    def escolher():
        for resp in list(respostas):
            rq = resp.request
            url, corpo = rq.url, rq.post_data or ""
            try:
                if resp.status >= 300:
                    continue
                if "/graphql" in url:
                    if not re.search(r"purchaseorder", corpo, re.I):
                        continue
                    j = json.loads(corpo) or {}
                    nos, _info = _lista_da_resposta(resp.json())
                    if nos and isinstance(nos[0], dict):
                        return {"tipo": "graphql", "url": url, "query": j.get("query") or "", "vars": j.get("variables") or {},
                                "cab": {k: v for k, v in (rq.headers or {}).items() if k.lower() in ("authorization", "company-id")}}
                elif "purchase-order" in url and "get-buyers" not in url:
                    lst = _lista_rest(resp.json())
                    if lst and isinstance(lst[0], dict) and lst[0].get("id"):
                        return {"tipo": "rest", "url": url, "metodo": rq.method, "corpo": corpo, "host": _host_de(url)}
            except Exception:
                continue
        return None

    page.context.on("request", ouvir)
    page.context.on("response", ouvir_resp)
    achado = None
    try:
        page.evaluate("() => { location.hash = '#/home' }")
        page.wait_for_timeout(1500)
        page.evaluate("h => { location.hash = h }", "#/purchase-order")
        for passo in range(3):
            for _ in range(60):
                page.wait_for_timeout(250)
                achado = escolher()
                if achado:
                    break
            if achado:
                break
            # a lista pode só vir depois de um clique (o robô dos medidores precisou do "Carregar mais")
            for nome in (("Pesquisar", "Buscar", "Filtrar"), ("Carregar mais",), ("Todas", "Todos"))[passo]:
                try:
                    alvo = page.get_by_text(re.compile(r"^\s*%s\s*$" % nome, re.I))
                    if alvo.count() and alvo.first.is_visible():
                        alvo.first.click(timeout=4000)
                        VISTOS_TELA.append("(cliquei em %s)" % nome)
                        break
                except Exception:
                    pass
    finally:
        for ev, f in (("request", ouvir), ("response", ouvir_resp)):
            try:
                page.context.remove_listener(ev, f)
            except Exception:
                pass
    if not achado:
        for linha in VISTOS_TELA:
            log("   a tela pediu: %s" % linha)
        raise RuntimeError("a tela Ordem de Compra não mostrou de onde vem a lista de OCs (%d pedido(s) vistos, "
                           "listados acima) — mande esta saída para o Claude" % len(VISTOS_TELA))
    if achado["tipo"] == "rest":
        achado["cab"] = aba.cabecalhos(achado["host"])
    return achado


def _maior_pagina(url: str, corpo: str) -> tuple[str, str]:
    """Pede páginas grandes: size/pageSize/limit → 200 na URL e no corpo JSON."""
    url2 = re.sub(r"([?&](?:size|pageSize|limit|perPage)=)\d+", lambda m: m.group(1) + "200", url)
    corpo2 = corpo
    try:
        j = json.loads(corpo) if corpo else None
        if isinstance(j, dict):
            for k in ("size", "pageSize", "limit", "perPage"):
                if isinstance(j.get(k), int):
                    j[k] = 200
            corpo2 = json.dumps(j)
    except Exception:
        pass
    return url2, corpo2


def _ler_rest(aba, visto: dict) -> tuple[list, dict]:
    url, corpo = _maior_pagina(visto["url"], visto.get("corpo") or "")
    todas, ids, est = [], set(), {"paginas": 0, "ocs": 0, "cursor": False, "fonte": "rest " + _caminho_de(url)}
    for _pagina in range(40):
        st, txt = aba.fetch(visto["metodo"], url, visto["cab"], json.loads(corpo) if corpo else None)
        if st >= 300:
            raise RuntimeError("o Mais Controle respondeu HTTP %s na lista de OCs: %s" % (st, (txt or "")[:200]))
        j = json.loads(txt or "null")
        lst = _lista_rest(j)
        est["paginas"] += 1
        novos = 0
        for no in lst:
            if isinstance(no, dict) and no.get("id") not in ids:
                ids.add(no.get("id"))
                todas.append(no)
                novos += 1
        mais = isinstance(j, dict) and (j.get("last") is False or j.get("hasNext") is True or j.get("hasNextPage") is True)
        m = re.search(r"([?&](?:page|pageIndex|pageNumber)=)(\d+)", url)
        if not mais or not novos or not m:
            break
        url = url[:m.start(2)] + str(int(m.group(2)) + 1) + url[m.end(2):]
    est["ocs"] = len(todas)
    return todas, est


def ler_ocs(aba, desde: str | None = None, hoje: dt.date | None = None) -> tuple[list, dict]:
    hoje = hoje or dt.date.today()
    desde = desde or min(A_PARTIR_DE, antigas_desde(hoje))
    visto = capturar_lista(aba)
    if visto["tipo"] == "rest":
        return _ler_rest(aba, visto)
    v = json.loads(json.dumps(visto["vars"]))
    esp = v.get("specification") if isinstance(v.get("specification"), dict) else None
    if esp is not None:
        for k in list(esp):
            if re.search(r"daterange|creationdate", k, re.I) and isinstance(esp[k], dict):
                ini = dt.date.fromisoformat(desde) - dt.timedelta(days=1)
                esp[k] = {"start": _com_data(esp[k].get("start"), ini),
                          "end": _com_data(esp[k].get("end"), hoje + dt.timedelta(days=1))}
        # 16/11 (1ª descoberta): a tela manda specification.startDate / endDate soltos
        ini = dt.date.fromisoformat(desde) - dt.timedelta(days=1)
        if esp.get("startDate"):
            esp["startDate"] = _com_data(esp["startDate"], ini)
        if esp.get("endDate"):
            esp["endDate"] = _com_data(esp["endDate"], hoje + dt.timedelta(days=1))
        for k in ("keyword", "search", "text"):
            esp.pop(k, None)
    cursor = _cursor(v)
    if cursor:
        v["after"] = None
        if "$first" in visto["query"]:
            v["first"] = 50
    # 16/11: a consulta da tela traz "first: 10" escrito na própria consulta (205 páginas para 2047 OCs) — tenta 40;
    # se o MC recusar (PAGINATION_MAX_ITEMS), desce pela metade até 10 (o que a própria tela usa)
    if "$first" not in visto["query"]:
        visto = dict(visto, query=re.sub(r"\bfirst:\s*\d+", "first: 40", visto["query"], count=1))
    est = {"paginas": 0, "ocs": 0, "cursor": cursor, "fonte": "graphql"}
    todas, ids = [], set()
    for _ in range(400):
        st, txt = aba.fetch("POST", visto["url"], visto["cab"], {"query": visto["query"], "variables": v})
        if st >= 300:
            raise RuntimeError("GraphQL de Compras respondeu HTTP %s: %s" % (st, (txt or "")[:200]))
        j = json.loads(txt or "{}")
        if j.get("errors"):
            if "PAGINATION_MAX_ITEMS" in str(j["errors"]):
                if "$first" in visto["query"] and v.get("first", 0) > 5:
                    v["first"] = max(5, v["first"] // 2)
                    continue
                # 16/11 (1ª simulação): "first: 50" na consulta passou do máximo do MC — volta até o que a tela usa (10)
                m = re.search(r"\bfirst:\s*(\d+)", visto["query"])
                if m and int(m.group(1)) > 10:
                    novo = max(10, int(m.group(1)) // 2)
                    visto = dict(visto, query=visto["query"][:m.start(1)] + str(novo) + visto["query"][m.end(1):])
                    continue
            raise RuntimeError("GraphQL de Compras recusou a lista de OCs: %s" % str(j["errors"])[:300])
        nos, info = _lista_da_resposta(j)
        est["paginas"] += 1
        for no in nos:
            if isinstance(no, dict) and no.get("id") not in ids:
                ids.add(no.get("id"))
                todas.append(no)
        if not cursor or not info.get("hasNextPage") or not info.get("endCursor"):
            break
        v["after"] = info["endCursor"]
    est["ocs"] = len(todas)
    return todas, est


# ------------------------------------------------------------------------------------------- tela (Playwright)
#: acha o controle (select / ui-select / combobox / input) ligado a um RÓTULO da tela e marca com data-robo-oc
_JS_CAMPO = r"""([rotulo, marca, dentro]) => {
  const N = s => (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[:*]/g," ").replace(/\s+/g," ").trim();
  const alvo = N(rotulo), raiz = dentro ? document.querySelector('[data-robo-oc="'+dentro+'"]') : document;
  if (!raiz) return null;
  const vis = e => !!(e && (e.offsetWidth || e.offsetHeight || e.getClientRects().length));
  const rots = [...raiz.querySelectorAll("label, span, div, p, small, b, strong, th, td, h5, h6")]
      .filter(e => vis(e) && N(e.textContent) === alvo && [...e.children].every(c => N(c.textContent) !== alvo));
  const depois = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  for (const el of rots) {
    let box = el;
    for (let i = 0; i < 5 && box; i++, box = box.parentElement) {
      const c = [...box.querySelectorAll("select, .ui-select-container, [role=combobox], input:not([type=checkbox]):not([type=hidden])")]
          .find(x => vis(x) && depois(el, x) && !(x.tagName === "INPUT" && x.closest(".ui-select-container")));
      if (c) {
        c.setAttribute("data-robo-oc", marca);
        let atual = "", opcoes = [];
        if (c.tagName === "SELECT") {
          opcoes = [...c.options].map(o => o.textContent.trim()).filter(Boolean);
          atual = c.selectedIndex >= 0 ? c.options[c.selectedIndex].textContent.trim() : "";
        } else if (c.tagName === "INPUT") {
          atual = c.value || "";
        } else {
          const m = c.querySelector(".ui-select-match-text, .ui-select-match, [class*=singleValue], [class*=single-value]");
          atual = ((m || c).innerText || "").trim();
        }
        return {tag: c.tagName.toLowerCase(), tipo: c.getAttribute("type") || "", atual, opcoes,
                desabilitado: !!(c.disabled || c.getAttribute("aria-disabled") === "true" || c.readOnly)};
      }
    }
  }
  return null;
}"""

#: o bloco de uma parcela ("Parcela 2") na janela Editar lançamento: vencimento, valor e "Pago"
_JS_PARCELA = r"""([n, marca]) => {
  const N = s => (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/\s+/g," ").trim();
  const vis = e => !!(e && (e.offsetWidth || e.offsetHeight || e.getClientRects().length));
  const ehRot = e => vis(e) && /^PARCELA \d+$/.test(N(e.textContent)) && [...e.children].every(c => !/^PARCELA \d+$/.test(N(c.textContent)));
  const rotulos = [...document.querySelectorAll("b, strong, span, div, p, label, h6, td")].filter(ehRot);
  const total = new Set(rotulos.map(e => N(e.textContent))).size;
  const el = rotulos.find(e => N(e.textContent) === "PARCELA " + n);
  if (!el) return {vencimento: null, parcelas: total};
  let box = el;
  for (let i = 0; i < 6 && box; i++, box = box.parentElement) {
    if (rotulos.some(o => o !== el && box.contains(o))) break;     // subiu demais: pegou o bloco de outra parcela
    const ins = [...box.querySelectorAll("input")].filter(x => x.type !== "hidden" && x.type !== "checkbox" && vis(x));
    if (ins.length) {
      const venc = ins[0];
      venc.setAttribute("data-robo-oc", marca);
      const ck = box.querySelector("input[type=checkbox]");
      const chip = el.nextElementSibling ? N(el.nextElementSibling.innerText) : "";
      return {vencimento: venc.value || "", tipo: venc.type || "", desabilitado: !!(venc.disabled || venc.readOnly),
              pago: ck ? !!ck.checked : chip.indexOf("PAGO") >= 0, chip_pago: chip.indexOf("PAGO") >= 0, parcelas: total};
    }
  }
  return {vencimento: null, parcelas: total};
}"""

_JS_BOTOES = r"""() => [...document.querySelectorAll('button, a.btn, [role=button]')]
  .filter(b => b.offsetWidth || b.offsetHeight).map(b => (b.innerText || b.title || '').trim().replace(/\s+/g, ' '))
  .filter(t => t && t.length < 50).slice(0, 80)"""

_JS_ROTULOS = r"""() => {
  const out = [];
  document.querySelectorAll('label, .control-label, b, strong').forEach(e => {
    const t = (e.innerText || '').trim().replace(/\s+/g, ' ');
    if (t && t.length < 40 && (e.offsetWidth || e.offsetHeight) && out.indexOf(t) < 0) out.push(t); });
  const sels = [...document.querySelectorAll('select')].filter(s => s.offsetWidth || s.offsetHeight)
    .map(s => [...s.options].map(o => o.textContent.trim()).filter(Boolean).slice(0, 15));
  const uis = document.querySelectorAll('.ui-select-container').length;
  return {rotulos: out.slice(0, 80), selects: sels, ui_selects: uis};
}"""


class Tela:
    """A aba do porteiro como uma pessoa usa: abrir a OC, escolher nas listas, clicar, ler de volta."""

    def __init__(self, aba, page=None, escritas: list | None = None):
        self.aba, self.page = aba, page or aba._page
        self.escritas: list = escritas if escritas is not None else []
        self._ruins: list = []

        def ouvir(resp):
            try:
                rq = resp.request
                if rq.method in ("POST", "PUT", "PATCH", "DELETE") and "maiscontroleerp.com.br" in resp.url \
                        and "api-data-event" not in resp.url and "/graphql" not in resp.url:
                    caminho = "/" + resp.url.split("://", 1)[-1].split("/", 1)[-1].split("?", 1)[0]
                    caminho = re.sub(r"[0-9a-f]{8}-[0-9a-f-]{27}", "{id}", caminho)
                    self.escritas.append((rq.method, caminho, resp.status))
                    if resp.status >= 400:      # 17/11: o motivo vem no corpo (lido fora do evento, em gravou)
                        self._ruins.append((len(self.escritas) - 1, resp))
            except Exception:
                pass
        self.page.on("response", ouvir)

        def janela(d):
            """16/11: janela nativa (confirm/alert) depois de Salvar trava a página até alguém responder — o robô
            responde OK (é a confirmação da ação que ele mesmo pediu) e anota o texto."""
            try:
                log("   janela do MC: \"%s\" → OK" % (d.message or "")[:150])
                d.accept()
            except Exception:       # noqa: BLE001
                pass
        self.page.on("dialog", janela)
        self.page.set_default_timeout(30000)

    def ir(self, hash_: str, esperar_texto: str = "", seg: float = 40) -> None:
        self.page.evaluate("() => { location.hash = '#/home' }")
        self.page.wait_for_timeout(1200)
        self.page.evaluate("h => { location.hash = h }", hash_)
        if esperar_texto:
            self.esperar_texto(esperar_texto, seg)
        self.page.wait_for_timeout(1500)

    def esperar_texto(self, texto: str, seg: float = 40) -> bool:
        limite = time.monotonic() + seg
        while time.monotonic() < limite:
            try:
                if N(texto) in N(self.page.evaluate("() => document.body ? document.body.innerText : ''")):
                    return True
            except Exception:
                pass
            self.page.wait_for_timeout(400)
        return False

    def abrir_oc(self, oc_id: str) -> None:
        """17/11: com o servidor lento (rodada das 14:30) a OC não abriu em 65 s — tenta de novo recarregando a
        página e esperando mais; se ainda não abrir, guarda a foto da tela e para (sem mexer em nada)."""
        for tentativa in (1, 2):
            if tentativa == 2:
                log("   a OC demorou a abrir — recarregando e tentando de novo")
                try:
                    self.page.reload(wait_until="domcontentloaded", timeout=60000)
                    self.page.wait_for_timeout(3000)
                except Exception:       # noqa: BLE001
                    pass
            self.ir("#/purchase-order/edit/%s" % oc_id, "Aprova", 45 if tentativa == 1 else 90)
            if self.esperar_texto("Fornecedor", 20 if tentativa == 1 else 40):
                return
        o_que = foto_da_tela(self, "abrir-" + str(oc_id)[:8])
        raise RuntimeError("a tela da OC não abriu (sem o campo Fornecedor), nem recarregando (%s)" % o_que)

    def campo(self, rotulo: str, marca: str, dentro: str = "") -> dict | None:
        return self.page.evaluate(_JS_CAMPO, [rotulo, marca, dentro])

    def escolher(self, marca: str, info: dict, opcao: str) -> None:
        loc = self.page.locator('[data-robo-oc="%s"]' % marca).first
        if info.get("tag") == "select":
            certo = next((o for o in info.get("opcoes") or [] if N(o) == N(opcao)), None)
            if not certo:
                raise RuntimeError("a lista não tem a opção \"%s\" (tem: %s)" % (opcao, ", ".join(info.get("opcoes") or [])))
            loc.select_option(label=certo)
            return
        loc.click()
        self.page.wait_for_timeout(600)
        alvo = self.page.locator(".ui-select-choices-row, [role=option], li, .dropdown-item, .select2-result") \
            .filter(has_text=re.compile(r"^\s*%s\s*$" % re.escape(opcao), re.I))
        if not alvo.count():
            raise RuntimeError("não achei a opção \"%s\" na lista" % opcao)
        alvo.first.click()

    def clicar_botao(self, texto: str, exato: bool = True) -> None:
        padrao = re.compile((r"^\W*%s\W*$" if exato else r"%s") % re.escape(texto), re.I)
        b = self.page.locator("button, a.btn, [role=button]").filter(has_text=padrao)
        n = b.count()
        for i in range(n):
            if b.nth(i).is_visible():
                b.nth(i).click()
                return
        raise RuntimeError("não achei o botão \"%s\"" % texto)

    def confirmar_se_perguntar(self) -> None:
        """Janela de confirmação que algumas telas abrem depois de Salvar/Aprovar ("Sim", "Confirmar", "OK")."""
        self.page.wait_for_timeout(900)
        for t in ("Sim", "Confirmar", "OK", "Ok"):
            b = self.page.locator(".modal.in button, .modal.show button, [role=dialog] button, .swal2-confirm") \
                .filter(has_text=re.compile(r"^\s*%s\s*$" % t))
            if b.count() and b.first.is_visible():
                b.first.click()
                self.page.wait_for_timeout(900)
                return

    def gravou(self, desde: int) -> tuple[bool, str]:
        novas = self.escritas[desde:]
        if not novas:
            return False, "a tela não mandou nada ao Mais Controle"
        ruins = [x for x in novas if x[2] >= 400]
        txt = ", ".join("%s %s → %s" % x for x in novas[:4])
        motivos = []
        for i, resp in self._ruins:
            if i >= desde:
                try:
                    corpo = re.sub(r"\s+", " ", resp.text() or "")[:250]
                except Exception:       # noqa: BLE001
                    corpo = ""
                if corpo:
                    motivos.append("MC respondeu %s: %s" % (resp.status, corpo))
        if motivos:
            txt += " — " + " | ".join(motivos[:2])
        return (not ruins), txt


def _sim(info: dict | None, opcao: str) -> bool:
    return bool(info) and N(info.get("atual")) == N(opcao)


def _status_compra(tela: Tela, seg: float = 10):
    """Espera o campo Status da Compra aparecer (ele só aparece com a OC aprovada)."""
    limite = time.monotonic() + seg
    while True:
        stc = tela.campo("Status da Compra", "stcompra")
        if stc or time.monotonic() >= limite:
            return stc
        tela.page.wait_for_timeout(500)


def aprovar(tela: Tela, linha: dict, aplicar: bool) -> tuple[str, str]:
    """ROBÔ 1: Aprovação → Aprovado; depois Status da Compra → Aguardando. Devolve (situação, mensagem).
    17/11: no MC escolher na lista Aprovação já grava (PATCH update-approval-status) e o Status da Compra só aparece
    depois — por isso o robô aprova, salva, REABRE a OC e só então mexe no Status da Compra."""
    num = linha.get("numero")
    passo("OC %s (aprovar): abrindo a OC" % num)
    tela.abrir_oc(linha["oc_id"])
    ap = tela.campo("Aprovação", "aprov")
    if not ap:
        raise RuntimeError("não achei o campo Aprovação na OC")
    if N(ap["atual"]) in ("REPROVADO", "REPROVADA", "CANCELADO", "CANCELADA", "RECUSADO", "NEGADO", "NEGADA"):
        raise RuntimeError("a OC está \"%s\" no MC — não aprovo por cima; conferir com Compras" % ap["atual"])
    ja = N(ap["atual"]) in ("APROVADO", "APROVADA")
    if not aplicar:
        ops = ap.get("opcoes") or []
        if not ja and ops and not any(N(o) == "APROVADO" for o in ops):
            raise RuntimeError("a lista Aprovação não tem \"Aprovado\" (tem: %s)" % ", ".join(ops))
        return "SIMULADO", "faria: Aprovação \"%s\" → \"Aprovado\" e Status da Compra → \"Aguardando\" (achei os campos; " \
                           "falta a chave OCS_APLICAR.txt)" % ap["atual"]
    marca = len(tela.escritas)
    if not ja:
        passo("OC %s (aprovar): escolhendo \"Aprovado\"" % num)
        tela.escolher("aprov", ap, "Aprovado")
        tela.page.wait_for_timeout(800)
        try:        # 17/11: anota a janela que o MC abrir ao aprovar (para entender se pedir algo diferente de Sim/OK)
            jan = tela.page.evaluate(r"""() => [...document.querySelectorAll('.modal.in, .modal.show, [role=dialog], .swal2-popup')]
                .filter(e => e.offsetWidth || e.offsetHeight).map(e => e.innerText.replace(/\s+/g, ' ').trim().slice(0, 200))""")
            if jan:
                log("   OC %s: janela do MC ao aprovar: %s" % (num, " | ".join(jan)))
        except Exception:       # noqa: BLE001
            pass
        tela.confirmar_se_perguntar()
        tela.page.wait_for_timeout(2000)
        log("   OC %s: depois de escolher Aprovado — gravações: %s" % (num, tela.gravou(marca)[1]))
        if not _status_compra(tela, 4):
            passo("OC %s (aprovar): salvando a aprovação" % num)
            tela.clicar_botao("Salvar")
            tela.confirmar_se_perguntar()
            tela.page.wait_for_timeout(3000)
        passo("OC %s (aprovar): reabrindo a OC" % num)
        tela.abrir_oc(linha["oc_id"])
        ap = tela.campo("Aprovação", "aprov")
        if not _sim(ap, "Aprovado"):
            _, rotas = tela.gravou(marca)
            raise RuntimeError("escolhi Aprovado, mas a OC reabriu com Aprovação \"%s\" (%s)" % ((ap or {}).get("atual"), rotas))
    passo("OC %s (aprovar): Status da Compra" % num)
    stc = _status_compra(tela, 10)
    if not stc:
        _, rotas = tela.gravou(marca)
        raise RuntimeError("a OC está Aprovado, mas o campo Status da Compra não apareceu — mudar para Aguardando à mão (%s)" % rotas)
    if not _sim(stc, "Aguardando"):
        tela.escolher("stcompra", stc, "Aguardando")
        tela.confirmar_se_perguntar()
        tela.page.wait_for_timeout(1000)
        passo("OC %s (aprovar): salvando o Status da Compra" % num)
        tela.clicar_botao("Salvar")
        tela.confirmar_se_perguntar()
        tela.page.wait_for_timeout(3000)
    ok, rotas = tela.gravou(marca)
    passo("OC %s (aprovar): conferindo (gravações: %s)" % (num, rotas))
    tela.abrir_oc(linha["oc_id"])
    ap2, st2 = tela.campo("Aprovação", "aprov"), _status_compra(tela, 10)
    if _sim(ap2, "Aprovado") and _sim(st2, "Aguardando"):
        return "FEITO", "Aprovação → Aprovado e Status da Compra → Aguardando (conferido na OC)%s · %s" % (
            " — já estava Aprovado" if ja else "", rotas)
    raise RuntimeError("salvei, mas a OC voltou com Aprovação \"%s\" e Status da Compra \"%s\" (%s)"
                       % ((ap2 or {}).get("atual"), (st2 or {}).get("atual"), rotas if not ok else "gravação ok"))


def lancamentos_vinculados(tela: Tela, oc_id: str) -> int:
    """Quantos lançamentos a OC tem (janela "$ Lançamento › Lançamentos vinculados"). Só olha, não muda nada."""
    tela.abrir_oc(oc_id)
    tela.clicar_botao("Lançamento", exato=False)
    # 17/11: OC SEM lançamento: o MC não mostra "Lançamentos vinculados" — pergunta "Deseja apropriar os insumos desta
    # ordem de compra para o novo lançamento? Sim / Não" (é o começo de um lançamento NOVO). O robô NÃO responde
    # (nem Sim nem Não): recarrega a página e conta 0.
    limite = time.monotonic() + 15
    while time.monotonic() < limite:
        corpo = N(tela.page.evaluate("() => document.body ? document.body.innerText : ''"))
        if N("Lançamentos vinculados") in corpo:
            break
        if N("Deseja apropriar os insumos desta ordem de compra para o novo lançamento") in corpo:
            tela.page.reload(wait_until="domcontentloaded")
            tela.page.wait_for_timeout(1500)
            return 0
        tela.page.wait_for_timeout(400)
    else:
        o_que = foto_da_tela(tela, "lancamento-" + str(oc_id)[:8])
        raise RuntimeError("cliquei em $ Lançamento e não reconheci a tela (%s)" % o_que)
    tela.page.wait_for_timeout(1200)
    n = tela.page.evaluate(_JS_LANCAMENTOS)
    if n < 0:
        raise RuntimeError("não achei a janela Lançamentos vinculados")
    return n


def foto_da_tela(tela: Tela, nome: str) -> str:
    """17/11: guarda a foto da aba do robô em _central/logs/ocs-tela-<nome>.png e devolve o que está escrito nas
    janelas abertas (ou o endereço), para entender uma tela que o robô não conhece. Só olha."""
    txt = ""
    try:
        tela.page.screenshot(path=str(AO_VIVO.parent / ("ocs-tela-%s.png" % nome)), full_page=False)
    except Exception:       # noqa: BLE001
        pass
    try:
        txt = tela.page.evaluate(r"""() => {
          const v = e => e.offsetWidth || e.offsetHeight;
          const jan = [...document.querySelectorAll('.modal, [role=dialog], .swal2-popup, .dropdown-menu')].filter(v)
              .map(e => e.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean);
          return (jan.length ? 'janela: ' + jan.join(' | ') : 'sem janela; endereço ' + location.hash).slice(0, 300);
        }""")
    except Exception:       # noqa: BLE001
        pass
    return txt or "não consegui ler a tela"


def ver_lancamento(numero: str) -> int:
    """OCS_VER_LANC=<nº da OC>: abre a OC, clica em $ Lançamento e guarda a foto e o texto do que o MC mostrou;
    depois abre a setinha ao lado e faz o mesmo. Não grava nada (fecha com Esc e recarrega)."""
    sb = Supa.do_ambiente()
    r = sb.pedir("GET", TABELA + "?select=oc_id&numero=eq.%s" % int(numero)) or []
    if not r:
        log("FALHOU: a OC %s não está na conferência" % numero)
        return 1
    from venda.mc.porteiro import AbaPorteiro
    aba = AbaPorteiro.abrir()
    try:
        tela = Tela(aba)
        tela.abrir_oc(r[0]["oc_id"])
        log("OC %s aberta: %s" % (numero, foto_da_tela(tela, "oc-%s" % numero)))
        tela.clicar_botao("Lançamento", exato=False)
        tela.page.wait_for_timeout(4000)
        log("depois de clicar em $ Lançamento: %s" % foto_da_tela(tela, "lanc-%s" % numero))
        log("escritas no MC até aqui: %s" % (tela.gravou(0)[1]))
        tela.page.keyboard.press("Escape")
        tela.page.reload(wait_until="domcontentloaded")
        tela.abrir_oc(r[0]["oc_id"])
        seta = tela.page.locator("button.dropdown-toggle, .btn-group button:has(.caret)")
        if seta.count():
            seta.first.click()
            tela.page.wait_for_timeout(1500)
            log("setinha ao lado do $ Lançamento: %s" % foto_da_tela(tela, "seta-%s" % numero))
        tela.page.keyboard.press("Escape")
    finally:
        aba.fechar()
    log("OK: fotos em _central\\logs\\ocs-tela-*.png")
    return 0


_JS_LANCAMENTOS = r"""() => {
      const m = [...document.querySelectorAll('.modal, [role=dialog]')].find(x => (x.offsetWidth || x.offsetHeight)
                 && /Lan[cç]amentos vinculados/i.test(x.innerText));
      if (!m) return -1;
      const linhas = [...m.querySelectorAll('tr, [class*=row], li')].filter(r => /R\$\s*[\d.]+,\d\d/.test(r.innerText)
                       && /\d{2}\/\d{2}\/\d{4}/.test(r.innerText) && !/Total Lan/i.test(r.innerText));
      const marcadas = new Set();
      linhas.forEach(r => { if (![...linhas].some(o => o !== r && r.contains(o))) marcadas.add(r); });
      [...marcadas].forEach((r, i) => r.setAttribute('data-robo-lanc', String(i)));
      return marcadas.size;
    }"""


def voltar_para_aguardando(tela: Tela, oc: dict, aplicar: bool) -> tuple[str, str]:
    """16/11 (dono): OC aprovada e SEM lançamento → Aprovação "Aguardando aprovação" (o Status da Compra fica como está).
    Só mexe se a tela mostra "Aprovado"; confere relendo a OC."""
    passo("OC %s (voltar): abrindo a OC" % oc.get("numero"))
    tela.abrir_oc(oc["oc_id"])
    passo("OC %s (voltar): lendo o campo Aprovação" % oc.get("numero"))
    ap = tela.campo("Aprovação", "aprov")
    if not ap:
        raise RuntimeError("não achei o campo Aprovação na OC")
    if N(ap["atual"]) not in ("APROVADO", "APROVADA"):
        return "FEITO", "já estava \"%s\" — nada mudado" % ap["atual"]
    if not any(N(o) == "AGUARDANDO APROVACAO" for o in ap.get("opcoes") or []):
        raise RuntimeError("a lista Aprovação não tem \"Aguardando aprovação\" (tem: %s)" % ", ".join(ap.get("opcoes") or []))
    # 17/11 (dono): só volta a que REALMENTE não tem lançamento — confere na própria OC ($ Lançamento › Lançamentos
    # vinculados), não só na lista. Tem lançamento (ou não deu para ver): não mexe.
    passo("OC %s (voltar): conferindo o lançamento na OC" % oc.get("numero"))
    try:
        n = lancamentos_vinculados(tela, oc["oc_id"])
    finally:
        try:
            tela.page.keyboard.press("Escape")
            tela.page.wait_for_timeout(500)
            tela.page.reload(wait_until="domcontentloaded")
            tela.page.wait_for_timeout(1500)
        except Exception:       # noqa: BLE001
            pass
    if n:
        return "PULADA", "tem %d lançamento(s) vinculado(s) no MC — continua Aprovado" % n
    tela.abrir_oc(oc["oc_id"])
    ap = tela.campo("Aprovação", "aprov")
    if not ap or N(ap["atual"]) not in ("APROVADO", "APROVADA"):
        return "FEITO", "já estava \"%s\" — nada mudado" % (ap or {}).get("atual")
    if not aplicar:
        return "SIMULADO", "faria: Aprovação \"%s\" → \"Aguardando aprovação\" (conferido: nenhum lançamento vinculado; falta a chave OCS_APLICAR.txt)" % ap["atual"]
    marca = len(tela.escritas)
    passo("OC %s (voltar): escolhendo \"Aguardando aprovação\"" % oc.get("numero"))
    tela.escolher("aprov", ap, "Aguardando aprovação")
    tela.confirmar_se_perguntar()
    tela.page.wait_for_timeout(1000)
    passo("OC %s (voltar): clicando Salvar" % oc.get("numero"))
    tela.clicar_botao("Salvar")
    tela.confirmar_se_perguntar()
    tela.page.wait_for_timeout(3000)
    ok, rotas = tela.gravou(marca)
    passo("OC %s (voltar): conferindo (gravações: %s)" % (oc.get("numero"), rotas))
    tela.abrir_oc(oc["oc_id"])
    ap2 = tela.campo("Aprovação", "aprov")
    if _sim(ap2, "Aguardando aprovação"):
        return "FEITO", "Aprovação → Aguardando aprovação (conferido na OC; nenhum lançamento vinculado) · %s" % rotas
    raise RuntimeError("salvei, mas a OC voltou com Aprovação \"%s\" (%s)" % ((ap2 or {}).get("atual"), rotas if not ok else "gravação ok"))


def _abrir_lancamento(tela: Tela, linha: dict):
    """OC › $ Lançamento › (1 lançamento vinculado) › Ir para lançamento → página com a janela Editar lançamento."""
    n = lancamentos_vinculados(tela, linha["oc_id"])
    if n == 0:
        raise RuntimeError("a OC não tem lançamento vinculado no MC — o pagamento ainda não foi lançado")
    if n > 1:
        raise RuntimeError("a OC tem %d lançamentos vinculados — não sei qual mudar; fazer à mão" % n)
    ctx, antes = tela.page.context, len(tela.page.context.pages)
    tela.page.evaluate(r"""() => {
      const r = document.querySelector('[data-robo-lanc="0"]');
      const el = [...r.querySelectorAll('[title]')].find(x => /lan[cç]amento/i.test(x.title))
              || [...r.querySelectorAll('a, button, i, svg, [class*=chevron], [class*=arrow]')].pop() || r;
      el.setAttribute('data-robo-ir', '1');
    }""")
    tela.page.locator('[data-robo-ir="1"]').first.click()
    pagina = tela.page
    for _ in range(40):
        if len(ctx.pages) > antes:
            pagina = ctx.pages[-1]
            break
        if tela.esperar_texto("Editar lançamento", 0.5):
            break
    t2 = tela if pagina is tela.page else Tela(tela.aba, pagina, tela.escritas)
    if not t2.esperar_texto("Parcela", 40):
        raise RuntimeError("cliquei em Ir para lançamento e a janela Editar lançamento não mostrou as parcelas")
    pagina.wait_for_timeout(1500)
    return t2


def _fechar_extra(tela: Tela, t2: Tela) -> None:
    if t2.page is not tela.page:
        try:
            t2.page.close()
        except Exception:
            pass


def mudar_parcela(tela: Tela, linha: dict, aplicar: bool, hoje: dt.date | None = None) -> tuple[str, str]:
    """ROBÔ 2: vencimento da 2ª parcela do lançamento da OC → próximo dia útil depois do SIM."""
    hoje = hoje or dt.date.today()
    marcado = dia_local(linha.get("respondido_em")) or hoje
    alvo = data_da_parcela(marcado, hoje)
    t2 = _abrir_lancamento(tela, linha)
    try:
        p2 = t2.page.evaluate(_JS_PARCELA, [2, "parc2"])
        if not p2 or p2.get("vencimento") is None:
            if (p2 or {}).get("parcelas", 0) < 2:
                raise RuntimeError("o lançamento da OC não tem 2ª parcela (%s parcela(s)) — conferir com o financeiro"
                                   % (p2 or {}).get("parcelas", "?"))
            raise RuntimeError("não achei o vencimento da Parcela 2 na janela Editar lançamento")
        atual = p2["vencimento"]
        if mesma_data(atual, alvo):
            return "FEITO", "2ª parcela já estava com vencimento %s — nada mudado" % atual
        if p2.get("pago"):
            raise RuntimeError("a 2ª parcela já está PAGA (vencimento %s) — não mudo" % atual)
        if p2.get("desabilitado"):
            raise RuntimeError("o vencimento da 2ª parcela está travado na tela (%s) — conferir no MC" % atual)
        if not aplicar:
            return "SIMULADO", "faria: 2ª parcela %s → %s (próximo dia útil depois do SIM de %s; falta a chave " \
                               "OCS_APLICAR.txt)" % (atual or "sem data", br(alvo), br(marcado))
        marca = len(t2.escritas)
        campo = t2.page.locator('[data-robo-oc="parc2"]').first
        if p2.get("tipo") == "date":            # <input type=date>: o valor é AAAA-MM-DD
            campo.fill(alvo.isoformat())
        else:                                   # campo com máscara dd/mm/aaaa (o da tela nova)
            campo.click()
            campo.press("Control+a")
            campo.press("Backspace")
            campo.type(br(alvo).replace("/", ""), delay=60)
            t2.page.wait_for_timeout(300)
            if not mesma_data(campo.input_value(), alvo):
                campo.fill(br(alvo))
        campo.press("Tab")
        t2.page.wait_for_timeout(600)
        if not mesma_data(campo.input_value(), alvo):
            raise RuntimeError("digitei %s no vencimento, mas o campo ficou \"%s\" — NÃO salvei"
                               % (br(alvo), campo.input_value()))
        t2.clicar_botao("Salvar Lançamento", exato=False)
        t2.confirmar_se_perguntar()
        t2.page.wait_for_timeout(3500)
        ok, rotas = t2.gravou(marca)
    finally:
        _fechar_extra(tela, t2)
    # confere abrindo de novo
    t3 = _abrir_lancamento(tela, linha)
    try:
        p2b = t3.page.evaluate(_JS_PARCELA, [2, "parc2"]) or {}
    finally:
        _fechar_extra(tela, t3)
    if mesma_data(p2b.get("vencimento"), alvo):
        return "FEITO", "2ª parcela %s → %s (conferido no lançamento) · %s" % (atual or "sem data", br(alvo), rotas)
    raise RuntimeError("salvei, mas a 2ª parcela voltou com vencimento \"%s\" (queria %s; %s)"
                       % (p2b.get("vencimento"), br(alvo), rotas if not ok else "gravação ok"))


# ------------------------------------------------------------------------------------------- descoberta
def _forma(v) -> str:
    if v is None or v == "":
        return "vazio"
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, (int, float)):
        return "número"
    s = str(v)
    if re.match(r"^[0-9a-f]{8}-[0-9a-f-]{27}$", s, re.I):
        return "uuid"
    if re.match(r"^\d{4}-\d\d-\d\d", s):
        return "data"
    if re.match(r"^[A-Z_]{2,40}$", s):
        return s
    return "texto"


def _achatar(x, pre="", prof=0, out=None):
    out = [] if out is None else out
    if prof > 4:
        return out
    if isinstance(x, dict):
        for k, v in x.items():
            _achatar(v, (pre + "." if pre else "") + k, prof + 1, out)
    elif isinstance(x, list):
        out.append((pre + "[#]", len(x)))
        if x:
            _achatar(x[0], pre + "[]", prof + 1, out)
    else:
        out.append((pre, _forma(x)))
    return out


def descobrir() -> int:
    from venda.mc.porteiro import AbaPorteiro, PorteiroErro
    log("DESCOBRIR: só formato, nada gravado (nem no Mais Controle, nem no Supabase)")
    try:
        aba = AbaPorteiro.abrir()
    except PorteiroErro as e:
        log("FALHOU: %s" % e)
        return 1
    try:
        try:
            visto = capturar_lista(aba)
        finally:
            log("o que a tela Ordem de Compra pediu (%d):" % len(VISTOS_TELA))
            for linha in VISTOS_TELA:
                log("   " + linha)
        if visto["tipo"] == "graphql":
            log("lista das OCs: GraphQL — consulta da tela:", re.sub(r"\s+", " ", visto["query"])[:3000])
            log("variáveis:", json.dumps({k: (v if k != "specification" else {kk: _forma(vv) if not isinstance(vv, dict)
                                                                                  else {a: _forma(b) for a, b in vv.items()}
                                                                              for kk, vv in (v or {}).items()})
                                          for k, v in visto["vars"].items()}, ensure_ascii=False)[:800])
        else:
            log("lista das OCs: REST %s %s · corpo: %s" % (visto["metodo"], re.sub(r"=[^&]*", "=…", visto["url"]),
                                                          re.sub(r'":\s*"[^"]*"', '":"…"', visto.get("corpo") or "")[:600]))
        nos, est = ler_ocs(aba)
        log("OCs lidas: %d (%d página(s), fonte: %s)" % (est["ocs"], est["paginas"], est.get("fonte")))
        if nos:
            log("campos de uma OC:")
            for c, f in _achatar(nos[0])[:120]:
                log("   %s = %s" % (c, f))
        forn, aprov, stat, achadas = {}, {}, {}, []
        for no in nos:
            oc = oc_do_no(no)
            forn[N(oc["fornecedor"]) or "(SEM FORNECEDOR)"] = forn.get(N(oc["fornecedor"]) or "(SEM FORNECEDOR)", 0) + 1
            aprov[oc["aprovacao_mc"]] = aprov.get(oc["aprovacao_mc"], 0) + 1
            stat[oc["status_compra_mc"]] = stat.get(oc["status_compra_mc"], 0) + 1
            f = acao_do_fornecedor(oc["fornecedor"])
            if f:
                achadas.append((oc["numero"], f[1], oc["criada_em"], oc["aprovacao_mc"], oc["status_compra_mc"],
                                {True: "sim", False: "não", None: "a lista não diz"}[oc["tem_lancamento"]],
                                (oc["obra"] or "SEM OBRA")[:40]))
        log("aprovação (códigos): %s" % aprov)
        log("status da compra (códigos): %s" % stat)
        log("fornecedores mais frequentes: %s" % sorted(forn.items(), key=lambda x: -x[1])[:25])
        log("OCs dos fornecedores da lista (todas as datas lidas): %d" % len(achadas))
        for a in achadas[:30]:
            log("   OC %s · %s · criada %s · aprovação %s · status %s · lançamento: %s · obra %s" % a)
        if EXEMPLO:
            alvo = next((no for no in nos if str(oc_do_no(no)["numero"]) == EXEMPLO), None)
            if not alvo:
                log("OC %s não está na lista lida (só as criadas desde %s) — use uma mais nova" % (EXEMPLO, min(A_PARTIR_DE, antigas_desde())))
            else:
                tela = Tela(aba)
                tela.abrir_oc(alvo["id"])
                log("tela da OC %s — rótulos/listas: %s" % (EXEMPLO, json.dumps(tela.page.evaluate(_JS_ROTULOS), ensure_ascii=False)[:2500]))
                log("tela da OC %s — botões: %s" % (EXEMPLO, tela.page.evaluate(_JS_BOTOES)))
                try:
                    log("arquivos da OC %s (aba Arquivos): %s" % (EXEMPLO, anexos_da_oc(aba, alvo["id"]) or "nenhum"))
                except Exception as e:      # noqa: BLE001
                    log("arquivos da OC %s: %s" % (EXEMPLO, e))
                for r, m in (("Aprovação", "aprov"), ("Status da Compra", "stcompra")):
                    log("campo %s: %s" % (r, json.dumps(tela.campo(r, m), ensure_ascii=False)))
                if (acao_do_fornecedor(oc_do_no(alvo)["fornecedor"]) or ("", ""))[1] == "PARCELA":
                    try:
                        t2 = _abrir_lancamento(tela, {"oc_id": alvo["id"]})
                        log("lançamento — parcela 1: %s" % json.dumps(t2.page.evaluate(_JS_PARCELA, [1, "parc1"]), ensure_ascii=False))
                        log("lançamento — parcela 2: %s" % json.dumps(t2.page.evaluate(_JS_PARCELA, [2, "parc2"]), ensure_ascii=False))
                        log("lançamento — botões: %s" % t2.page.evaluate(_JS_BOTOES))
                        _fechar_extra(tela, t2)
                    except Exception as e:      # noqa: BLE001
                        log("lançamento: %s" % e)
        log("OK: descoberta das OCs — %d lida(s), %d dos fornecedores da lista." % (len(nos), len(achadas)))
        return 0
    except Exception as e:      # noqa: BLE001
        log("FALHOU: %s" % e)
        return 1
    finally:
        aba.fechar()


# ------------------------------------------------------------------------------------------- anexos da OC
def _lista_de(x) -> list:
    if isinstance(x, list):
        return x
    if isinstance(x, dict):
        for k in ("content", "items", "folders", "files", "data", "attachments"):
            if isinstance(x.get(k), list):
                return x[k]
    return []


def arquivos_validos(lista) -> list:
    """Arquivos de verdade (tira o registro temporário de um envio que não terminou e o de tamanho 0)."""
    out = []
    for a in lista or []:
        if not isinstance(a, dict) or a.get("temporary") is True or a.get("sizeInBytes") == 0:
            continue
        nome = str(a.get("name") or a.get("fileName") or a.get("originalName") or "").strip()
        ext = str(a.get("extension") or "").strip().lstrip(".")
        if ext and nome and not nome.lower().endswith("." + ext.lower()):
            nome += "." + ext
        out.append(nome or "(sem nome)")
    return out


def anexos_da_oc(aba, oc_id: str) -> list:
    """Nomes dos arquivos da aba "Arquivos" da OC. Pastas da OC: GET /folder?id=<oc>&origin=PURCHASE_ORDER (a mesma
    rota das pastas do Orçamento e da venda, ver venda/mc/ANEXOS-ERP.md); a pasta sem `files` é aberta (/folder/{id}).
    Se a rota de pastas não responder, tenta a de anexos nova (/attachments/v2?entityOrigin=PURCHASE_ORDER)."""
    def get(url, host):
        st, txt = aba.fetch("GET", url, aba.cabecalhos(host), None)
        if st in (401, 403):
            raise RuntimeError("o Mais Controle recusou a leitura dos arquivos (HTTP %s) — a sessão do porteiro caiu?" % st)
        if st >= 300:
            return None, st
        return (json.loads(txt) if (txt or "").strip() else None), st
    q = urllib.parse.urlencode({"id": oc_id, "origin": "PURCHASE_ORDER"})
    pastas, st = get("%s/folder?%s" % (LEGACY, q), "legacy-api.maiscontroleerp.com.br")
    if pastas is not None:
        nomes = []
        for p in _lista_de(pastas):
            arqs = _lista_de(p.get("files")) if isinstance(p, dict) else []
            if not arqs and isinstance(p, dict) and p.get("id"):
                det, _ = get("%s/folder/%s" % (LEGACY, p["id"]), "legacy-api.maiscontroleerp.com.br")
                arqs = _lista_de((det or {}).get("files") if isinstance(det, dict) else det)
            nomes += arquivos_validos(arqs)
        return nomes
    q2 = urllib.parse.urlencode({"entityIds": oc_id, "entityOrigin": "PURCHASE_ORDER"})
    j, st2 = get("%s/attachments/v2?%s" % (CORE, q2), "prod-erp-api.maiscontroleerp.com.br")
    if j is None:
        raise RuntimeError("as duas rotas de arquivos da OC falharam (folder HTTP %s, attachments HTTP %s)" % (st, st2))
    return arquivos_validos(_lista_de(j))


def com_anexos(aba, linhas: list, existentes: dict, limite: int = MAX_ANEXOS, tem_arquivo: dict | None = None) -> dict:
    """Põe anexos / anexos_nomes / anexos_em nas linhas (novas e atualizadas) das OCs ainda não feitas pelo robô.
    Erro numa OC não para a rodada: a linha fica sem os campos (o mapa mantém o que já sabia)."""
    est = {"conferidas": 0, "com_nf": 0, "erros": 0}
    agora = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    for ln in linhas:
        if (existentes.get(ln["oc_id"]) or {}).get("robo_situacao") == "FEITO" or ln.get("cancelada"):
            continue
        if (tem_arquivo or {}).get(ln["oc_id"]) is False:      # a lista do MC já disse: aba Arquivos vazia
            ln.update({"anexos": 0, "anexos_nomes": None, "anexos_em": agora})
            continue
        if est["conferidas"] >= limite:
            break
        try:
            nomes = anexos_da_oc(aba, ln["oc_id"])
        except Exception as e:      # noqa: BLE001
            est["erros"] += 1
            if est["erros"] <= 3:
                log("   OC %s: não consegui ver os arquivos (%s)" % (ln.get("numero"), str(e)[:150]))
            continue
        est["conferidas"] += 1
        est["com_nf"] += bool(nomes)
        ln.update({"anexos": len(nomes), "anexos_nomes": " · ".join(nomes)[:500] or None, "anexos_em": agora})
    return est


# ------------------------------------------------------------------------------------------- rodada
def ler_com_lancamento() -> set:
    try:
        return set(json.loads(COM_LANCAMENTO.read_text(encoding="utf-8")) or [])
    except Exception:       # noqa: BLE001 — sem o arquivo, só confere de novo
        return set()


def guardar_com_lancamento(ids: set) -> None:
    try:
        COM_LANCAMENTO.write_text(json.dumps(sorted(ids)), encoding="utf-8")
    except Exception:       # noqa: BLE001
        pass


def executar(tela: Tela, linha: dict, aplicar: bool) -> tuple[str, str]:
    if linha.get("acao") == "APROVAR":
        return aprovar(tela, linha, aplicar)
    if linha.get("acao") == "PARCELA":
        return mudar_parcela(tela, linha, aplicar)
    raise RuntimeError("ação desconhecida: %s" % linha.get("acao"))


def main() -> int:
    if DESCOBRIR:
        return descobrir()
    if os.environ.get("OCS_VER_LANC", "").strip():
        return ver_lancamento(os.environ["OCS_VER_LANC"].strip())
    try:
        AO_VIVO.parent.mkdir(parents=True, exist_ok=True)
        AO_VIVO.write_text("", encoding="utf-8")
    except Exception:       # noqa: BLE001
        pass
    vigia()
    aplicar = CHAVE_APLICAR.exists()
    log("modo: %s" % ("GRAVA no Mais Controle (OCS_APLICAR.txt existe)" if aplicar else
                      "SIMULAÇÃO — nada é salvo no Mais Controle (falta _central\\OCS_APLICAR.txt)"))
    try:
        sb = Supa.do_ambiente()
        existentes = sb.existentes()
    except RuntimeError as e:
        log("FALHOU: %s" % e)
        return 1
    from venda.mc.porteiro import AbaPorteiro, PorteiroErro
    try:
        aba = AbaPorteiro.abrir()
    except PorteiroErro as e:
        log("FALHOU: %s" % e)
        return 1
    erro_leitura, cont = "", {"FEITO": 0, "SIMULADO": 0, "ERRO": 0}
    novas = []
    try:
        # 1-2. OCs novas → Supabase (o alerta do mapa)
        try:
            passo("lendo as OCs do Mais Controle")
            nos, est = ler_ocs(aba)
            passo("separando as OCs da conferência (%d lidas)" % len(nos))
            ocs = [oc_do_no(n) for n in nos]
            if nos and not any(o["fornecedor"] for o in ocs):
                raise RuntimeError("as OCs vieram sem o fornecedor — rode com DESCOBRIR=1 e mande a saída")
            com_lanc = ler_com_lancamento()
            conf = {"vistas": 0, "sem": 0, "com": 0}
            tela_c = Tela(aba)

            def sem_lancamento(oc):
                """OC antiga sem a informação na lista: abre "$ Lançamento" (limite por rodada; as com lançamento
                ficam anotadas e não são abertas de novo)."""
                if oc["oc_id"] in com_lanc or conf["vistas"] >= MAX_CONFERIR:
                    return None
                conf["vistas"] += 1
                try:
                    n = lancamentos_vinculados(tela_c, oc["oc_id"])
                except Exception as e:      # noqa: BLE001 — fica para a próxima rodada
                    log("   OC %s antiga: não consegui ver o lançamento (%s)" % (oc.get("numero"), str(e)[:120]))
                    return None
                if n:
                    com_lanc.add(oc["oc_id"])
                    conf["com"] += 1
                    return False
                conf["sem"] += 1
                return True
            novas, atual = linhas_novas_e_atualizadas(ocs, existentes, sem_lancamento)
            guardar_com_lancamento(com_lanc)
            passo("conferindo os arquivos (NF) das OCs")
            ea = com_anexos(aba, novas + atual, existentes, tem_arquivo={o["oc_id"]: o.get("tem_arquivo") for o in ocs})
            passo("gravando %d linha(s) no Supabase" % len(novas + atual))
            sb.gravar(novas + atual)
            log("OCs lidas: %d (novas desde %s; antigas sem lançamento desde %s) · novas na conferência: %d · "
                "atualizadas: %d" % (est["ocs"], A_PARTIR_DE, antigas_desde(), len(novas), len(atual)))
            log("   arquivos (NF) nas OCs em aberto: %d conferida(s) · %d com arquivo anexado%s" % (
                ea["conferidas"], ea["com_nf"], " · %d sem resposta do MC" % ea["erros"] if ea["erros"] else ""))
            if conf["vistas"]:
                log("   OCs antigas conferidas na tela: %d (sem lançamento: %d · com: %d%s)" % (
                    conf["vistas"], conf["sem"], conf["com"],
                    " · limite da rodada, o resto fica para a próxima" if conf["vistas"] >= MAX_CONFERIR else ""))
            for x in novas:
                log("   nova: OC %s · %s · %s" % (x.get("numero"), x["acao"], (x.get("obra") or "sem obra")[:40]))
            # 16/11 (dono): aprovadas sem lançamento voltam para "Aguardando aprovação"
            voltar = para_voltar(ocs, existentes, novas)
            if SO:
                voltar = [o for o in voltar if str(o.get("numero")) == SO]
            if voltar:
                log("aprovadas sem lançamento para voltar a \"Aguardando aprovação\": %d%s" % (
                    len(voltar), " (nesta rodada %d)" % MAX_VOLTAR if len(voltar) > MAX_VOLTAR else ""))
                tela_v = Tela(aba)
                for oc in voltar[:MAX_VOLTAR]:
                    try:
                        sit, msg = voltar_para_aguardando(tela_v, oc, aplicar)
                    except Exception as e:      # noqa: BLE001
                        sit, msg = "ERRO", str(e)[:300]
                    cont["voltou" if sit == "FEITO" else sit] = cont.get("voltou" if sit == "FEITO" else sit, 0) + 1
                    log("   OC %s (voltar): %s — %s" % (oc.get("numero"), sit, msg))
        except Exception as e:      # noqa: BLE001 — a leitura falhar não impede de atender os SIM já marcados
            erro_leitura = str(e)[:300]
            log("  ! leitura das OCs: %s" % erro_leitura)
        # 3. SIM do engenheiro → Mais Controle
        passo("lendo os SIM dos engenheiros no Supabase")
        pend = sb.pendentes()
        if SO:
            pend = [p for p in pend if str(p.get("numero")) == SO]
        log("SIM esperando o robô: %d" % len(pend))
        tela = Tela(aba) if pend else None
        for linha in pend:
            rot = "OC %s (%s)" % (linha.get("numero"), linha.get("acao"))
            passo("%s: atendendo o SIM" % rot)
            try:
                sit, msg = executar(tela, linha, aplicar)
            except Exception as e:      # noqa: BLE001
                sit, msg = "ERRO", str(e)[:400]
            cont[sit] = cont.get(sit, 0) + 1
            log("   %s: %s — %s" % (rot, sit, msg))
            try:
                sb.resultado(linha, sit, msg)
            except RuntimeError as e:
                log("   %s: não consegui gravar o resultado no Supabase (%s)" % (rot, e))
                cont["ERRO"] += 1
    finally:
        passo("fechando a aba do robô")
        aba.fechar()
    resumo = "%d nova(s) · %d voltada(s) p/ aguardando%s · %d feita(s) · %d simulada(s) · %d com erro" % (
        len(novas), cont.get("voltou", 0),
        " · %d com lançamento (não mexi)" % cont["PULADA"] if cont.get("PULADA") else "",
        cont["FEITO"], cont["SIMULADO"], cont["ERRO"])
    if erro_leitura:
        log("FALHOU: leitura das OCs — %s (%s)" % (erro_leitura, resumo))
        return 1
    if cont["ERRO"]:
        log("FALHOU: %s — veja as OCs com erro no Mapa de Obras (Conferência de compras)" % resumo)
        return 1
    log("OK: conferência de OCs — %s%s" % (resumo, "" if aplicar else " (SIMULAÇÃO)"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
