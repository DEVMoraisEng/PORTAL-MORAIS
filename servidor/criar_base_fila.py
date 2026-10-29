# -*- coding: utf-8 -*-
"""Cria a base "FILA DO ROBÔ" no Notion (uma por ambiente: teste e produção). Só cria; não mexe em mais nada.

    python servidor\\criar_base_fila.py <id da página-mãe (ex.: Brain)> <arquivo com o token do Notion>

Devolve o id da base: ele vai na Propriedade DB_FILA_ROBO do PORTAL-VENDA (e do portal) e no
_central\\robos-portal.json do servidor. A integração do token precisa ter acesso à página-mãe."""
import json
import pathlib
import sys
import urllib.request

COLUNAS = {
    "PEDIDO": {"title": {}},
    "TIPO": {"select": {"options": [{"name": "mc-venda"}, {"name": "SINAL"}]}},
    "PAYLOAD": {"rich_text": {}},
    "SITUAÇÃO": {"select": {"options": [{"name": "PENDENTE"}, {"name": "PEGO"}, {"name": "FEITO"}, {"name": "ERRO"}]}},
    "PEDIDO EM": {"date": {}},
    "RESULTADO": {"rich_text": {}},
    "CONCLUÍDO EM": {"date": {}},
}


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    pai, tok = sys.argv[1].replace("-", ""), pathlib.Path(sys.argv[2]).read_text(encoding="utf-8").strip()
    corpo = {"parent": {"type": "page_id", "page_id": pai},
             "title": [{"type": "text", "text": {"content": "FILA DO ROBÔ (servidor)"}}],
             "properties": COLUNAS}
    req = urllib.request.Request("https://api.notion.com/v1/databases", method="POST", data=json.dumps(corpo).encode(),
                                 headers={"Authorization": "Bearer " + tok, "Notion-Version": "2022-06-28",
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        print("base criada:", json.loads(r.read().decode())["id"].replace("-", ""))


if __name__ == "__main__":
    main()
