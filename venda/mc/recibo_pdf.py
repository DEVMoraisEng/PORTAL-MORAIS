# -*- coding: utf-8 -*-
"""Recibo (demonstrativo interno) de uma página em PDF, só com a biblioteca padrão: o servidor do escritório
não tem reportlab garantido. Texto em WinAnsi (latin-1); o que não couber vira '?'. Valor longo quebra em
várias linhas; se o conteúdo não couber numa página, levanta ValueError."""
from __future__ import annotations

import textwrap

LARGURA_VALOR = 48   # 48 × 11 pt × 0,67 ≈ 354 pt < 385 pt (de x=210 até a borda direita, 595)
LARGURA_TITULO = 50  # 50 × 14 pt × 0,72 ≈ 504 pt < 535 pt (de x=60 até a borda direita, 595)
_PE_DA_PAGINA = 50   # y mínimo (pt) da última linha de texto


def _limpa(s: str) -> str:
    return str(s).replace("\r", " ").replace("\n", " ").replace("\t", " ")


def _esc(s: str) -> bytes:
    b = _limpa(s).encode("latin-1", "replace")
    return b.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")


def _linha(y: int, x: int, fonte: str, tamanho: int, texto: str) -> bytes:
    cabeca = "BT /%s %d Tf %d %d Td (" % (fonte, tamanho, x, y)
    return cabeca.encode("ascii") + _esc(texto) + b") Tj ET"


def recibo(linhas: list[tuple[str, str]], titulo: str) -> bytes:
    partes, y = [], 780
    for pedaco in textwrap.wrap(_limpa(titulo), LARGURA_TITULO) or [""]:
        partes.append(_linha(y, 60, "F2", 14, pedaco))
        y -= 18
    y -= 18
    for rot, val in linhas:
        for i, pedaco in enumerate(textwrap.wrap(_limpa(val), LARGURA_VALOR) or [""]):
            if y < _PE_DA_PAGINA:
                raise ValueError("recibo não cabe em uma página")
            if i == 0:
                partes.append(_linha(y, 60, "F2", 11, _limpa(rot) + ":"))
            partes.append(_linha(y, 210, "F1", 11, pedaco))
            y -= 14
        y -= 6
    conteudo = b"\n".join(partes)
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
        b"<< /Length %d >>\nstream\n" % len(conteudo) + conteudo + b"\nendstream",
    ]
    out, offs = bytearray(b"%PDF-1.4\n"), []
    for i, o in enumerate(objs, 1):
        offs.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for o in offs:
        out += b"%010d 00000 n \n" % o
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    return bytes(out)
