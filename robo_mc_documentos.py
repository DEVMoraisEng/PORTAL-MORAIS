#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
robo_mc_documentos.py — PORTAL-MORAIS · SÓ LEITURA no Mais Controle (05/11/26)

Vigia diário dos documentos do Orçamento: para cada casa de rua com venda aberta, procura em Obras › Orçamento do
Mais Controle (pastas da obra, origem PLANNING) a matrícula, a certidão mãe, o alvará e o habite-se e anexa no
dossiê do imóvel da VENDAS o que for novo, marcado como "novo, não lido". Copia também o proprietário da obra no MC
nas colunas VENDEDOR MC - … (o contrato usa para completar o vendedor). Nada é gravado no ERP.

No servidor:  python servidor\\robo_fila.py --robo documentos   (MC_VIA=porteiro; grava só com ROBOS_APLICAR.txt)
Ambiente: NOTION_TOKEN, DB_VENDAS. Detalhes em venda/mc/documentos_obra.py e SERVIDOR-ROBOS.md.
Log curto: contagens e 8 letras do id da página — nunca nome, endereço, CPF ou nome de arquivo.
"""
import sys

from venda.mc import documentos_obra

if __name__ == "__main__":
    sys.exit(documentos_obra.main())
