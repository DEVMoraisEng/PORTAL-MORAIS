#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
robo_mc_boletos.py — PORTAL-MORAIS · boletos do mês do Reserva dos Ipês pela Cobrança Fácil (06/11/2026)

Lista as parcelas do mês vigente, decide emitir / aguardar / decidir / pular (venda/mc/boletos.py) e,
SÓ com o arquivo _central\\BOLETOS_APLICAR.txt (interruptor do dono), emite os boletos um a um.
Grava AAAA-MM-DD_HHMM.json e .html em _central\\boletos (fora do repositório; o relatório leva nome e valor).

No servidor rode pela fila (passa pela vez no Mais Controle): python servidor\\robo_fila.py --robo boletos
(chama este script com --emitir; sem o arquivo do interruptor vira prévia).
  --previa     só monta o relatório
  --emitir     emite o que estiver "emitir" (sem o arquivo vira prévia; só no mês de hoje)

Sem o índice do mês (INCC-M/IPCA), só pré-chaves, pós-chaves e balão vão para "decidir" (motivo com o
índice que falta); sinal e entrada continuam saindo e isso não muda o código de saída.
Parcela que ficou SEM_CONFIRMACAO num relatório anterior do mesmo mês e continua sem boleto vai para
"decidir": nunca um 2º pedido sem alguém conferir no Mais Controle.
Variáveis: MC_CENTRAL (pasta central), BOLETOS_SO (ids de parcela separados por vírgula: só essas).
Saída: 0 tudo certo · 1 houve RECUSADO ou SEM_CONFIRMACAO · 2 trava (saldo, teto, interruptor, mês) · 3 ERP fora.
O stdout só leva contagens e, antes delas, "trava: <motivo>" e "índice faltando: <lista>" (sem dado pessoal).
"""
import argparse
import datetime as dt
import html
import json
import os
import sys
import time
from pathlib import Path

from venda.mc import boletos as B

CENTRAL = Path(os.environ.get("MC_CENTRAL") or r"C:\AUTOMAÇÕES MAIS CONTROLE\_central")
APLICAR = CENTRAL / "BOLETOS_APLICAR.txt"
PASTA = CENTRAL / "boletos"
ACOES = ("emitir", "aguardar", "decidir", "pular")
SEM_INDICE = {"pre", "pos", "balao"}


def _montar_linhas(erp, mes, hoje):
    linhas = []
    for vid in B.vendas_do_mes(erp, mes):
        v = B.ler_venda(erp, vid)
        for l in B.selecionar(v, mes, hoje):
            l["comprador"] = str(v.get("description") or "")
            linhas.append(l)
    return linhas


def _aplicar_indices(erp, mes, linhas) -> list[str]:
    """Sem o índice do mês, pré, pós e balão não emitem (sinal e entrada seguem). Devolve o que falta."""
    if not any(l["acao"] == "emitir" and l["tipo"] in SEM_INDICE for l in linhas):
        return []
    falta = B.indices_faltando(B.ler_tabelas(erp), mes)
    if not falta:
        return []
    for l in linhas:
        if l["acao"] == "emitir" and l["tipo"] in SEM_INDICE:
            l.update(acao="decidir", motivo="índice do mês ainda não lançado: " + ", ".join(falta))
    return falta


def _sem_confirmacao_antes(pasta, mes) -> dict:
    """{parcela: data do relatório} das parcelas que ficaram SEM_CONFIRMACAO em relatório anterior do mês."""
    vistas = {}
    try:
        arquivos = sorted(Path(pasta).glob("*.json"))
    except OSError:
        return vistas
    for arq in arquivos:
        try:
            rel = json.loads(arq.read_text(encoding="utf-8"))
            if rel.get("mes") != mes:
                continue
            for r in rel.get("resultados") or []:
                if r.get("situacao") == "SEM_CONFIRMACAO" and r.get("parcela"):
                    vistas[r["parcela"]] = str(rel.get("hoje") or arq.stem[:10])
        except Exception:
            print("boletos: relatório anterior ilegível, pulado (%s)" % arq.name, file=sys.stderr)
    return vistas


def _segurar_sem_confirmacao(pasta, mes, linhas):
    """Um pedido sem confirmação pode ter nascido depois: não pede de novo, manda conferir."""
    antes = _sem_confirmacao_antes(pasta, mes)
    for l in linhas:
        if l["acao"] == "emitir" and l["parcela"] in antes:
            l.update(acao="decidir", motivo="emissão sem confirmação em %s: conferir no Mais Controle antes de emitir"
                     % antes[l["parcela"]])


def _contagem(linhas, resultados):
    c = {a: sum(1 for l in linhas if l["acao"] == a) for a in ACOES}
    c["emitidos"] = sum(1 for r in resultados if r["situacao"] == "EMITIDO")
    c["recusados"] = sum(1 for r in resultados if r["situacao"] == "RECUSADO")
    c["sem_confirmacao"] = sum(1 for r in resultados if r["situacao"] == "SEM_CONFIRMACAO")
    return c


def _brl(x):
    return "{:,.2f}".format(float(x or 0)).replace(",", "X").replace(".", ",").replace("X", ".")


def _html(rel):
    e = html.escape
    resultado = {r["parcela"]: r for r in rel["resultados"]}
    titulos = {"emitir": "A emitir / emitidos", "aguardar": "Aguardando a data", "decidir": "Para decidir",
               "pular": "Pulados"}
    p = ["<!doctype html><html lang='pt-BR'><head><meta charset='utf-8'><title>Boletos do mês</title>",
         "<style>body{font:14px sans-serif;margin:24px}table{border-collapse:collapse;margin-bottom:24px}"
         "td,th{border:1px solid #bbb;padding:4px 8px;text-align:left}th{background:#eee}</style></head><body>",
         "<h1>Boletos de %s (%s)</h1>" % (e(rel["mes"]), e(rel["modo"]))]
    if rel["trava"]:
        p.append("<p><b>Trava: %s</b></p>" % e(rel["trava"]))
    for a in ACOES:
        grupo = [l for l in rel["linhas"] if l["acao"] == a]
        p.append("<h2>%s (%d)</h2><table><tr><th>Comprador</th><th>Vencimento</th><th>Tipo</th>"
                 "<th>Valor</th><th>Parcela</th><th>Situação</th></tr>" % (titulos[a], len(grupo)))
        for l in grupo:
            r = resultado.get(l["parcela"])
            sit = (r["situacao"] + (" - " + r["motivo"] if r.get("motivo") else "")) if r else l.get("motivo", "")
            p.append("<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>" % (
                e(l.get("comprador", "")), e(l["data"]), e(l["tipo"]), _brl(l["valor"]),
                e(str(l["parcela"])[:8]), e(sit)))
        p.append("</table>")
    p.append("</body></html>")
    return "".join(p)


def _nome_unico(pasta, hoje):
    pasta = Path(pasta)
    base = "%s_%s" % (hoje, dt.datetime.now().strftime("%H%M%S"))
    nome, n = base, 1
    while (pasta / (nome + ".json")).exists() or (pasta / (nome + ".html")).exists():
        n += 1
        nome = "%s_%d" % (base, n)
    return nome


def _gravar(pasta, nome, rel):
    pasta = Path(pasta)
    pasta.mkdir(parents=True, exist_ok=True)
    (pasta / (nome + ".json")).write_text(json.dumps(rel, ensure_ascii=False, indent=1), encoding="utf-8")
    (pasta / (nome + ".html")).write_text(_html(rel), encoding="utf-8")


def rodar(erp, mes: str, emitir: bool, aprovadas: set | None, pasta: Path, hoje: str | None = None,
          esperar=time.sleep) -> int:
    hoje = hoje or dt.date.today().isoformat()
    fora_do_mes = emitir and mes != hoje[:7]
    modo = "emissao" if emitir and APLICAR.exists() and not fora_do_mes else "previa"
    linhas, resultados, trava, fora, falta = [], [], None, False, []
    if fora_do_mes:
        trava = "emissão só no mês vigente"
    nome = _nome_unico(pasta, hoje)

    def salvar():
        rel = {"modo": modo, "mes": mes, "hoje": hoje, "contagem": _contagem(linhas, resultados),
               "linhas": linhas, "resultados": resultados, "trava": trava}
        try:
            _gravar(pasta, nome, rel)
        except Exception as ex:
            print("boletos: não consegui gravar o relatório (%s)" % type(ex).__name__, file=sys.stderr)
    try:
        linhas = _montar_linhas(erp, mes, hoje)
        falta = _aplicar_indices(erp, mes, linhas)
        _segurar_sem_confirmacao(pasta, mes, linhas)
    except Exception as ex:
        fora, trava = True, "ERP fora ao montar a lista: " + (str(ex) or type(ex).__name__)[:200]
    alvo = [l for l in linhas if l["acao"] == "emitir" and (aprovadas is None or l["parcela"] in aprovadas)]
    if modo == "emissao" and alvo and not fora:
        try:
            trava = B.travas(alvo, B.ler_saldo(erp))
        except Exception as ex:
            fora, trava = True, "ERP fora ao ler o saldo: " + (str(ex) or type(ex).__name__)[:200]
        if not trava and not fora:
            feitas = set()
            for l in alvo:
                if l["parcela"] in feitas:
                    continue
                if not APLICAR.exists():
                    trava = "interruptor desligado no meio da rodada"
                    break
                feitas.add(l["parcela"])
                try:
                    r = B.emitir_uma(erp, l["venda"], l["parcela"], esperar=esperar)
                except Exception as ex:   # só a leitura antes do POST levanta: nada foi pedido
                    fora, trava = True, "ERP fora antes de emitir: " + (str(ex) or type(ex).__name__)[:200]
                    break
                resultados.append(dict(r, venda=l["venda"], parcela=l["parcela"]))
                salvar()
    c = _contagem(linhas, resultados)
    salvar()
    fim = "boletos: %d emitidos, %d aguardando, %d decidir, %d pulados" % (
        c["emitidos"], c["aguardar"], c["decidir"], c["pular"])
    if c["recusados"] or c["sem_confirmacao"]:
        fim += ", %d recusados, %d sem confirmação" % (c["recusados"], c["sem_confirmacao"])
    if trava and not fora:   # saldo, teto, interruptor ou mês: rótulo sem dado pessoal
        print("trava: " + trava)
    if falta:
        print("índice faltando: " + ", ".join(falta))
    print(fim)
    if fora:
        return 3
    if trava:
        return 2
    return 1 if c["recusados"] or c["sem_confirmacao"] else 0


def main(argv=None) -> int:
    a = argparse.ArgumentParser()
    g = a.add_mutually_exclusive_group()
    g.add_argument("--previa", action="store_true")
    g.add_argument("--emitir", action="store_true")
    a.add_argument("--mes")
    a.add_argument("--pasta")
    args = a.parse_args(argv)
    hoje = dt.date.today().isoformat()
    so = {x.strip() for x in os.environ.get("BOLETOS_SO", "").split(",") if x.strip()}
    from venda.mc import erp as E
    erp = E.do_ambiente()
    try:
        return rodar(erp, args.mes or hoje[:7], args.emitir, so or None, Path(args.pasta) if args.pasta else PASTA, hoje)
    finally:
        if hasattr(erp, "fechar"):
            erp.fechar()


if __name__ == "__main__":
    sys.exit(main())
