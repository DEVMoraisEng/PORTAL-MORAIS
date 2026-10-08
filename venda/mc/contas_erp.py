# -*- coding: utf-8 -*-
"""Dados bancários (banco, agência, conta) das contas do Mais Controle (Financeiro > Contas bancárias).

    python -m venda.mc.contas_erp sondar            # só LÊ: quantas contas e os NOMES dos campos de uma conta
    python -m venda.mc.contas_erp previa            # só LÊ: o que mudaria (CONTAS_ERP_JSON)
    python -m venda.mc.contas_erp aplicar           # grava (autorização do dono, 08/10/2026)

CONTAS_ERP_JSON (segredo do repositório, nunca no código — repositório público): lista de
{"numero": "12345-6", "banco": "756", "agencia": "1234", "conta": "12345", "contaDigito": "6"}.
A conta do ERP é achada pelo número (só dígitos) no nome ou no campo da conta; precisa ser UMA só.
O log nunca mostra nome, número ou agência: só a posição na lista e o nome do campo que muda."""
import json
import os
import re
import sys

from .erp import Erp, ErpErro

CAMINHO_TODAS = "/financial/bank-accounts/all"
CAMINHO_UMA = "/financial/bank-accounts/%s"


def _itens(resp):
    if isinstance(resp, list):
        return resp
    if isinstance(resp, dict):
        return resp.get("content") or resp.get("data") or resp.get("items") or []
    return []


def _dig(s) -> str:
    return re.sub(r"\D", "", str(s or ""))


def _chave(s) -> str:
    import unicodedata
    t = unicodedata.normalize("NFD", str(s or ""))
    return " ".join("".join(c for c in t if unicodedata.category(c) != "Mn").upper().split())


def achar(contas: list, numero: str, nome: str = "") -> list:
    """Pelo NOME exato (sem acento/caixa) quando vem; senão, contas cujo nome contém o número (só dígitos)."""
    if nome:
        return [c for c in contas if _chave(c.get("name")) == _chave(nome)]
    alvo = _dig(numero).lstrip("0")
    out = []
    for c in contas:
        no_nome = alvo and alvo in _dig(c.get("name"))
        no_campo = alvo and _dig(str(c.get("account") or "") + str(c.get("accountDigit") or "")).lstrip("0") == alvo
        if no_nome or no_campo:
            out.append(c)
    return out


def mudancas(detalhe: dict, pedido: dict) -> dict:
    """Campos do detalhe da conta que mudam (só banco, agência e conta)."""
    nomes = {"banco": "bankCode", "agencia": "agency", "agenciaDigito": "agencyDigit", "conta": "account", "contaDigito": "accountDigit"}
    alvo = {campo: pedido[k] for k, campo in nomes.items() if k in pedido}   # só o que foi pedido (o resto fica como está)
    def igual(k, atual, novo):   # "00050022" = "50022" (zeros à esquerda na conta/agência não mudam o número)
        if k in ("account", "agency") and _dig(atual) and _dig(atual).lstrip("0") == _dig(novo).lstrip("0"):
            return True
        return str(atual or "") == str(novo or "")
    return {k: v for k, v in alvo.items() if k in detalhe and not igual(k, detalhe.get(k), v)}


def main(argv=None) -> int:
    modo = (argv if argv is not None else sys.argv[1:] or ["sondar"])[0]
    erp = Erp(os.environ["MC_ROBO_EMAIL"].strip(), os.environ["MC_ROBO_SENHA"].strip(chr(13) + chr(10)),
              aparelho=os.environ.get("MC_ROBO_APARELHO", "").strip())
    contas = _itens(erp.pedir_core("GET", CAMINHO_TODAS))
    print("contas no ERP:", len(contas))
    if modo == "sondar":
        if contas:
            d = erp.pedir_core("GET", CAMINHO_UMA % contas[0]["id"])
            print("campos da lista:", sorted(contas[0].keys()))
            print("campos do detalhe:", sorted((d or {}).keys()))
            for k in ("bankCode", "agency", "agencyDigit", "account", "accountDigit", "bank"):
                if k in (d or {}):
                    v = d[k]
                    print(f"  {k}: tipo {type(v).__name__}, {'vazio' if v in (None, '', {}) else 'preenchido'}"
                          + (f", chaves {sorted(v.keys())}" if isinstance(v, dict) else ""))
        return 0
    pedidos = json.loads(os.environ.get("CONTAS_ERP_JSON") or "[]")
    erros = 0
    for i, p in enumerate(pedidos, 1):
        achadas = achar(contas, p.get("numero", ""), p.get("nome", ""))
        if len(achadas) != 1:
            print(f"{i:02d}: {len(achadas)} contas com esse número no ERP — pulada"); erros += 1; continue
        cid = achadas[0]["id"]
        d = erp.pedir_core("GET", CAMINHO_UMA % cid) or {}
        mud = mudancas(d, p)
        print(f"{i:02d}: {'muda ' + ', '.join(sorted(mud)) if mud else 'já certa'}")
        if modo in ("aplicar", "aplicar1") and mud:
            corpo = dict(d); corpo.update(mud)
            try:
                erp.pedir_core("PUT", CAMINHO_UMA % cid, corpo=corpo)
                d2 = erp.pedir_core("GET", CAMINHO_UMA % cid) or {}
                print(f"    gravada; conferida: {'ok' if not mudancas(d2, p) else 'DIFERENTE do pedido'}")
            except ErpErro as e:
                print(f"    ERRO ao gravar: {str(e)[:300]}"); erros += 1
            if modo == "aplicar1":
                print("aplicar1: parei depois da primeira conta gravada"); break
    return 1 if erros else 0


if __name__ == "__main__":
    sys.exit(main())
