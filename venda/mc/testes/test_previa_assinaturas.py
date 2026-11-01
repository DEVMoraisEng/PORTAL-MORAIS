"""Prévia das assinaturas (dono, 01/11/2026): venda/ferramentas/previa_assinaturas.py desenha, nos PDFs, onde a tinta de
cada assinatura/visto vai cair (calibração da unidade 22) e grava PNGs das páginas afetadas. Só dados inventados."""
import importlib.util, json, pathlib, sys

import pymupdf
import pytest

AQUI = pathlib.Path(__file__).resolve()
SCRIPT = AQUI.parents[2] / "ferramentas" / "previa_assinaturas.py"


def carregar():
    spec = importlib.util.spec_from_file_location("previa_assinaturas", SCRIPT)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def pdf_teste(caminho, paginas=3):
    d = pymupdf.open()
    for i in range(paginas):
        p = d.new_page(width=596, height=842)
        p.insert_text((72, 100), "Página de teste %d" % (i + 1))
    d.save(str(caminho))


def test_marca_vira_png_da_pagina_com_a_caixa_da_tinta(tmp_path):
    m = carregar()
    pdf_teste(tmp_path / "contrato.pdf")
    marcas = [{"doc": "contrato", "papel": "Comprador 1", "kind": "initials", "page": "2", "position": [0.5, 0.5]},
              {"doc": "contrato", "papel": "Vendedor (representante)", "kind": "manuscript", "page": "2", "position": [0.1, 0.2]},
              {"doc": "projeto", "papel": "Comprador 1", "kind": "initials", "page": "1", "position": [0.9, 0.9]}]
    (tmp_path / "previa.json").write_text(json.dumps({"ok": True, "marcas": marcas}), encoding="utf-8")
    saida = tmp_path / "png"
    feitos = m.main(["--marcas", str(tmp_path / "previa.json"), "--pdf", "contrato=" + str(tmp_path / "contrato.pdf"),
                     "--saida", str(saida), "--dpi", "72"])
    assert [pathlib.Path(f).name for f in feitos] == ["contrato-p2.png"], "só a página com marca; projeto sem PDF é pulado"
    pix = pymupdf.Pixmap(str(saida / "contrato-p2.png"))
    # visto: tinta de x+0…x+27, y+9…y+27 (pt) a partir do ponto (298, 421); a borda da caixa é colorida (não branca)
    x, y = int(0.5 * 596), int(0.5 * 842) + 9
    assert pix.pixel(x, y)[:3] != (255, 255, 255)
    assert m.TINTA["manuscript"] == (2, 18, 99, 29) and m.TINTA["initials"] == (0, 9, 27, 27)


def test_sem_marcas_nao_gera_nada(tmp_path):
    m = carregar()
    pdf_teste(tmp_path / "c.pdf", 1)
    (tmp_path / "v.json").write_text(json.dumps({"marcas": []}), encoding="utf-8")
    assert m.main(["--marcas", str(tmp_path / "v.json"), "--pdf", "contrato=" + str(tmp_path / "c.pdf"), "--saida", str(tmp_path / "o")]) == []


def test_sigla_curta_dos_vistos():
    m = carregar()
    assert [m.sigla(p) for p in ["Comprador 1", "Cônjuge do comprador 1", "Comprador 2", "Vendedor (representante)",
                                 "Fiador 2", "Cônjuge do fiador 1", "Testemunha 1", "Corretor"]] == ["C1", "Cj", "C2", "V", "F2", "CjF1", "T1", "Cor"]
