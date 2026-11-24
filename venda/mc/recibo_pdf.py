# -*- coding: utf-8 -*-
"""Recibo (demonstrativo interno) de uma página em PDF, só com a biblioteca padrão: o servidor do escritório
não tem reportlab garantido. Texto em WinAnsi (latin-1); o que não couber vira '?'."""
from __future__ import annotations


def _esc(s: str) -> bytes:
    b = str(s).encode("latin-1", "replace")
    return b.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")


def recibo(linhas: list[tuple[str, str]], titulo: str) -> bytes:
    y, partes = 780, [b"BT /F2 14 Tf 60 780 Td (" + _esc(titulo) + b") Tj ET"]
    y -= 36
    for rot, val in linhas:
        partes.append(b"BT /F2 11 Tf 60 %d Td (" % y + _esc(rot + ":") + b") Tj ET")
        partes.append(b"BT /F1 11 Tf 210 %d Td (" % y + _esc(val) + b") Tj ET")
        y -= 20
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
