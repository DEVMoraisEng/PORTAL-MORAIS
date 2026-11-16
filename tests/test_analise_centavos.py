"""16/11/26: pagamento rateado do Mais Controle não pode perder centavos na compactação."""
import fetch_analise_dados as F


def _p(v):
    return {"cc": "X", "valor": v, "mes": "2026-03", "grupo": "", "categoria": "", "plano_de_conta": "",
            "fornecedor": "", "juros_multa": 0, "descricao": "", "dia": 16}


def test_rateio_em_tres_partes_soma_o_valor_cheio():
    partes = [100 / 3] * 3                       # R$ 100,00 rateados em 3 obras
    rows = F.compactar_pagamentos([_p(v) for v in partes])["rows"]
    assert round(sum(r[1] for r in rows), 2) == 100.00
    assert round(sum(round(v, 2) for v in partes), 2) == 99.99   # o que o arredondamento antigo dava


def test_rateio_real_do_mais_controle():
    partes = [173.427244386751, 4594.70563433121, 5231.86712128204,
              941.124365668793, 1071.63287871796, 35.5227556132494]
    rows = F.compactar_pagamentos([_p(v) for v in partes])["rows"]
    assert round(sum(r[1] for r in rows), 2) == round(sum(partes), 2)
