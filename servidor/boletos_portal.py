# -*- coding: utf-8 -*-
"""Arquivo da página Boletos e Financeiro do portal (09/11/2026). Junta o último relatório do robô de boletos, as
parcelas seguradas e o financeiro por unidade e sobe para robos/boletos-financeiro.json no bucket PRIVADO "analise".
Publica depois da rodada de boletos, da leitura dos retratos e de cada Segurar/Soltar. O arquivo leva nome e valor:
nada disto vai para log nem para o repositório."""
from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import sys
import urllib.request

RAIZ = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from venda.mc import financeiro_condominio as F  # noqa: E402
from venda.mc import seguradas as S  # noqa: E402

CENTRAL = pathlib.Path(os.environ.get("MC_CENTRAL") or r"C:\AUTOMAÇÕES MAIS CONTROLE\_central")
PASTA = CENTRAL / "boletos"
CONFIG = CENTRAL / "robos-portal.json"
ULTIMO_FINANCEIRO = CENTRAL / "financeiro-condominio.json"   # guarda o último bom: o Notion fora não apaga os números
BUCKET = "analise"
CAMINHO = "robos/boletos-financeiro.json"
GRUPOS = ("emitidos", "a_emitir", "aguardando", "decidir", "seguradas", "pulados")


def ultimo_relatorio(pasta=PASTA, com_linhas: bool = False) -> dict | None:
    """O relatório mais novo que dá para ler. seguradas.json fica na mesma pasta e não casa com o padrão de data.
    com_linhas=True pula a rodada que não conseguiu montar a lista (ERP fora): a tela e o Segurar usam a última lista boa."""
    for arq in sorted(pathlib.Path(pasta).glob("20??-??-??_*.json"), reverse=True):
        try:
            rel = dict(json.loads(arq.read_text(encoding="utf-8")), nome=arq.stem)
        except (ValueError, OSError):
            continue
        if rel.get("linhas") or not com_linhas:
            return rel
    return None


def _item(l: dict, motivo: str | None = None) -> dict:
    return {"parcela": l.get("parcela"), "unidade": l.get("unidade", ""), "comprador": l.get("comprador", ""),
            "tipo": l.get("tipo", ""), "data": l.get("data", ""), "valor": l.get("valor", 0),
            "motivo": l.get("motivo", "") if motivo is None else motivo}


def grupos(rel: dict | None, seguradas: dict) -> dict:
    """Separa as parcelas nos grupos da tela. Com boleto vivo = emitido, seja pelo robô ou pela tela do ERP.
    Parcela segurada que já não está no relatório (virou o mês) continua aparecendo, para não ficar esquecida."""
    out = {g: [] for g in GRUPOS}
    rel = rel or {}
    res = {r.get("parcela"): r for r in rel.get("resultados") or []}
    vistas = set()
    for l in rel.get("linhas") or []:
        vistas.add(l.get("parcela"))
        acao, r = l.get("acao"), res.get(l.get("parcela"))
        marca = seguradas.get(l.get("parcela"))
        if marca is not None and acao != "pular" and not r:
            out["seguradas"].append(dict(_item(l, S.motivo(marca)), segurada=True))
        elif r and r.get("situacao") in ("EMITIDO", "JA_TINHA"):
            out["emitidos"].append(_item(l, "boleto emitido nesta rodada"))
        elif r:
            out["decidir"].append(_item(l, "%s: conferir no Mais Controle. %s" % (r.get("situacao"), r.get("motivo") or "")))
        elif acao == "pular" and l.get("com_boleto"):
            out["emitidos"].append(_item(l))
        elif acao == "pular":
            out["pulados"].append(_item(l))
        elif acao == "emitir":
            out["a_emitir"].append(_item(l))
        elif acao == "aguardar":
            out["aguardando"].append(_item(l))
        elif acao == "segurada":                 # a marca já foi solta depois da rodada: volta na próxima
            out["aguardando"].append(_item(l, "solta depois da rodada; o robô reavalia na próxima"))
        else:
            out["decidir"].append(_item(l))
    for parcela, marca in seguradas.items():
        if parcela not in vistas:
            out["seguradas"].append(dict(marca.get("rotulo") or {}, parcela=parcela, motivo=S.motivo(marca),
                                         segurada=True, fora_do_relatorio=True))
    return out


def rotulo_da_parcela(parcela: str, rel: dict | None) -> dict | None:
    """Os dados da parcela no último relatório, ou None. Pulada não entra: boleto, ato e permuta não se seguram.
    Parcela emitida naquela rodada também não: o boleto já saiu, e dizer "segurada" seria falso."""
    if any(r.get("parcela") == parcela and r.get("situacao") in ("EMITIDO", "JA_TINHA") for r in (rel or {}).get("resultados") or []):
        return None
    for l in (rel or {}).get("linhas") or []:
        if l.get("parcela") == parcela:
            return None if l.get("acao") == "pular" else {k: l.get(k, "") for k in ("unidade", "comprador", "tipo", "data", "valor")}
    return None


def pedir(acao: str, parcela: str, quem: str, pasta=PASTA, agora: str | None = None) -> tuple[bool, str]:
    """Atende Segurar ou Soltar. Não usa o Mais Controle, então não espera a vez dele. A mensagem não leva nome nem valor."""
    if not quem:
        return False, "pedido sem o nome de quem pediu"
    atuais = S.ler(pasta)
    if acao == "soltar":
        if parcela in atuais:
            del atuais[parcela]
            S.gravar(pasta, atuais)
        _limpar_recusa(parcela, pasta)
        return True, "solta"
    if acao != "segurar":
        return False, "ação inválida"
    rotulo = rotulo_da_parcela(parcela, ultimo_relatorio(pasta, com_linhas=True))
    if rotulo is None:
        return False, "parcela fora da lista do mês, ou já com boleto, ato ou permuta"
    atuais[parcela] = {"quem": quem[:40], "em": agora or dt.datetime.now().strftime("%d/%m/%Y %H:%M"), "rotulo": rotulo}
    S.gravar(pasta, atuais)
    _limpar_recusa(parcela, pasta)
    return True, "segurada"


RECUSAS = "recusas.json"


def _ler_recusas(pasta) -> dict:
    try:
        d = json.loads((pathlib.Path(pasta) / RECUSAS).read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except (ValueError, OSError):
        return {}


def _gravar_recusas(pasta, recusas: dict) -> None:
    pathlib.Path(pasta).mkdir(parents=True, exist_ok=True)
    (pathlib.Path(pasta) / RECUSAS).write_text(json.dumps(recusas, ensure_ascii=False), encoding="utf-8")


def _limpar_recusa(parcela: str, pasta) -> None:
    recusas = _ler_recusas(pasta)
    if parcela in recusas:
        del recusas[parcela]
        _gravar_recusas(pasta, recusas)


def registrar_recusa(parcela: str, motivo: str, pasta=PASTA, agora: str | None = None) -> None:
    """Pedido que o servidor não atendeu: a tela precisa dizer, senão quem clicou acha que a parcela está segura."""
    recusas = _ler_recusas(pasta)
    recusas[parcela] = {"motivo": motivo[:150], "em": agora or dt.datetime.now().strftime("%d/%m/%Y %H:%M")}
    _gravar_recusas(pasta, recusas)


def recusas_para_a_tela(pasta, rel: dict | None) -> list[dict]:
    unidades = {l.get("parcela"): l.get("unidade", "") for l in (rel or {}).get("linhas") or []}
    return [{"parcela": p, "unidade": unidades.get(p, ""), "motivo": str(r.get("motivo") or ""), "em": str(r.get("em") or "")}
            for p, r in _ler_recusas(pasta).items() if isinstance(r, dict)]


def _cfg() -> dict:
    return json.loads(CONFIG.read_text(encoding="utf-8")).get("robos") or {}


def financeiro(hoje: str, ler_linhas=None, guardado=ULTIMO_FINANCEIRO) -> dict:
    """Lê a base do condomínio e guarda o resultado. Se o Notion falhar, devolve o último bom com falha_leitura=True."""
    try:
        if ler_linhas is None:
            from venda.mc.notion import Notion
            cfg = _cfg()
            tok = pathlib.Path(cfg["notion_token_arquivo"]).read_text(encoding="utf-8").strip()
            ler_linhas = lambda: Notion(tok).linhas(str((cfg.get("vars") or {})["DB_VENDAS_COND"]))  # noqa: E731
        d = F.montar(ler_linhas(), hoje)
        pathlib.Path(guardado).write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
        return d
    except Exception as e:
        print("financeiro: leitura falhou (%s)" % type(e).__name__, file=sys.stderr)
        try:
            return dict(json.loads(pathlib.Path(guardado).read_text(encoding="utf-8")), falha_leitura=True)
        except (ValueError, OSError):
            return {"hoje": hoje, "lido": "", "totais": {}, "unidades": [], "nao_lancadas": [], "sem_leitura": [], "falha_leitura": True}


def montar(pasta=PASTA, hoje: str | None = None, ler_linhas=None, guardado=ULTIMO_FINANCEIRO) -> dict:
    hoje = hoje or dt.date.today().isoformat()
    novo = ultimo_relatorio(pasta)                         # a trava e a hora vêm da rodada mais nova
    rel = ultimo_relatorio(pasta, com_linhas=True) or novo  # a lista vem da última que conseguiu montar
    trava_seguradas = ""
    try:
        seguradas = S.ler(pasta)
    except S.SeguradasIlegiveis:
        seguradas, trava_seguradas = {}, "Não consegui ler as parcelas seguradas: o robô não emite enquanto isso."
    resumo = None
    if novo:
        resumo = {k: novo.get(k) for k in ("modo", "mes", "hoje", "trava", "contagem", "saldo", "nome")}
    return {"versao": 1, "gerado": dt.datetime.now().isoformat(timespec="seconds"), "rodada": resumo,
            "trava_seguradas": trava_seguradas, "grupos": grupos(rel, seguradas), "recusas": recusas_para_a_tela(pasta, rel),
            "financeiro": financeiro(hoje, ler_linhas, guardado)}


def subir(dados: dict) -> int:
    import escritorio_robos as ER
    url, chave = ER._cfg_supabase()
    corpo = json.dumps(dados, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8")
    req = urllib.request.Request("%s/storage/v1/object/%s/%s" % (url, BUCKET, CAMINHO), data=corpo, method="POST",
                                 headers={"apikey": chave, "Authorization": "Bearer " + chave,
                                          "Content-Type": "application/json", "x-upsert": "true",
                                          "Cache-Control": "no-cache"})
    urllib.request.urlopen(req, timeout=60).read()
    return len(corpo)


def publicar(log=print) -> bool:
    """Nunca lança erro: quem chama é o robô ou a fila, e a página atrasada não pode derrubar nenhum dos dois."""
    try:
        n = subir(montar())
        log("boletos e financeiro publicado: %d KB" % (n // 1024))
        return True
    except Exception as e:
        log("boletos e financeiro FALHOU %s: %s" % (type(e).__name__, str(e)[:150]))
        return False
