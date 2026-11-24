# venda/mc/testes/test_recibo_pdf.py
import os, re, sys
import pytest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
from venda.mc.recibo_pdf import recibo, LARGURA_VALOR

def test_pdf_valido_com_acentos():
    b = recibo([("Unidade", "UNIDADE 07"), ("Comprador", "JOÃO DA SILVA TESTE"), ("Valor", "R$ 1.234,56")],
               "DEMONSTRATIVO DE PAGAMENTO DE COMISSÃO")
    assert b.startswith(b"%PDF-1.4") and b.rstrip().endswith(b"%%EOF")
    assert "JOÃO".encode("latin-1") in b and b"R$ 1.234,56" in b
    assert b"startxref" in b

def test_parenteses_e_barra_escapados():
    b = recibo([("Obs", "a (b) c\\d")], "T")
    assert b"a \\(b\\) c\\\\d" in b

def test_caractere_fora_do_latin1_nao_quebra():
    assert b"seta ? aqui" in recibo([("x", "seta → aqui")], "T")

def _textos_do_conteudo(b):
    """Textos (desescapados) de cada operação de texto, na ordem em que aparecem no content stream."""
    corpo = re.search(rb"stream\n(.*?)\nendstream", b, re.S).group(1)
    out = []
    for m in re.finditer(rb"Td \((.*?)(?<!\\)\) Tj", corpo):
        t = m.group(1).replace(b"\\(", b"(").replace(b"\\)", b")").replace(b"\\\\", b"\\")
        out.append(t.decode("latin-1"))
    return out

def test_valor_longo_quebra_em_linhas_de_largura_valor():
    valor = "0123456789" * 15  # 150 caracteres, sem espaço: 48 + 48 + 48 + 6
    textos = _textos_do_conteudo(recibo([("Obs", valor)], "T"))
    assert textos[0] == "T" and textos[1] == "Obs:"
    linhas_valor = textos[2:]
    assert len(linhas_valor) == 4
    assert all(len(t) <= LARGURA_VALOR for t in linhas_valor)
    assert "".join(linhas_valor) == valor

def test_quebra_de_linha_tab_e_cr_viram_espaco():
    textos = _textos_do_conteudo(recibo([("Obs", "a\nb\tc\rd")], "T\nX"))
    assert textos[0] == "T X"
    assert textos[2] == "a b c d"

def test_nao_cabe_levanta_valueerror():
    with pytest.raises(ValueError, match="não cabe"):
        recibo([("Item", "v")] * 60, "T")

def test_xref_aponta_para_cada_objeto():
    b = recibo([("Unidade", "UNIDADE 07")], "T")
    sx = int(re.search(rb"startxref\n(\d+)\n", b).group(1))
    assert b[sx:sx + 4] == b"xref"
    offs = [int(x) for x in re.findall(rb"(\d{10}) 00000 n", b)]
    assert len(offs) == 6
    for i, off in enumerate(offs, 1):
        assert b[off:].startswith(b"%d 0 obj" % i)
