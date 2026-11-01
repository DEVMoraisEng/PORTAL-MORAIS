"""Prévia das assinaturas em imagem (dono, 01/11/2026: "não dá para ver o documento antes de mandar assinar?").

Lê a resposta da ação assinaturaPrevia do PORTAL-VENDA (JSON com as marcas: doc, papel, kind, page, position) e os PDFs
que vão para o envelope, e grava um PNG de cada página que recebe marca, com a caixa onde a TINTA vai cair:
azul = assinatura (manuscript), laranja = visto (initials), com o papel escrito em cima.

Calibração pelos PDFs assinados da unidade 22 (pymupdf: tinta de cada marca × ponto enviado), em pontos a partir do
ponto (canto de cima à esquerda) que o portal manda:
  assinatura: tinta de +2 a +99 na largura e de +18 a +29 na altura (imagem 100×50 da Clicksign);
  visto:      tinta de +0 a +27 na largura e de +9 a +27 na altura (iniciais em fonte de 22 pt).
Os mesmos números estão em venda/assinatura-ui.js (TINTA) e em venda/COMO-IMPLANTAR.md.

Uso (cada --pdf é doc=caminho; doc = "contrato", "memorial", "projeto" ou o nome do termo como a prévia mostra):
  py -3.14 venda/ferramentas/previa_assinaturas.py --marcas previa.json --pdf contrato=CONTRATO.pdf \
     --pdf "CONFISSÃO PRÉ-CHAVES - ....pdf=TERMO.pdf" --pdf projeto=PROJETO.pdf --saida pasta-das-imagens
Os PDFs e as imagens têm dado pessoal: ficam fora do repositório.
"""
import argparse
import json
import pathlib
import re
import sys

import pymupdf

TINTA = {"manuscript": (2, 18, 99, 29), "initials": (0, 9, 27, 27)}
COR = {"manuscript": (0.11, 0.31, 0.85), "initials": (0.76, 0.25, 0.05)}


def _marcas(caminho):
    dados = json.loads(pathlib.Path(caminho).read_text(encoding="utf-8"))
    return dados.get("marcas", []) if isinstance(dados, dict) else list(dados)


def sigla(papel):
    """Rótulo curto do visto (as caixas ficam lado a lado): C1, Cj, C2, V, T1, F1, CjF1…"""
    p = papel or ""
    regras = [(r"^Comprador (\d)", "C"), (r"^Cônjuge do comprador", "Cj"), (r"^Cônjuge do fiador (\d)", "CjF"),
              (r"^Fiador (\d)", "F"), (r"^Testemunha (\d)", "T"), (r"^Vendedor", "V"), (r"^Corretor", "Cor")]
    for padrao, prefixo in regras:
        m = re.match(padrao, p)
        if m:
            return prefixo + (m.group(1) if m.groups() else "")
    return p[:3]


def _nome_arquivo(doc, pagina):
    base = re.sub(r"[^\w.-]+", "_", doc).strip("_")[:60] or "doc"
    return "%s-p%s.png" % (base, pagina)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--marcas", required=True, help="JSON da ação assinaturaPrevia")
    ap.add_argument("--pdf", action="append", default=[], help="doc=caminho do PDF (repita para cada documento)")
    ap.add_argument("--saida", required=True, help="pasta onde gravar os PNGs")
    ap.add_argument("--dpi", type=int, default=110)
    a = ap.parse_args(argv)
    pdfs = {}
    for item in a.pdf:
        doc, _, cam = item.rpartition("=")
        if doc and cam:
            pdfs[doc] = cam
    marcas = _marcas(a.marcas)
    saida = pathlib.Path(a.saida)
    feitos = []
    por_pagina = {}
    for m in marcas:
        por_pagina.setdefault((m["doc"], int(m["page"])), []).append(m)
    for (doc, n), ms in sorted(por_pagina.items()):
        if doc not in pdfs:
            print("sem PDF para %r: %d marca(s) na pág. %d puladas" % (doc, len(ms), n), file=sys.stderr)
            continue
        d = pymupdf.open(pdfs[doc])
        if n < 1 or n > d.page_count:
            print("%s: página %d não existe" % (doc, n), file=sys.stderr)
            continue
        p = d[n - 1]
        W, H = p.rect.width, p.rect.height
        for m in ms:
            t = TINTA.get(m["kind"], TINTA["manuscript"])
            x, y = m["position"][0] * W, m["position"][1] * H
            r = pymupdf.Rect(x + t[0], y + t[1], x + t[2], y + t[3])
            cor = COR.get(m["kind"], (0, 0, 0))
            p.draw_rect(r, color=cor, width=1.5)
            rotulo = sigla(m.get("papel", "")) if m["kind"] == "initials" else m.get("papel", "")
            p.insert_text((r.x0, max(8, r.y0 - 2)), rotulo, fontsize=7, color=cor)
        saida.mkdir(parents=True, exist_ok=True)
        arq = saida / _nome_arquivo(doc, n)
        p.get_pixmap(dpi=a.dpi).save(str(arq))
        feitos.append(str(arq))
        d.close()
    return feitos


if __name__ == "__main__":
    for f in main():
        print(f)
