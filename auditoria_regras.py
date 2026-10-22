#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
auditoria_regras.py — PORTAL-MORAIS · Auditoria Financeira
Morais Engenharia e Construção

O MOTOR DA AUDITORIA. Confere cada pagamento do Mais Controle contra o
Manual do Plano de Contas e Categorias: a descrição e o fornecedor dizem qual
deveria ser a categoria; o motor compara com a categoria, o plano, o centro de
custo e o cadastro da categoria no ERP.

DE ONDE VEM O MANUAL
  O manual mora no Supabase (fin_manual_secoes / fin_manual_categorias /
  fin_manual_textos) e é editado pela aba "Manual" do portal por quem tem
  GFINANCEIRO. O robô (robo_auditoria_fin.py) lê essas tabelas e entrega as
  linhas para o Motor. MANUAL_PADRAO, logo abaixo, é a versão de ago/2026 (o
  PDF "Manual do Plano de Contas e Categorias") e só é usada para semear as
  tabelas na primeira rodada, ou se o Supabase estiver fora do ar.

  O que vem do manual e o que vem do código:
    manual  -> plano esperado, classificação (Gestão de Obra), escopo
               (ADM/OBRA/...), uso (ok / último recurso / descontinuada),
               texto e PALAVRAS-CHAVE de cada categoria.
    código  -> as regras de palavras (R, logo abaixo), que reconhecem o
               assunto da descrição. Categoria nova criada no portal com
               palavras-chave passa a ser reconhecida sem mexer aqui.

SITUAÇÕES (status)
  DIVERGENTE     a descrição indica outra categoria
  MISTO          título com despesas de naturezas diferentes
  GENERICA       "Outras Despesas"/"Taxas gerais"/... (último recurso)
  DESCONTINUADA  categoria antiga que não deve mais ser usada
  SEM_DESCRICAO  descrição vazia ou genérica demais para confirmar
  CC             centro de custo incoerente com a categoria
  CADASTRO       categoria fora do manual, ou plano diferente do manual
  NAO_AVALIADO   descrição sem termo reconhecido (nem confirma nem contesta)
  OK             conforme
"""

import difflib
import re
import unicodedata


def N(s):
    """Normaliza para comparar: sem acento, maiúsculas, espaços simples."""
    if s is None:
        return ""
    try:
        if s != s:          # NaN
            return ""
    except Exception:
        pass
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().upper()
    return re.sub(r"\s+", " ", s).strip()


# =============================================================================
# 1) MANUAL PADRÃO (ago/2026) — só para semear o Supabase
# =============================================================================
OG = "Oculta na Gestão"

SECOES_PADRAO = [
    # id, parte, título, resultado, classificação, escopo (texto), nota, ordem
    ("P1-01", 1, "1. Folha de Pagamento", "Despesas Operacionais", OG, "ESCRITÓRIO", "", 101),
    ("P1-02", 1, "2. Remuneração de Engenheiros", "Despesas Operacionais", "Mão de Obra (Terceirizada)", "ESCRITÓRIO", "", 102),
    ("P1-03", 1, "3. Honorários", "Despesas Operacionais", "Outros", "ESCRITÓRIO", "", 103),
    ("P1-04", 1, "4. Despesas Administrativas", "Despesas Operacionais", "Outros", "ESCRITÓRIO", "", 104),
    ("P1-05", 1, "5. Tecnologia e Sistemas", "Despesas Operacionais", "Outros", "ESCRITÓRIO", "", 105),
    ("P1-06", 1, "6. Utilidades", "Despesas Operacionais", "Outros", "ESCRITÓRIO", "", 106),
    ("P1-07", 1, "7. Ocupação do Escritório", "Despesas Operacionais", "Outros", "ESCRITÓRIO", "", 107),
    ("P1-08", 1, "8. Veículos, Mobilidade e Seguros", "Despesas Variáveis", "Outros", "ESCRITÓRIO", "", 108),
    ("P1-09", 1, "9. Impostos Corporativos", "Despesas Operacionais", "Outros", "ESCRITÓRIO", "", 109),
    ("P1-10", 1, "10. Taxas e Registros Corporativos", "Despesas Operacionais", "Outros", "ESCRITÓRIO", "", 110),
    ("P1-11", 1, "11. Tarifas Bancárias", "Resultado Financeiro", "Outros", "ESCRITÓRIO", "", 111),
    ("P1-12", 1, "12. Treinamento e Desenvolvimento", "Despesas Operacionais", "Outros", "ESCRITÓRIO", "", 112),
    ("P1-13", 1, "13. Despesas Jurídicas e Trabalhistas", "Despesas Operacionais", "Outros", "ESCRITÓRIO", "", 113),
    ("P1-14", 1, "14. Financiamento de Imóvel (Escritório)", "Nenhum (não impacta DRE)", OG, "ESCRITÓRIO", "", 114),
    ("P2-15", 2, "15. Custos de Obra — Taxas e Legalização", "Despesas Variáveis", "Outros", "OBRA", "", 215),
    ("P2-16", 2, "16. Seguros de Obra", "Despesas Variáveis", "Outros", "OBRA", "", 216),
    ("P2-17", 2, "17. Financiamento de Empreendimento — Encargos", "Resultado Financeiro", "Outros", "OBRA", "", 217),
    ("P2-18", 2, "18. Financiamento de Empreendimento — Amortização", "Nenhum (não impacta DRE)",
     "Oculta na Gestão (amortização) / Outros (juros)", "OBRA", "", 218),
    ("P3-A", 3, "Custos diretos de obra", "", "", "OBRA", "", 301),
    ("P3-B", 3, "Terrenos, cartório e comissões", "", "", "", "", 302),
    ("P3-C", 3, "Societário e financeiro", "", "", "", "", 303),
    ("P3-D", 3, "Uso restrito", "", "", "", "", 304),
]

PARTES_PADRAO = {
    1: ("Parte 1 — Planos Administrativos (escritório)",
        "Todos lançados no CC ESCRITÓRIO - MORAIS ENGENHARIA, salvo indicação em contrário."),
    2: ("Parte 2 — Planos de Obra e Financiamento de Empreendimento",
        "Sempre lançar no centro de custo da obra/lote correspondente."),
    3: ("Parte 3 — Categorias já existentes (mantidas)",
        "Categorias que já existiam no sistema e continuam em uso, com o plano de conta em que estão "
        "cadastradas no Mais Controle. Sempre com o centro de custo correto."),
}

# (seção, categoria, plano, classificação, escopo, uso, texto)
#   escopo: ADM | OBRA | SOC (aportes) | ADIANT (adiantamento de comissão) | ANY
#   uso:    ok | generica (último recurso) | descontinuada | restrita (não auditada)
_F, _H, _D, _U, _V = ("Folha de Pagamento", "Honorários", "Despesas Administrativas",
                      "Utilidades", "Veículos, Mobilidade e Seguros")
_I, _T, _C = "Impostos Corporativos", "Taxas e Registros Corporativos", "Custos de Obra — Taxas e Legalização"
_E, _A = "Financiamento de Empreendimento — Encargos", "Financiamento de Empreendimento — Amortização"
_REG, _TXG = "TAXAS - REGULARIZAÇAO COMPRA DO LOTE", "TAXAS GERAIS - OBRA E AVERBAÇÃO"

CATEGORIAS_PADRAO = [
    ("P1-01", "Salário", _F, OG, "ADM", "ok", "Salários dos funcionários CLT, incluindo vale-transporte pago junto da folha. Ex.: SALÁRIO, V.T."),
    ("P1-01", "Adiantamento Salarial", _F, OG, "ADM", "ok", "Adiantamentos quinzenais ou avulsos de salário. Ex.: ADIANTAMENTO SALÁRIO."),
    ("P1-01", "FGTS", _F, OG, "ADM", "ok", "Guias mensais de FGTS e FGTS de 13º."),
    ("P1-01", "INSS / IRRF Folha", _F, OG, "ADM", "ok", "Guias de INSS e IRRF incidentes sobre a folha (DARF/GPS da folha)."),
    ("P1-01", "13º Salário", _F, OG, "ADM", "ok", "Parcelas do décimo terceiro."),
    ("P1-01", "Férias", _F, OG, "ADM", "ok", "Pagamento de férias e abono. Ex.: FÉRIAS."),
    ("P1-01", "Rescisão", _F, OG, "ADM", "ok", "Verbas rescisórias de desligamento."),
    ("P1-01", "Estagiário", _F, OG, "ADM", "ok", "Bolsa de estágio e taxa do agente de integração. Ex.: ESTÁGIO + IEL."),
    ("P1-01", "Contribuição Sindical", _F, OG, "ADM", "ok", "Repasse ao sindicato da contribuição assistencial/sindical descontada dos salários."),
    ("P1-02", "Remuneração de Engenheiro", "Remuneração de Engenheiros", "Mão de Obra (Terceirizada)", "ADM", "ok",
     "Honorários mensais PJ dos engenheiros de campo. Ex.: NF mensal do engenheiro. Não misturar com reembolso de combustível — lançar separado em Veículos » Combustível."),
    ("P1-03", "Honorários Contábeis", _H, "Outros", "ADM", "ok", "Mensalidade da contabilidade e serviços contábeis avulsos (PLD, obrigações acessórias)."),
    ("P1-03", "Honorários Advocatícios", _H, "Outros", "ADM", "ok", "Honorários de advogados e escritórios. Ex.: GONÇALVES NUNES."),
    ("P1-03", "BPO Financeiro", _H, "Outros", "ADM", "ok", "Terceirização do financeiro. Ex.: GVC, serviços financeiros."),
    ("P1-03", "Consultoria / Recrutamento", _H, "Outros", "ADM", "ok", "Consultorias (NAUE, MOB, PBQPH) e taxas de recrutamento/fechamento de vaga."),
    ("P1-03", "SST / Medicina do Trabalho", _H, "Outros", "ADM", "ok", "Laudos e-Social, PCMSO/PGR, exames admissionais e periódicos. Ex.: PROTEGE."),
    ("P1-03", "Serviços financeiros", _H, "Outros", "ADM", "ok", "Serviços financeiros de prestadores fixos da equipe (distinto do BPO terceirizado)."),
    ("P1-04", "Material Escritório", _D, "Outros", "ADM", "ok", "Papelaria, itens de escritório, móveis, decoração, eletrônicos de uso interno. Ex.: cadeiras, tablet."),
    ("P1-04", "Limpeza do Escritório", _D, "Outros", "ADM", "ok", "Diarista e produtos/serviços de limpeza do escritório. Ex.: diarista, produtos de limpeza."),
    ("P1-04", "Alimentação / Lanches", _D, "Outros", "ADM", "ok", "Lanches, coffee-break, supermercado e bolos do dia a dia. Eventos e confraternizações maiores vão em Eventos e Confraternizações."),
    ("P1-04", "Uniformes", _D, "Outros", "ADM", "ok", "Uniformes e camisetas da equipe. Ex.: GRUPO DIALETO."),
    ("P1-04", "Estacionamento / Frete", _D, "Outros", "ADM", "ok", "Estacionamentos (Multipark, reembolsos) e fretes de documentos/pequenos volumes. Ex.: motoboy, Multipark."),
    ("P1-04", "Certificado Digital", _D, "Outros", "ADM", "ok", "Certificados digitais e-CNPJ/e-CPF e renovações."),
    ("P1-04", "Reembolso Diverso", _D, "Outros", "ADM", "generica", "Reembolsos administrativos que não se encaixem nas demais (uso pontual — descrever bem)."),
    ("P1-04", "Marketing", _D, "Outros", "ANY", "ok", "Publicidade, propaganda, filmagens e material de divulgação. Ex.: GRIFO PROPAGANDA."),
    ("P1-04", "Eventos e Confraternizações", _D, "Outros", "ADM", "ok", "Eventos, confraternizações e reuniões da equipe. Ex.: GRÁ BISTRO."),
    ("P1-04", "Brindes", _D, "Outros", "ANY", "ok", "Brindes para funcionários, engenheiros e corretores. Ex.: garrafas personalizadas (FASTLASER)."),
    ("P1-05", "Software / Assinatura Digital", "Tecnologia e Sistemas", "Outros", "ADM", "ok", "Mensalidade do Mais Controle, OC Cloud, Claude, Google Play, Box e demais softwares e assinaturas."),
    ("P1-06", "Energia (Escritório)", _U, "Outros", "ADM", "ok", "Contas de energia das salas 1212/1213, incluindo energia solar. Ex.: ENERGIA SALA 1212, energia solar."),
    ("P1-06", "Fatura de Água", _U, "Outros", "ADM", "ok", "Contas de água do escritório."),
    ("P1-06", "Internet / Celular", _U, "Outros", "ADM", "ok", "Internet fixa (LINQ) e linhas móveis (CLARO) do escritório e da equipe."),
    ("P1-06", "Conta de energia", _U, "Outros", "ANY", "descontinuada", "Categoria antiga movida para este plano. NÃO usar em novos lançamentos — preferir Energia (Escritório). Mantida apenas pelo histórico."),
    ("P1-06", "Conta de água", _U, "Outros", "ANY", "descontinuada", "Categoria antiga movida para este plano. NÃO usar em novos lançamentos — preferir Fatura de Água. Mantida apenas pelo histórico."),
    ("P1-06", "Conta de internet", _U, "Outros", "ANY", "descontinuada", "Categoria antiga movida para este plano. NÃO usar em novos lançamentos — preferir Internet / Celular. Mantida apenas pelo histórico."),
    ("P1-07", "Condomínio", "Ocupação do Escritório", "Outros", "ADM", "ok", "Condomínio e fundo de reserva das salas. Ex.: JK NEW CONCEPT."),
    ("P1-07", "IPTU - Administrativo", "Ocupação do Escritório", "Outros", "ADM", "ok", "IPTU somente das salas 1212 e 1213. IPTU de terreno de obra NÃO entra aqui."),
    ("P1-08", "Combustível", _V, "Outros", "ANY", "ok", "Abastecimentos da frota e reembolsos de combustível (inclusive de engenheiros)."),
    ("P1-08", "Manutenção de Veículos", _V, "Outros", "ANY", "ok", "Manutenção, peças e pneus. Ex.: KWID, STRADA."),
    ("P1-08", "Seguro de Veículos", _V, "Outros", "ANY", "ok", "Seguro/proteção veicular da frota. Ex.: PROTEGECLUB."),
    ("P1-09", "IRPJ / CSLL", _I, "Outros", "ANY", "ok", "DARFs trimestrais/mensais de IRPJ e CSLL da Morais Engenharia."),
    ("P1-09", "PIS / COFINS", _I, "Outros", "ANY", "ok", "DARFs de PIS e COFINS."),
    ("P1-09", "ISS", _I, "Outros", "ANY", "ok", "ISS próprio da empresa sobre serviços prestados. Ex.: guias mensais de ISS."),
    ("P1-09", "IRRF s/ Serviços Tomados", _I, "Outros", "ANY", "ok", "IRRF retido sobre serviços tomados de terceiros."),
    ("P1-09", "DARF RET (Incorporação)", _I, "Outros", "OBRA", "ok", "DARF unificado do Regime Especial de Tributação, por SPE/empreendimento. Lançar no CC da obra/SPE. Ex.: DARF RET - CASA 12."),
    ("P1-09", "ISSQN Retido s/ Serviços de Obra", _I, "Outros", "OBRA", "ok", "ISSQN retido de prestadores em obras (quando a empresa é a tomadora). Regra de uso definida com a contabilidade."),
    ("P1-10", "Anuidade CREA", _T, "Outros", "ADM", "ok", "Anuidade CREA da empresa e dos engenheiros (quando paga pela empresa)."),
    ("P1-10", "Taxa JUCEG / Abertura CNPJ", _T, "Outros", "ANY", "ok", "Taxas de junta comercial, abertura/alteração de CNPJ e constituição de SPE/SCP/RET. Ex.: CONSTITUIÇÃO SCP, CONSTITUIÇÃO DO CNPJ RET."),
    ("P1-10", "Certidão Corporativa", _T, "Outros", "ANY", "ok", "Certidões da empresa (negativas, regularidade) não ligadas a uma obra específica."),
    ("P1-10", "TLF / Taxa Municipal (Escritório)", _T, "Outros", "ADM", "ok", "TLF e taxas municipais do escritório. TLF de obra vai em Custos de Obra."),
    ("P1-11", "Tarifas Bancárias", "Tarifas Bancárias", "Outros", "ANY", "ok", "Pacote de serviços, tarifas de Pix/TED, manutenção de conta."),
    ("P1-11", "IOF / Juros Bancários", "Tarifas Bancárias", "Outros", "ANY", "ok", "IOF, juros de cheque especial e encargos de conta."),
    ("P1-12", "Curso / Capacitação", "Treinamento e Desenvolvimento", "Outros", "ADM", "ok", "Cursos, treinamentos e reembolsos de curso. Ex.: INCORPORA PRO."),
    ("P1-13", "Custas Processuais", "Despesas Jurídicas e Trabalhistas", "Outros", "ADM", "ok", "Custas, taxas de abertura de processo, depósitos judiciais, guias de processos. Ex.: depósito judicial, guia batida STRADA."),
    ("P1-13", "Indenização Trabalhista", "Despesas Jurídicas e Trabalhistas", "Outros", "ADM", "ok", "Acordos e indenizações de processos trabalhistas."),
    ("P1-14", "Financiamento Sala Comercial", "Financiamento de Imóvel (Escritório)", OG, "ADM", "ok", "Parcelas do financiamento das salas 1212/1213. Ex.: FINANCIAMENTO SALA 1212."),
    ("P2-15", "IPTU de Terreno / Obra", _C, "Outros", "OBRA", "ok", "IPTU/ITU de terrenos e lotes em obra. Ex.: IPTU CCI 3, ITU."),
    ("P2-15", "Certidão de Obra", _C, "Outros", "OBRA", "ok", "Certidões vinculadas a uma obra específica."),
    ("P2-15", "Taxas Cartoriais de Obra", _C, "Outros", "OBRA", "ok", "Emolumentos e taxas de cartório ligadas à obra."),
    ("P2-15", "Regularização de Obra (INSS / CNO / Averbação)", _C, "Outros", "OBRA", "ok", "Guias INSS de regularização, CNO, averbação da construção. Ex.: REGULARIZAÇÃO DE OBRAS - INSS."),
    ("P2-15", "Despachante / Serviços Cartorários", _C, "Outros", "OBRA", "ok", "Serviços de despachante para legalização e documentação das obras."),
    ("P2-15", "Alvará / Habite-se / Licenças de Obra", _C, "Outros", "OBRA", "ok", "Alvará de construção, habite-se, licença ambiental, TCCLAE."),
    ("P2-15", "ART / Taxas CREA de Obra", _C, "Outros", "OBRA", "ok", "ARTs e taxas CREA vinculadas a obra específica."),
    ("P2-15", "TLF / Uso do Solo (Obra)", _C, "Outros", "OBRA", "ok", "TLF e taxas municipais de obras e lotes específicos (no CC da obra)."),
    ("P2-15", "Vistoria de Obra (Caixa / Prefeitura)", _C, "Outros", "OBRA", "ok", "Taxas de vistoria da Caixa (por unidade financiada) e vistorias da prefeitura."),
    ("P2-16", "Seguro RCPM (Obra)", "Seguros de Obra", "Outros", "OBRA", "ok", "Seguro de risco de construção por unidade vendida. Ex.: RCPM - CASA 07."),
    ("P2-16", "Seguro Garantia de Término de Obra", "Seguros de Obra", "Outros", "OBRA", "ok", "Apólices de seguro garantia de término de obra exigidas no financiamento."),
    ("P2-17", "Juros Fase de Obras", _E, "Outros", "OBRA", "ok", "Juros do financiamento durante a construção."),
    ("P2-17", "Correção Monetária (TR/IPCA)", _E, "Outros", "OBRA", "ok", "Correção do saldo devedor."),
    ("P2-17", "Seguro Financiamento (MIP/DFI)", _E, "Outros", "OBRA", "ok", "Seguros obrigatórios do contrato Caixa."),
    ("P2-17", "Tarifa de Administração Caixa", _E, "Outros", "OBRA", "ok", "Tarifas de administração do contrato."),
    ("P2-17", "IOF Financiamento", _E, "Outros", "OBRA", "ok", "IOF do contrato de financiamento."),
    ("P2-18", "Amortização do Financiamento", _A, OG, "OBRA", "ok", "Devolução do principal após a obra."),
    ("P2-18", "Juros Fase de Amortização", _A, "Outros", "OBRA", "ok", "Juros pagos na fase de amortização."),
    ("P3-A", "Materiais (Obras)", "Materiais", "Materiais", "OBRA", "ok", "Todo material de construção aplicado em obra: areia, brita, tintas, verniz, cimento, texturas. Ex.: TINTAS ACRIL PLUS, SÓ BÁSICO. Material de ESCRITÓRIO não entra aqui."),
    ("P3-A", "Mão de Obra Terceirizada", "Mão de Obra Terceirizada", "Mão de Obra (Terceirizada)", "OBRA", "ok", "Empreiteiros e prestadores de obra: pedreiro, eletricista, pintor, terraplanagem, contratos de serviço de obra. Ex.: CONTRATO SERVIÇOS DE TERRAPLANAGEM."),
    ("P3-A", "Locação de equipamentos", "Equipamentos", "Equipamentos", "OBRA", "ok", "Aluguel de betoneira, andaimes, escoras e equipamentos de obra."),
    ("P3-A", "Sistema de monitoramento", "Mão de Obra Terceirizada", "", "OBRA", "ok", "Monitoramento/alarme de obras e unidades."),
    ("P3-A", "Arquitetura", "Mão de Obra Terceirizada", "Mão de Obra (Terceirizada)", "ANY", "ok", "Projetos de arquitetura e complementares."),
    ("P3-A", "Hospedagem", "Outras Despesas", "Outros", "ANY", "ok", "Hospedagem de equipes em deslocamento."),
    ("P3-B", "Aquisição de terreno", "Aquisição de Terreno", "Compra de Terreno", "OBRA", "ok", "Compra de terrenos e lotes (parcelas ao vendedor)."),
    ("P3-B", "Comissão Aquisição de Lote", "Aquisição de Terreno", "Compra de Terreno", "OBRA", "ok", "Comissão de corretor na COMPRA de lote. Somente comissão imobiliária — serviço de obra não entra aqui."),
    ("P3-B", "Comissão Venda de Casa", "Venda de casa", "Outros", "OBRA", "ok", "Comissão de corretor na VENDA de unidades."),
    ("P3-B", "Ganho de Capital", "Venda de casa", "Outros", "ANY", "ok", "DARFs de GCAP pagos à Receita Federal sobre o ganho de capital na venda das casas. O honorário da contabilidade pela apuração do GCAP vai em Honorários Contábeis."),
    ("P3-B", "Adiantamento de comissão", "Gerais e Administrativas", "Outros", "ADIANT", "ok", "Adiantamentos de comissão a corretores (CC específico de adiantamentos)."),
    ("P3-B", "ITBI", _REG, "Outros", "OBRA", "ok", "Imposto de transmissão na compra de imóveis/lotes."),
    ("P3-B", "Escritura", _REG, "Outros", "OBRA", "ok", "Custos de lavratura de escritura."),
    ("P3-B", "Registro de lote", _REG, "Outros", "OBRA", "ok", "Registro de imóveis dos lotes/unidades."),
    ("P3-B", "Certidão", _TXG, "Outros", "ANY", "ok", "Certidões avulsas de imóveis/pessoas em transações."),
    ("P3-B", "Uso do solo", _TXG, "Outros", "OBRA", "ok", "Taxa de uso do solo em transações de lote. Para taxas de OBRA use TLF / Uso do Solo (Obra) em Custos de Obra — Taxas e Legalização."),
    ("P3-C", "Aporte Capital", "Investimento", "", "SOC", "ok", "Aportes dos sócios/investidores nas SPEs. CC: CONTROLE DE APORTES E DISTRIBUIÇÕES."),
    ("P3-C", "Distribuição de Lucros", "Distribuição de Lucros (Somente Fluxo de Caixa)", "", "SOC", "ok", "Distribuições aos sócios. Mesmo CC de aportes."),
    ("P3-C", "Cota Capital", "Integralização de Capital", "", "ANY", "ok", "Cotas de capital (ex.: Sicoob)."),
    ("P3-C", "Devolução sinal / entrada /  vlr a mais creditado", "Ajustes financeiros - Devolução de saldo a maior", "Outros", "ANY", "ok", "Devoluções a clientes: sinal, entrada ou valores creditados a maior."),
    ("P3-C", "Distrato", "Distratos / Rescisões Contratual", "Outros", "ANY", "ok", "Devoluções por distrato/rescisão contratual de venda."),
    ("P3-C", "Débito sem documento após 1 mês", "Outras Despesas", "Outros", "ANY", "generica", "Débitos bancários sem identificação após 30 dias (uso excepcional — investigar sempre)."),
    ("P3-D", "Despesa JC pessoal", "Outras Despesas", "Outros", "ANY", "restrita", "Despesas pessoais dos sócios pagas pela empresa (controle interno; fora da reestruturação)."),
    ("P3-D", "Despesa JV pessoal", "Outras Despesas", "Outros", "ANY", "restrita", "Despesas pessoais dos sócios pagas pela empresa (controle interno; fora da reestruturação)."),
    ("P3-D", "Outras Despesas", "Outras Despesas", "Outros", "ANY", "generica", "ÚLTIMO RECURSO. Só quando nenhuma categoria específica servir. Descrever detalhadamente. Meta: máx. 2% dos lançamentos do mês."),
    ("P3-D", "Taxas gerais", _TXG, "Outros", "ANY", "generica", "ÚLTIMO RECURSO para taxas não previstas. Antes de usar, verifique Custos de Obra — Taxas e Legalização e Taxas e Registros Corporativos."),
    ("P3-D", "PADARIA", "Despesas Financeiras", "", "ANY", "descontinuada", "NÃO USAR. Categoria antiga mantida só pelo histórico — lanches e padaria vão em Despesas Administrativas » Alimentação / Lanches."),
]

TEXTOS_PADRAO = {
    "titulo": "Manual do Plano de Contas e Categorias",
    "subtitulo": "Mais Controle ERP · Morais Engenharia e SPEs — Guia de consulta rápida",
    "como_usar": ("Antes de lançar qualquer pagamento, responda três perguntas: (1) A despesa é do escritório (ADM) "
                  "ou de uma obra? Isso define o centro de custo — despesas do escritório vão no CC ESCRITÓRIO - "
                  "MORAIS ENGENHARIA; despesas de obra vão no CC da obra/lote correspondente. (2) Qual plano de conta "
                  "descreve a natureza da despesa? Use as seções deste manual. (3) Qual categoria dentro do plano? "
                  "Cada categoria tem exemplos reais abaixo."),
    "regra_ouro": ("\"Outras Despesas\" e \"Taxas gerais\" são o último recurso — só use se nenhuma categoria "
                   "específica servir. Se usar, descreva bem o lançamento para permitir reclassificação depois. "
                   "A meta é no máximo 2% dos lançamentos do mês."),
    "mistos": ("Nunca some despesas de naturezas diferentes num título só (ex.: \"engenheiro + combustível\"). "
               "Lance um título por categoria."),
    "classificacao": ("Classificação (Gestão de Obra): campo obrigatório ao criar categoria no Mais Controle. Folha de "
                      "Pagamento e financiamentos usam \"Oculta na Gestão\"; Remuneração de Engenheiros usa \"Mão de "
                      "Obra (Terceirizada)\"; as demais usam \"Outros\"."),
    "partes": {str(k): {"titulo": v[0], "nota": v[1]} for k, v in PARTES_PADRAO.items()},
    "indice": [
        ["Salário CLT, adiantamento, férias, 13º, rescisão, vale-transporte", "Folha de Pagamento » categoria específica"],
        ["FGTS, guias INSS/IRRF da folha", "Folha de Pagamento » FGTS ou INSS / IRRF Folha"],
        ["Estagiário, IEL", "Folha de Pagamento » Estagiário"],
        ["Engenheiro/engenheira PJ (mensal)", "Remuneração de Engenheiros » Remuneração de Engenheiro"],
        ["Contador, advogado, BPO financeiro, consultoria, SST/exames", "Honorários » categoria específica"],
        ["Papelaria, móveis, limpeza, lanches, uniformes, estacionamento", "Despesas Administrativas » categoria específica"],
        ["Mais Controle, softwares, assinaturas digitais, cloud", "Tecnologia e Sistemas » Software / Assinatura Digital"],
        ["Energia, água, internet e celular do ESCRITÓRIO", "Utilidades » categoria específica"],
        ["Condomínio e IPTU das salas 1212/1213", "Ocupação do Escritório » Condomínio ou IPTU - Administrativo"],
        ["Combustível, manutenção e seguro dos carros", "Veículos, Mobilidade e Seguros » categoria específica"],
        ["IRPJ, CSLL, PIS, COFINS, ISS próprio, IRRF s/ serviços", "Impostos Corporativos » categoria específica"],
        ["DARF RET das SPEs", "Impostos Corporativos » DARF RET (Incorporação)"],
        ["ISSQN retido de terceiros em obra", "Impostos Corporativos » ISSQN Retido s/ Serviços de Obra"],
        ["CREA (anuidade da empresa), JUCEG, abertura de CNPJ, constituição SCP/RET", "Taxas e Registros Corporativos » categoria específica"],
        ["Tarifa Pix/TED, pacote de serviços, IOF, juros bancários", "Tarifas Bancárias » categoria específica"],
        ["Cursos e capacitações", "Treinamento e Desenvolvimento » Curso / Capacitação"],
        ["Marketing, propaganda, filmagem", "Despesas Administrativas » Marketing"],
        ["Confraternização, evento, reunião de equipe", "Despesas Administrativas » Eventos e Confraternizações"],
        ["Brindes para equipe e corretores", "Despesas Administrativas » Brindes"],
        ["Contribuição sindical descontada da folha", "Folha de Pagamento » Contribuição Sindical"],
        ["GCAP — ganho de capital na venda (Receita Federal)", "Venda de casa » Ganho de Capital"],
        ["Serviços financeiros de prestadores fixos", "Honorários » Serviços financeiros"],
        ["Processo trabalhista, depósito judicial, custas", "Despesas Jurídicas e Trabalhistas » categoria específica"],
        ["Parcela do financiamento das salas do escritório", "Financiamento de Imóvel (Escritório) » Financiamento Sala Comercial"],
        ["IPTU/ITU de terreno de obra, certidões de obra, cartório de obra", "Custos de Obra — Taxas e Legalização » categoria específica"],
        ["Regularização de obra, INSS/CNO, averbação", "Custos de Obra — Taxas e Legalização » Regularização de Obra"],
        ["Despachante", "Custos de Obra — Taxas e Legalização » Despachante / Serv. Cartorários"],
        ["Alvará, habite-se, licença ambiental, ART, vistoria Caixa/prefeitura", "Custos de Obra — Taxas e Legalização » categoria específica"],
        ["TLF / uso do solo de obra ou lote específico", "Custos de Obra — Taxas e Legalização » TLF / Uso do Solo (Obra)"],
        ["Seguro RCPM, seguro garantia de término de obra", "Seguros de Obra » categoria específica"],
        ["Juros, correção, MIP/DFI e tarifas Caixa na fase de obra", "Financiamento de Empreendimento — Encargos » categoria específica"],
        ["Devolução do principal do financiamento pós-obra", "Financiamento de Empreendimento — Amortização » categoria específica"],
        ["Material de construção, areia, brita, tintas, verniz", "Materiais (CC da obra)"],
        ["Pedreiro, eletricista, terraplanagem, empreiteiro", "Mão de Obra Terceirizada (CC da obra)"],
        ["Locação de betoneira, andaime, equipamentos", "Locação de equipamentos (CC da obra)"],
        ["Compra de terreno/lote", "Aquisição de terreno"],
        ["Comissão de corretor (compra de lote ou venda de casa)", "Comissão Aquisição de Lote ou Comissão Venda de Casa"],
        ["ITBI, escritura, registro de lote, certidão avulsa, uso do solo", "Categoria cartorial correspondente (ITBI, Escritura, Registro de lote...)"],
        ["Aporte de capital, distribuição de lucros, cota capital", "Aporte Capital / Distribuição de Lucros / Cota Capital"],
        ["Despesas pessoais dos sócios", "Despesa JC pessoal ou Despesa JV pessoal"],
    ],
    "erros": [
        ["Salário em \"Outras Despesas\"", "Todo pagamento de folha vai em Folha de Pagamento (Salário, Férias, Adiantamento...)."],
        ["FGTS/INSS em \"Taxas gerais\"", "Guias de folha vão em Folha de Pagamento » FGTS ou INSS / IRRF Folha."],
        ["Engenheiro PJ em \"Outras Despesas\"", "Vai em Remuneração de Engenheiros."],
        ["Serviço de obra (terraplanagem, empreiteiro) em \"Outras Despesas\"", "Contrato de serviço executado em obra é Mão de Obra Terceirizada, no CC da obra."],
        ["IPTU tudo junto em \"Taxas gerais\"", "IPTU das salas » Ocupação do Escritório; IPTU de terreno de obra » Custos de Obra — Taxas e Legalização."],
        ["Energia/internet em \"Outras Despesas\"", "Contas do escritório vão em Utilidades."],
        ["Lançamento misto (ex.: engenheiro + combustível)", "Separar em dois títulos, um por categoria."],
        ["Criar categoria nova por conta própria", "Não criar. Se sentir falta de uma categoria, registrar a dúvida e alinhar com o financeiro — o plano é padronizado."],
    ],
    "versao": "agosto/2026",
}


def manual_padrao_linhas():
    """Linhas no formato das tabelas do Supabase (para semear)."""
    secoes = [dict(id=s[0], parte=s[1], titulo=s[2], resultado=s[3], classificacao=s[4],
                   escopo=s[5], nota=s[6], ordem=s[7]) for s in SECOES_PADRAO]
    ordem = {}
    cats = []
    for (sec, c, plano, cls, esc, uso, txt) in CATEGORIAS_PADRAO:
        ordem[sec] = ordem.get(sec, 0) + 1
        cats.append(dict(categoria=c, secao_id=sec, plano=plano, classificacao=cls, escopo=esc,
                         uso=uso, texto=txt, palavras="", ordem=ordem[sec], ativo=True))
    return secoes, cats, TEXTOS_PADRAO


# =============================================================================
# 2) CENTRO DE CUSTO
# =============================================================================
def cc_tipo(cc):
    n = N(cc)
    if "APORTE" in n:
        return "SOC"
    if "ADIANTAMENTO COMISS" in n:
        return "ADIANT"
    if "A CLASSIFICAR" in n:
        return "PENDENTE"
    if re.search(r"ESCRITORIO|FOLHA DE PAGAMENTO|^EMPRESA$|REEMBOLSO - EMPRESA|^SALA 1212|FATURAMENTO", n):
        return "ADM"
    return "OBRA"   # lotes, condomínios, pós-obra, reforma da sala, chácara...


# =============================================================================
# 3) REGRAS DE PALAVRAS (assunto da descrição -> categorias aceitas)
#    (regex, [categorias aceitas], família, escopo opcional 'ADM'/'OBRA')
# =============================================================================
LACUNA_E = "Energia de obra/unidade (sem categoria no manual)"
LACUNA_A = "Água de obra/unidade (sem categoria no manual)"
LACUNAS = (LACUNA_E, LACUNA_A)

R = []


def _r(rx, acc, fam, scope=None):
    R.append((re.compile(rx), acc, fam, scope))


# societário / financeiro
_r(r"APORTE", ["Aporte Capital"], "SOC")
_r(r"DISTRIBUICAO DE LUCRO|DIST\.? LUCRO", ["Distribuição de Lucros"], "SOC")
_r(r"COTA CAPITAL|INTEGRALIZ", ["Cota Capital"], "SOC")
_r(r"DISTRATO", ["Distrato"], "SOC")
_r(r"EMPRESTIMO|MUTUO", ["Aporte Capital", "IOF / Juros Bancários", "IOF Empréstimo/Financiamento"], "SOC")
_r(r"DEVOLUCAO (DE |DO )?(SINAL|ENTRADA|VALOR)|\bDEV\.? (DE )?(VALOR|VALORES|SINAL|ENTRADA)|A MAIOR\b|CREDITADO A MAIS|VALOR A MAIS",
   ["Devolução sinal / entrada /  vlr a mais creditado"], "SOC")
_r(r"FINANCIAMENTO SALA", ["Financiamento Sala Comercial"], "FIN")
_r(r"AMORTIZ", ["Amortização do Financiamento", "Juros Fase de Amortização"], "FIN")
_r(r"JUROS (DA )?FASE|JUROS (DE )?OBRA", ["Juros Fase de Obras", "Juros Fase de Amortização"], "FIN")
_r(r"CORRECAO MONETARIA", ["Correção Monetária (TR/IPCA)"], "FIN")
_r(r"\bMIP\b|\bDFI\b", ["Seguro Financiamento (MIP/DFI)"], "FIN")
_r(r"TAXA (DE )?ADMINISTRACAO|TARIFA (DE )?ADMINISTRACAO", ["Tarifa de Administração Caixa"], "FIN")
_r(r"IOF.*(FINANC|EMPREST)", ["IOF Financiamento", "IOF Empréstimo/Financiamento"], "FIN")
# folha
_r(r"ADIANTAMENTO (DE )?SALAR", ["Adiantamento Salarial"], "FOLHA")
_r(r"\bSALARIO\b|\bV\.?T\.?\b|VALE.?TRANSPORTE|\bFOLHA\b",
   ["Salário", "Adiantamento Salarial", "13º Salário", "INSS / IRRF Folha", "FGTS"], "FOLHA")
_r(r"\bFGTS\b", ["FGTS"], "FOLHA")
_r(r"\bFERIAS\b", ["Férias"], "FOLHA")
_r(r"13 ?O? SALARIO|DECIMO TERCEIRO|\b13O\b", ["13º Salário"], "FOLHA")
_r(r"RESCIS", ["Rescisão", "Distrato"], "FOLHA")
_r(r"ESTAGI|\bIEL\b", ["Estagiário"], "FOLHA")
_r(r"SINDICA", ["Contribuição Sindical"], "FOLHA")
_r(r"\bGPS\b|INSS.*FOLHA|FOLHA.*INSS", ["INSS / IRRF Folha"], "FOLHA")
_r(r"\bINSS\b", ["INSS / IRRF Folha"], "FOLHA", "ADM")
_r(r"\bINSS\b", ["Regularização de Obra (INSS / CNO / Averbação)"], "OBRA_TAXA", "OBRA")
# engenheiros / honorários
_r(r"^(?!.*PLACA).*ENGENHEIR", ["Remuneração de Engenheiro", "Mão de Obra Terceirizada"], "ENG")
_r(r"CONTABI|CONTABE|HON\.? CONT|\bPLD\b|FECHAMENTO CONTABIL|IMPOSTO DE RENDA PF|DECLARACAO", ["Honorários Contábeis"], "HON")
_r(r"ADVOCAT|ADVOGAD|HON\.? ADV", ["Honorários Advocatícios"], "HON")
_r(r"\bBPO\b", ["BPO Financeiro", "Serviços financeiros"], "HON")
_r(r"CONSULTORIA|RECRUTAMENTO|PBQP|\bNAUE\b|FECHAMENTO DE VAGA", ["Consultoria / Recrutamento"], "HON")
_r(r"\bSST\b|E-?SOCIAL|PCMSO|\bPGR\b|EXAME (ADMISSIONAL|PERIODICO|DEMISSIONAL)|MEDICINA DO TRABALHO|\bASO\b",
   ["SST / Medicina do Trabalho"], "HON")
# administrativas
_r(r"(MATERIA(L|IS)|COMPRAS?|ITENS)( DIVERSOS)? (DE |DO |PARA )?ESCRITORIO|PAPEL A4|PAPELARIA|PORTA CANETA|LIXEIRA|CANETA|"
   r"TONER|CARTUCHO|CADEIRA|TABLET|NOTEBOOK|MONITOR|MOVEI?S? (DO|PARA) ESCRITORIO|DECORACAO", ["Material Escritório"], "ADMIN")
_r(r"DIARISTA|PRODUTOS? DE LIMPEZA|PAPEL.?TOALHA|SACOS? (PARA|DE) LIXO|DETERGENTE", ["Limpeza do Escritório", "Alimentação / Lanches"], "ADMIN")
_r(r"LANCHE|\bCAFE\b|COFFEE|PADARIA|SUPERMERCADO|HORTIFRUTI|\bBOLOS?\b|AGUA MINERAL|GALAO|ACUCAR|BISCOITO|FILTRO PARA CAFE",
   ["Alimentação / Lanches", "Limpeza do Escritório", "Eventos e Confraternizações"], "ADMIN")
_r(r"UNIFORME|CAMISETA", ["Uniformes", "Brindes"], "ADMIN")
_r(r"ESTACIONAMENTO|MULTIPARK|MOTOBOY|\bUBER\b", ["Estacionamento / Frete"], "ADMIN")
_r(r"\bFRETE\b", ["Estacionamento / Frete"], "ADMIN", "ADM")
_r(r"\bFRETE\b", ["Materiais (Obras)", "Mão de Obra Terceirizada", "Locação de equipamentos"], "OBRA_DIR", "OBRA")
_r(r"CERTIFICADO DIGITAL|E-?CNPJ|E-?CPF", ["Certificado Digital"], "ADMIN")
_r(r"MARKETING|\bMKT\b|PROPAGANDA|PUBLICIDADE|FILMAGEM|TRAFEGO PAGO|IMPULSIONAMENTO|PANFLETO|OUTDOOR", ["Marketing"], "ADMIN")
_r(r"CONFRATERNIZ|\bEVENTO\b|ANIVERSARIO|CONFRAT", ["Eventos e Confraternizações", "Alimentação / Lanches"], "ADMIN")
_r(r"BRINDE", ["Brindes"], "ADMIN")
_r(r"MAIS CONTROLE|SOFTWARE|ASSINATURA|\bCLOUD\b|GOOGLE|\bCLAUDE\b|CHATGPT|OPENAI|ADOBE|AUTODESK|MICROSOFT|OFFICE 365|\bLICENCA (DE )?(USO|SOFTWARE)",
   ["Software / Assinatura Digital"], "TI")
# ocupação
_r(r"CONDOMINIO.*SALA|TAXA (DE )?CONDOMINIO|FUNDO DE RESERVA|JK NEW", ["Condomínio"], "OCUP")
_r(r"IPTU.*(SALA|1212|1213)", ["IPTU - Administrativo"], "OCUP")
_r(r"\bIPTU\b|\bITU\b|\bTLP\b", ["IPTU de Terreno / Obra"], "OBRA_TAXA", "OBRA")
_r(r"\bIPTU\b|\bITU\b", ["IPTU - Administrativo"], "OCUP", "ADM")
# veículos
_r(r"COMBUSTIVEL|GASOLINA|ETANOL|ABASTEC|DIESEL|\bPOSTO\b", ["Combustível"], "VEIC")
_r(r"\bPNEU|OFICINA|TROCA DE OLEO|REVISAO (DO )?(CARRO|VEICULO)|KWID|STRADA|MANUTENCAO (DO |DE )?(CARRO|VEICULO)|FUNILARIA",
   ["Manutenção de Veículos", "Custas Processuais"], "VEIC")
_r(r"SEGURO (AUTO|DO CARRO|VEICUL)|PROTEGECLUB|PROTECAO VEICULAR", ["Seguro de Veículos"], "VEIC")
_r(r"\bIPVA\b|LICENCIAMENTO(?! AMBIENTAL)|DETRAN|MULTA DE TRANSITO",
   ["IPVA / Licenciamento e Multas", "IIPVA / Licenciamento e Multas", "Manutenção de Veículos", "Custas Processuais"], "VEIC")
# impostos
_r(r"\bIRPJ\b|\bCSLL\b", ["IRPJ / CSLL"], "IMP")
_r(r"\bPIS\b|COFINS", ["PIS / COFINS"], "IMP")
_r(r"ISSQN", ["ISSQN Retido s/ Serviços de Obra", "ISS"], "IMP")
_r(r"\bISS\b", ["ISS", "ISSQN Retido s/ Serviços de Obra"], "IMP")
_r(r"\bIRRF\b", ["IRRF s/ Serviços Tomados", "INSS / IRRF Folha"], "IMP")
_r(r"DARF RET|RET - CASA|^RET\b|\bRET$|PAGAMENTO RET|IMPOSTO RET", ["DARF RET (Incorporação)"], "IMP")
_r(r"GCAP|GANHO DE CAPITAL", ["Ganho de Capital", "Honorários Contábeis"], "IMP")
_r(r"IR S/ APLICAC|IRRF S/ APLICAC", ["IOF / Juros Bancários"], "BANCO")
# taxas corporativas
_r(r"ANUIDADE", ["Anuidade CREA"], "CORP")
_r(r"JUCEG|CONSTITUICAO|ABERTURA (DE |DO )?CNPJ|CNPJ RET|ALTERACAO CONTRATUAL|CONTRATO SOCIAL|\bSCP\b", ["Taxa JUCEG / Abertura CNPJ"], "CORP")
_r(r"CERTIDAO NEGATIVA|\bCND\b|REGULARIDADE FISCAL", ["Certidão Corporativa", "Certidão de Obra", "Certidão"], "CORP")
# bancárias
_r(r"PACOTE (DE )?SERVICO|TARIFA|\bTED\b|MANUTENCAO (DE |DA )?CONTA|CESTA DE SERVICO|DEBITO PACOTE|TAXA BANCARIA",
   ["Tarifas Bancárias", "Tarifa de Administração Caixa"], "BANCO")
_r(r"\bIOF\b|CHEQUE ESPECIAL|ENCARGOS FINANCEIROS|LIMITE CREDITO|JUROS BANCARIO",
   ["IOF / Juros Bancários", "IOF Financiamento", "IOF Empréstimo/Financiamento"], "BANCO")
# treinamento / jurídico
_r(r"\bCURSO|TREINAMENTO|CAPACITACAO|MENTORIA|INCORPORA PRO|WORKSHOP", ["Curso / Capacitação"], "TREIN")
_r(r"CUSTAS|PROCESSO|DEPOSITO JUDICIAL|GUIA JUDICIAL|JUDICIAL|MULTA DE TRANSITO|INFRACAO",
   ["Custas Processuais", "Indenização Trabalhista", "Manutenção de Veículos"], "JUR")
_r(r"INDENIZAC|ACORDO TRABALHISTA|RECLAMATORIA", ["Indenização Trabalhista"], "JUR")
# taxas e legalização de obra
_r(r"REGULARIZACAO|\bCNO\b|AVERBACAO",
   ["Regularização de Obra (INSS / CNO / Averbação)", "Taxas Cartoriais de Obra", "Despachante / Serviços Cartorários"], "OBRA_TAXA")
_r(r"DESPACHANTE", ["Despachante / Serviços Cartorários"], "OBRA_TAXA")
_r(r"\bAVTO\b|ALVARA|HABITE|LICENCA AMBIENTAL|\bAMMA\b|TCCLAE|APROVACAO (DE |DO )?PROJETO|TAXA DE EXPEDIENTE|NUMERO OFICIAL|LICENC|OUTORGA",
   ["Alvará / Habite-se / Licenças de Obra", "TLF / Uso do Solo (Obra)"], "OBRA_TAXA")
_r(r"\bART\b|\bARTS\b|\bCREA\b|\bTRT\b|\bRRT\b", ["ART / Taxas CREA de Obra", "Anuidade CREA"], "OBRA_TAXA")
_r(r"\bTLF\b", ["TLF / Uso do Solo (Obra)", "Uso do solo"], "OBRA_TAXA", "OBRA")
_r(r"\bTLF\b", ["TLF / Taxa Municipal (Escritório)"], "CORP", "ADM")
_r(r"USO DO SOLO", ["TLF / Uso do Solo (Obra)", "Uso do solo"], "OBRA_TAXA")
_r(r"^(?!.*(REPARO|LIMPEZA|MAO DE OBRA|\bMO\b|PRE VISTORIA|PARA VISTORIA)).*VISTORIA", ["Vistoria de Obra (Caixa / Prefeitura)"], "OBRA_TAXA")
_r(r"\bRCPM\b|RISCO DE ENGENHARIA", ["Seguro RCPM (Obra)"], "SEG")
_r(r"SEGURO GARANTIA|GARANTIA DE TERMINO", ["Seguro Garantia de Término de Obra"], "SEG")
# terreno / cartório / comissões
_r(r"ADIANTAMENTO (DE )?COMISS", ["Adiantamento de comissão"], "COMIS")
_r(r"COMISS|INTERMEDIAC|CORRETAGEM|\bACOMP(ANHAMENTO)? (DE )?VENDA",
   ["Comissão Venda de Casa", "Comissão Aquisição de Lote", "Adiantamento de comissão"], "COMIS")
_r(r"AQUISICAO|CESSAO DE DIREITO|LOTEADORA|^LOTE$|PAGAMENTO (DO |DE )?LOTE|PGTO (DO )?LOTE|COMPRA (DO |DE )?(LOTE|TERRENO)|PARCELA (DO |DE )?(LOTE|TERRENO)",
   ["Aquisição de terreno"], "TERRENO")
_r(r"\bITBI\b|\bISTI\b|\bITSI\b", ["ITBI"], "CART")
_r(r"ESCRITURA", ["Escritura", "Registro de lote", "Taxas Cartoriais de Obra"], "CART")
_r(r"CERTIDAO (DE )?(INTEIRO TEOR|ONUS|MATRICULA)", ["Certidão", "Certidão de Obra", "Registro de lote"], "CART")
_r(r"(?<!BASE )REGISTRO(?! DE PRESSAO)|MATRICULA|\bONR\b",
   ["Registro de lote", "Certidão", "Taxas Cartoriais de Obra", "Regularização de Obra (INSS / CNO / Averbação)", "Escritura"], "CART")
_r(r"CERTID", ["Certidão", "Certidão de Obra", "Certidão Corporativa", "Taxas Cartoriais de Obra"], "CART")
_r(r"CARTORIO|EMOLUMENTO|RECONHECIMENTO (DE )?FIRMA|AUTENTICAC|TABELIONATO|PROTESTO",
   ["Taxas Cartoriais de Obra", "Certidão", "Registro de lote", "Escritura", "Despachante / Serviços Cartorários", "Certidão de Obra"], "CART")
# obra — equipamentos, MO, materiais
_r(r"LOCACAO|ALUGUEL|BETONEIRA|ANDAIME|ESCORA|COMPACTADOR|CONTAINER|MUNCK|\bPLACA VIBRAT|RETROESCAVADEIRA|CARREGADEIRA|MOVIMENTACAO DE TERRA|PLATO|\bMAQUINA",
   ["Locação de equipamentos", "Mão de Obra Terceirizada", "Materiais (Obras)"], "OBRA_DIR")
_r(r"CONCERTINA|CERCA ELETRICA|CENTRAL DE ALARME|SEGURANCA ELETRONICA",
   ["Sistema de monitoramento", "Materiais (Obras)", "Mão de Obra Terceirizada"], "OBRA_DIR")
_r(r"CACAMBA|ENTULHO|CAMINHAO|CAMINHOES|CAMINHAO DE TERRA|\bATERRO\b|TERRA P/",
   ["Locação de equipamentos", "Mão de Obra Terceirizada", "Materiais (Obras)"], "OBRA_DIR")
_r(r"MONITORAMENTO|ALARME|\bCAMERAS?\b|CFTV", ["Sistema de monitoramento"], "OBRA_DIR")
_r(r"RENDER|MAQUETE|\b3D\b|ARQUITET|PROJETO ARQ|PROJETOS? COMPLEMENTAR|PROJETO ESTRUTURAL|PROJETO ELETRICO|PROJETO HIDRO",
   ["Arquitetura", "Mão de Obra Terceirizada"], "OBRA_DIR")
_r(r"TOPOGRAF|SONDAGEM", ["Arquitetura", "Mão de Obra Terceirizada"], "OBRA_DIR")
_r(r"IMPRESSAO DE PROJETO|PLOTAGEM|COPIAS DE PROJETO|IMPRESSAO",
   ["Material Escritório", "Arquitetura", "Mão de Obra Terceirizada", "Materiais (Obras)"], "ADMIN")
_r(r"PEDREIRO|ELETRICISTA|ENCANADOR|PINTOR|CERAMIQUEIRO|SERVENTE|EMPREIT|MAO DE OBRA|\bM\.?O\.?\b|TERRAPLAN|DEMOLICAO|CHAVEIRO|"
   r"COPIAS? DE CHAVE|SERRALHE|INSTALACAO|MONTAGEM|DIARIA|GESSEIRO|PISCINA|POCO ARTESIANO|JARDINAG|PAISAGIS|LIMPEZA|SERVICO|"
   r"CARPINT|MARCENEIR|FERRAGISTA|ARMADOR|ADICIONAL|CALCADA|\bPOCO\b|MINI POCO|ENSAIO|LIGACAO|REFAZER|ACRESCIMO|MEDICAO|"
   r"CONTRATO|ESTACA|PERFURAC|POS OBRA|DESENTUPIMENTO|ARRIMO|APLICACAO|REPARO|CONSERTO|MANUTENCAO",
   ["Mão de Obra Terceirizada", "Materiais (Obras)", "Locação de equipamentos", "Sistema de monitoramento"], "OBRA_DIR", "OBRA")
_r(r"CIMENTO|AREIA|BRITA|TIJOLO|\bACO\b|\bFERRO|VERGALHAO|TINTA|VERNIZ|TEXTURA|ARGAMASSA|\bPISOS?\b|REVEST|PORCELANATO|CERAMICA|"
   r"\bPORTAS?\b|\bPORTA(IS|L)\b|FILTRO|MANGUEIRA|CADEADO|DISCO|COLUNA|PINTURA|SIKA|GRELHA|PLASTIFICANTE|CAIBRO|CORANTE|INTERRUPTOR|"
   r"ESPATULA|SUPORTE|LIGACAO|PINGADEIRA|MANILHA|\bMAT\b|PRE ?MOLDADO|ARRIMO|\bTERRA\b(?! BELA)|SUBESTACAO|CARRINHO|\bPORTAO|"
   r"PORTOES|TELHA|\bLAJES?\b|CANALETA|\bBLOCOS?\b|MADEIRA|HIDRO|ELETRIC|IMPERMEAB|GRANITO|MARMORE|BANCADA|SOLEIRA|PEITORI|VIDRO|"
   r"ESQUADRIA|JANELA|LOUCA|\bMETAIS\b|CONCRETO|\bCAL\b|GESSO|CALHA|RUFO|CONCERTINA|MATERIA(L|IS)|\bTUBO|CONEXO|FIO\b|FIOS\b|"
   r"CABO|DISJUNTOR|LAMPADA|LUMINARIA|CHURRASQUEIRA|\bPLACAS?\b|ARAME|PREGO|PARAFUSO|MASSA|SELADOR|RODAPE|TORNEIRA|CHUVEIRO|"
   r"VASO|PIA\b|TANQUE|CAIXA D.?AGUA|FECHADURA|DOBRADICA|PERGOLADO|GRADE|ALAMBRADO|MOURAO|TERRA P|TERRA PARA|GRAMA|\bMUDAS?\b|"
   r"ARVORE|PADRAO|\bKIT\b|TAMPA|JOELHO|ADAPTADOR|LUVA|ESGOTO|PLUVIA|FIBRA|BETUME|ADITIVO|TABUA|VIGOTA|LIXA|ESCORA|SAIBRO|"
   r"PEDRA|BRITADO|ACABAMENTO|FERRAGEM|ESTRUTURA METALICA|FORRO|PVC|TELA\b|LONA|EPI\b|FERRAMENTA",
   ["Materiais (Obras)", "Mão de Obra Terceirizada", "Locação de equipamentos", "Marketing"], "OBRA_DIR")
_r(r"HOSPEDAGEM|HOTEL|POUSADA", ["Hospedagem"], "HOSP")

# utilidades (tratadas à parte)
RX_ENERGIA = re.compile(r"ENERGIA|EQUATORIAL|\bENEL\b|\bCELG\b|\bLUZ\b|SOLAR")
RX_AGUA = re.compile(r"\bAGUA\b|SANEAGO|SANESC|\bSAAE\b|ESGOTO|AGUAS DE")
RX_NET = re.compile(r"INTERNET|\bCLARO\b|\bLINQ\b|\bVIVO\b|CELULAR|TELEFON|\bTIM\b|FIBRA OTICA")
RX_ENERGIA_F = re.compile(r"EQUATORIAL|\bENEL\b|\bCELG\b")

# fornecedores conhecidos
RF = []


def _rf(rx, acc, fam):
    RF.append((re.compile(rx), acc, fam))


_rf(r"REAL CONTABILIDADE", ["Honorários Contábeis", "Ganho de Capital", "Taxa JUCEG / Abertura CNPJ", "Certidão Corporativa"], "HON")
_rf(r"GONCALVES NUNES", ["Honorários Advocatícios", "Custas Processuais", "Indenização Trabalhista"], "HON")
_rf(r"\bGVC\b", ["BPO Financeiro", "Honorários Contábeis", "Serviços financeiros"], "HON")
_rf(r"PROTEGECLUB", ["Seguro de Veículos"], "VEIC")
_rf(r"^PROTEGE\b(?!CLUB)", ["SST / Medicina do Trabalho"], "HON")
_rf(r"GRIFO", ["Marketing"], "ADMIN")
_rf(r"JK NEW", ["Condomínio"], "OCUP")
_rf(r"MULTIPARK", ["Estacionamento / Frete"], "ADMIN")
_rf(r"FASTLASER", ["Brindes"], "ADMIN")
_rf(r"MAIS CONTROLE|ANTHROPIC|GOOGLE|MICROSOFT|ADOBE|AUTODESK|OPENAI", ["Software / Assinatura Digital"], "TI")
_rf(r"CONTAINER|CACAMBA|ENTULHO", ["Locação de equipamentos", "Mão de Obra Terceirizada"], "OBRA_DIR")
_rf(r"DEPARTAMENTO ESTADUAL DE TRANSITO|\bDETRAN\b", ["IPVA / Licenciamento e Multas", "IIPVA / Licenciamento e Multas", "Custas Processuais"], "VEIC")

GENERIC_DESC = re.compile(r"^(CASA ?\d*|CS ?\d*|REEMBOLSO( - )?( ?(ENG|ENGENHEIRO|PARA)? ?[A-Z]+( [A-Z]+)?)?|TAXA|TAXAS|PAGAMENTO|PGTO|"
                          r"DIVERSOS|OUTROS|NF|NOTA|BOLETO|PIX|TRANSFERENCIA|QD ?\d+[A-Z]? ?LT ?[\d\-A-Z ]+|LOTE \d+|OBRA|"
                          r"SERVICOS?|DESPESAS?|COMPRA|COMPRAS|\d+)$")
GENERIC_EXTRA = re.compile(r"FATURA (DO )?CART(AO|AO DE CREDITO)|DEBITOS PAGOS|REPASSE DO SALDO|\bDB CX CAP\b|PGTO INDEVIDO|PAGAMENTO INDEVIDO")
STRONG = {"VEIC", "FOLHA", "HON", "IMP", "BANCO", "OCUP", "TI", "ENG", "COMIS", "TERRENO", "SOC", "FIN", "JUR",
          "TREIN", "CORP", "UTIL", "UTIL_OBRA", "MANUAL"}
CATS_COMISSAO = ("Adiantamento de comissão", "Comissão Venda de Casa", "Comissão Aquisição de Lote")

# classificação esperada (campo "grupo" do ERP) a partir do plano, para as
# categorias da Parte 3 que o manual não diz a classificação
CLASSIF_POR_PLANO = {
    "MATERIAIS": "Materiais",
    "MAO DE OBRA TERCEIRIZADA": "Mão de Obra (Terceirizada)",
    "EQUIPAMENTOS": "Equipamentos",
    "AQUISICAO DE TERRENO": "Compra de Terreno",
    "OUTRAS DESPESAS": "Outros",
}

ROTULOS = {
    "DIVERGENTE": "Categoria errada", "MISTO": "Lançamento misto", "GENERICA": "Categoria genérica",
    "DESCONTINUADA": "Categoria descontinuada", "SEM_DESCRICAO": "Descrição insuficiente",
    "CC": "Centro de custo a revisar", "CADASTRO": "Cadastro fora do manual",
    "NAO_AVALIADO": "Não avaliado", "OK": "Conforme",
}


def _classif_esperada(info):
    """Valor esperado do campo 'grupo' do ERP. '' = Oculta na Gestão. None = sem regra."""
    cls = (info.get("classificacao") or "").strip()
    if cls:
        n = N(cls)
        if n.startswith("OCULTA"):
            return ""
        if "/" in cls and "OCULTA" in n:      # seção 18: depende da categoria
            return None
        return cls
    return CLASSIF_POR_PLANO.get(N(info.get("plano")))


# =============================================================================
# 4) O MOTOR
# =============================================================================
class Motor:
    """Monta o manual em memória a partir das linhas do Supabase (ou do padrão)."""

    def __init__(self, categorias=None):
        if not categorias:
            categorias = manual_padrao_linhas()[1]
        self.M = {}
        self.rules_manual = []
        for c in categorias:
            if c.get("ativo") is False:
                continue
            nome = (c.get("categoria") or "").strip()
            if not nome:
                continue
            uso = (c.get("uso") or "ok").strip().lower()
            self.M[nome] = dict(plano=(c.get("plano") or "").strip() or None,
                                classificacao=(c.get("classificacao") or "").strip(),
                                escopo=(c.get("escopo") or "ANY").strip().upper() or "ANY",
                                uso=uso if uso in ("ok", "generica", "descontinuada", "restrita") else "ok",
                                texto=c.get("texto") or "")
            palavras = [N(p) for p in re.split(r"[;,\n]", c.get("palavras") or "") if N(p)]
            if palavras:
                rx = re.compile(r"(?<![A-Z0-9])(" + "|".join(re.escape(p) for p in palavras) + r")(?![A-Z0-9])")
                self.rules_manual.append((rx, [nome], "MANUAL", None))
        self.nomes_norm = {N(k): k for k in self.M}

    # ------------------------------------------------------------------
    def _best(self, acc, scope):
        for c in acc:
            if c in LACUNAS or (c in self.M and self.M[c]["uso"] == "ok"):
                return c
        c = acc[0]
        if c == "Conta de energia":
            return LACUNA_E if scope == "OBRA" else "Energia (Escritório)"
        if c == "Conta de água":
            return LACUNA_A if scope == "OBRA" else "Fatura de Água"
        if c == "Conta de internet":
            return "Internet / Celular"
        # nome que não existe no manual (ex.: o "IIPVA" do ERP) -> o do manual, se houver
        for x in acc:
            if x in self.M:
                return x
        return c

    def classificar(self, descricao, fornecedor, categoria, plano, centro_de_custo):
        M = self.M
        d = N(descricao)
        f = N(fornecedor)
        catg = (categoria or "").strip() if isinstance(categoria, str) else ("" if categoria is None or categoria != categoria else str(categoria))
        cct = cc_tipo(centro_de_custo)
        scope = "ADM" if cct == "ADM" else "OBRA"
        info = M.get(catg)
        flags = []
        hits = []
        for rx, acc, fam, sc in self.rules_manual:
            if d and rx.search(d):
                hits.append((acc, fam, "descrição"))
        for rx, acc, fam, sc in R:
            if sc and sc != scope:
                continue
            if d and rx.search(d):
                hits.append((acc, fam, "descrição"))
        for rx, acc, fam in RF:
            if f and rx.search(f):
                hits.append((acc, fam, "fornecedor"))

        # --- utilidades: energia / água / internet
        util = None
        both_util = bool(RX_ENERGIA.search(d) and RX_AGUA.search(d))
        if RX_ENERGIA.search(d) or (not RX_AGUA.search(d) and RX_ENERGIA_F.search(f)):
            util = "E"
        elif RX_AGUA.search(d) or RX_AGUA.search(f):
            util = "A"
        elif RX_NET.search(d) or RX_NET.search(f):
            util = "N"
        bill = bool(re.search(r"CONTA|FATURA|\bUC\b|CONSUMO|VIZINH|\bREF\b", d)) or not d
        if util and (bill or util == "N" or not any(h[2] == "descrição" for h in hits)):
            if util == "N":
                hits.insert(0, (["Internet / Celular", "Conta de internet"], "UTIL", "descrição"))
            elif scope == "ADM":
                hits.insert(0, (["Energia (Escritório)", "Conta de energia"] if util == "E" else ["Fatura de Água", "Conta de água"], "UTIL", "descrição"))
            else:
                hits.insert(0, (["Conta de energia", LACUNA_E] if util == "E" else ["Conta de água", LACUNA_A], "UTIL_OBRA", "descrição"))

        suggestion = None
        motivo = ""
        status = None
        desc_hits = [h for h in hits if h[2] == "descrição"]
        accepted = set(c for h in hits for c in h[0])

        # 1) descrição vazia / genérica
        insuf = (not d) or bool(GENERIC_EXTRA.search(d)) or (not desc_hits and (len(d) < 3 or bool(GENERIC_DESC.match(d))))
        if not desc_hits and d and catg in CATS_COMISSAO and re.search(r"\bQD\b.*\bLT\b", d):
            hits.append(([catg], "COMIS", "descrição"))
            desc_hits = [hits[-1]]
            accepted.add(catg)
        if insuf and d and catg in CATS_COMISSAO + ("Aquisição de terreno",) and re.search(r"QD|LT", d):
            insuf = False

        # 2) conflito descrição x categoria
        if hits and catg not in accepted:
            primary = self._best(hits[0][0], scope)
            suggestion = primary
            src = hits[0][2]
            status = "DIVERGENTE"
            motivo = f'A {src} indica "{primary}", mas o lançamento está em "{catg}".'

        # 3) lançamento misto
        conn = re.search(r"\+| E | / |,", d)
        fam_ok = set(h[1] for h in desc_hits if catg in h[0])
        fam_no = (set(h[1] for h in desc_hits if catg not in h[0]) - fam_ok) & STRONG
        both_util = both_util and bill
        if conn and ((fam_ok and fam_no) or both_util):
            flags.append(("MISTO", "Descrição sugere despesas de naturezas diferentes num título só — separar em um título por categoria."))
            if both_util and status == "DIVERGENTE":
                status = None
                suggestion = None

        uso = info["uso"] if info else "ok"
        # categoria que não está no manual: o problema é o cadastro, não a descrição
        if not info:
            status = "CADASTRO"
            parecida = difflib.get_close_matches(N(catg), list(self.nomes_norm), n=1, cutoff=0.72)
            motivo = f'Categoria "{catg}" não consta no manual.'
            if parecida:
                motivo += f' Nome parecido com "{self.nomes_norm[parecida[0]]}" — alinhar o nome no ERP ou incluir no manual.'
            else:
                motivo += " Incluir no manual (aba Manual) ou trocar pela categoria certa."
            suggestion = None
        elif uso == "restrita":
            status = "NAO_AVALIADO"
            suggestion = None
            motivo = "Categoria de uso restrito (despesas pessoais dos sócios) — não auditada."
        if status is None:
            if uso == "generica":
                status = "GENERICA"
                motivo = f'"{catg}" é último recurso no manual (meta ≤ 2%).'
                if hits:
                    suggestion = self._best(hits[0][0], scope)
                    if suggestion == catg:
                        suggestion = None
                    if suggestion:
                        motivo += f' A descrição indica "{suggestion}".'
                else:
                    motivo += " Nenhuma categoria específica identificada — descrever melhor ou alinhar com o financeiro."
            elif uso == "descontinuada":
                status = "DESCONTINUADA"
                if catg == "PADARIA":
                    suggestion = "Alimentação / Lanches"
                elif scope == "ADM":
                    suggestion = {"Conta de energia": "Energia (Escritório)", "Conta de água": "Fatura de Água",
                                  "Conta de internet": "Internet / Celular"}.get(catg)
                elif catg == "Conta de internet":
                    suggestion = "Internet / Celular"
                elif catg in ("Conta de energia", "Conta de água"):
                    suggestion = LACUNA_E if catg == "Conta de energia" else LACUNA_A
                elif hits:
                    suggestion = self._best(hits[0][0], scope)
                motivo = f'"{catg}" é categoria antiga (não usar em novos lançamentos).'
                if suggestion in LACUNAS:
                    motivo += " Consumo de casa/obra não tem categoria no manual — Utilidades é só do escritório. Decisão pendente do financeiro."
        if status == "DIVERGENTE" and uso != "ok":
            motivo += " (Categoria atual também é " + ("último recurso" if uso == "generica" else "descontinuada") + ".)"
            status = "GENERICA" if uso == "generica" else "DIVERGENTE"

        # 4) centro de custo
        esc = info["escopo"] if info else "ANY"
        ccflag = None
        if cct == "PENDENTE":
            ccflag = 'Centro de custo "A CLASSIFICAR" — definir a obra.'
        elif esc == "ADM" and cct == "OBRA":
            ccflag = f'Categoria administrativa ("{catg}") lançada em CC de obra.'
        elif esc == "OBRA" and cct == "ADM":
            ccflag = f'Categoria de obra ("{catg}") lançada em CC de escritório.'
        elif esc == "SOC" and cct != "SOC":
            ccflag = "Aportes/distribuições devem ir no CC CONTROLE DE APORTES E DISTRIBUIÇÕES."
        elif esc == "ADIANT" and cct != "ADIANT":
            ccflag = "Adiantamento de comissão deve ir no CC de adiantamentos."
        if ccflag:
            flags.append(("CC", ccflag))

        # 5) plano x manual
        if info and info["plano"] and N(info["plano"]) != N(plano):
            flags.append(("PLANO", f'No manual, "{catg}" pertence ao plano "{info["plano"]}", mas está em "{plano or "—"}".'))

        if status is None:
            if any(fl[0] == "MISTO" for fl in flags):
                status = "MISTO"
                motivo = [fl[1] for fl in flags if fl[0] == "MISTO"][0]
            elif insuf:
                status = "SEM_DESCRICAO"
                motivo = "Descrição vazia ou genérica demais para confirmar a categoria." if d else "Lançamento sem descrição."
            elif ccflag:
                status = "CC"
                motivo = ccflag
            elif any(fl[0] == "PLANO" for fl in flags):
                status = "CADASTRO"
                motivo = [fl[1] for fl in flags if fl[0] == "PLANO"][0]
            elif hits:
                status = "OK"
                motivo = "Descrição compatível com a categoria."
            else:
                status = "NAO_AVALIADO"
                motivo = "Descrição sem palavra-chave reconhecida — não foi possível confirmar nem contestar."
        if insuf and status != "SEM_DESCRICAO":
            flags.append(("DESC", "Descrição vazia ou genérica."))
        if suggestion == catg:
            suggestion = None
        sug_plano = M[suggestion]["plano"] if suggestion in M else ("(definir no manual)" if suggestion in LACUNAS else None)
        alertas = [fl[1] for fl in flags if fl[1] != motivo]
        return status, suggestion, sug_plano, motivo, alertas, cct

    # ------------------------------------------------------------------
    def cadastro_erp(self, linhas):
        """Problemas no cadastro das categorias no ERP (afetam todos os lançamentos delas).
        linhas: iterável de (categoria, plano, grupo). Devolve lista de dicts."""
        cont = {}
        for cat, plano, grupo in linhas:
            k = (cat or "").strip()
            if not k:
                continue
            c = cont.setdefault(k, {"n": 0, "planos": {}, "grupos": {}})
            c["n"] += 1
            c["planos"][plano or ""] = c["planos"].get(plano or "", 0) + 1
            g = grupo if isinstance(grupo, str) else ""
            c["grupos"][g] = c["grupos"].get(g, 0) + 1
        out = []
        for cat, c in sorted(cont.items()):
            plano = max(c["planos"], key=c["planos"].get)
            grupo = max(c["grupos"], key=c["grupos"].get)
            info = self.M.get(cat)
            como = f"Plano: {plano or '—'} · Classificação: {grupo or 'Oculta na Gestão (vazio)'}"
            if not info:
                parecida = difflib.get_close_matches(N(cat), list(self.nomes_norm), n=1, cutoff=0.72)
                if parecida:
                    ajuste = f'Não consta no manual. Nome parecido com "{self.nomes_norm[parecida[0]]}" — alinhar o nome no ERP ou incluir no manual.'
                else:
                    ajuste = "Categoria criada no ERP e fora do manual — incluir no manual (aba Manual) ou deixar de usar."
                out.append(dict(cat=cat, tipo="FORA", atual="Categoria nova no ERP · " + como, esperado=ajuste, n=c["n"]))
                continue
            if info["plano"] and N(info["plano"]) != N(plano):
                out.append(dict(cat=cat, tipo="PLANO", atual=como, esperado=f'Plano do manual: "{info["plano"]}"', n=c["n"]))
            esp = _classif_esperada(info)
            if esp is not None and N(esp) != N(grupo):
                txt_esp = esp or "Oculta na Gestão"
                extra = ""
                if N(grupo) == "MATERIAIS" and N(esp) != "MATERIAIS":
                    extra = " — como está, infla o custo de materiais na Gestão de Obra"
                if info["uso"] == "descontinuada":
                    extra = " (categoria descontinuada)" + extra
                out.append(dict(cat=cat, tipo="CLASSIFICACAO", atual=como,
                                esperado=f'Classificação esperada: "{txt_esp}"{extra}', n=c["n"]))
        out.sort(key=lambda x: (-x["n"], x["cat"]))
        return out
