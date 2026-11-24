# venda/mc/testes/test_recibo_pdf.py
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
from venda.mc.recibo_pdf import recibo

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
    assert b"?" in recibo([("x", "seta → aqui")], "T")
