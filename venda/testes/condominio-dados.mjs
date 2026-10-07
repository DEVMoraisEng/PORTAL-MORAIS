/* Dados inventados do "Gerar venda" do condomínio (o repositório é público). */
export const P = {
  titulo: (s) => ({ type: "title", title: [{ plain_text: s }] }),
  texto: (s) => ({ type: "rich_text", rich_text: [{ plain_text: s }] }),
  num: (n) => ({ type: "number", number: n }),
  sel: (s) => ({ type: "select", select: s ? { name: s } : null }),
  data: (s) => ({ type: "date", date: { start: s, end: null } }),
  email: (s) => ({ type: "email", email: s }),
  tel: (s) => ({ type: "phone_number", phone_number: s }),
  url: (s) => ({ type: "url", url: s }),
  arqs: (...nomes) => ({ type: "files", files: nomes.map((n) => ({ name: n, type: "file", file: { url: "https://s3.falso/" + n } })) }),
  formula: () => ({ type: "formula", formula: { type: "string", string: "x" } }),
};

/* VENDAS de exemplo (nomes com espaço sobrando, como na base real) */
export const SCHEMA_VENDAS = {
  "ENDEREÇO": "title", "CASA": "number", "CLIENTES ": "rich_text", "CPF ": "rich_text", "Email": "email",
  "COMPRADOR 1 - E-MAIL": "email", "Nº Whatsapp": "phone_number", "DATA DA VENDA": "date",
  "DATA DE ASSINATURA DO CONTRATO": "date", "VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)": "number",
  "VALOR FINANCIADO": "number", "VALOR DO SUBSÍDIO": "number", "VALOR DO FGTS": "number",
  "COMPRADOR 1 - ESTADO CIVIL": "rich_text", "COMPRADOR 1 - PROFISSÃO": "rich_text", "COMPRADOR 1 - NACIONALIDADE": "rich_text",
  "COMPRADOR 1 - ENDEREÇO": "rich_text", "COMPRADOR 1 - DOCUMENTO": "rich_text",
  "COMPRADOR 2 - NOME": "rich_text", "COMPRADOR 2 - CPF": "rich_text", "COMPRADOR 2 - E-MAIL": "email",
  "COMPRADOR 2 - TELEFONE": "phone_number", "COMPRADOR 2 - PROFISSÃO": "rich_text", "COMPRADOR 2 - NACIONALIDADE": "rich_text",
  "COMPRADOR 2 - ENDEREÇO": "rich_text", "COMPRADOR 2 - DOCUMENTO": "rich_text",
  "CONDOMÍNIO - VENDA ID": "rich_text",
  "CORRETOR": { tipo: "select", opcoes: ["CORRETOR TESTE"] }, "IMOBILIÁRIA": { tipo: "select", opcoes: [] },
  " COMISSÃO ": "number", "CONTRATO - CONDIÇÕES ESPECIAIS": "rich_text", "SETOR": { tipo: "select", opcoes: [] },
  "TEM MANUAL DE OBRA?": { tipo: "select", opcoes: ["SIM", "NÃO"] }, "LOCALIZAÇÃO": "url",
  "MC - SITUAÇÃO": "rich_text", "ASSINATURA - SITUAÇÃO": "rich_text", "DOSSIÊ - OBSERVAÇÃO DO COMPRADOR": "rich_text",
  "CIDADE": "formula", "CONTRATO - COMISSÃO FORMA": { tipo: "select", opcoes: [] },
  "COMPRADOR 1 - IDENTIDADE": "files", "COMPRADOR 1 - COMPROVANTE DE ENDEREÇO": "files",
  "COMPRADOR 2 - IDENTIDADE": "files", "COMPRADOR 2 - COMPROVANTE DE ENDEREÇO": "files",
  "COMPROVANTE CARTÓRIO": "files", " PROTOCOLO DE TRANS. ÁGUA": "files", "ANEXAR AQUIVO DE VISTORIA": "files",
};

/* linha do condomínio de exemplo: proponente + um segundo comprador */
export function linhaCondominio(extra = {}) {
  return Object.assign({
    "UNIDADE": P.titulo("12"), "CONDOMÍNIO": P.sel("RESERVA DE TESTE"),
    "PROPONENTE": P.texto("ANA TESTE"), "CPF PROPONENTE": P.texto("52998224725"), "RG PROPONENTE": P.texto("1234567 SSP/GO"),
    "PROFISSÃO PROPONENTE ": P.texto("ANALISTA"), "NACIONALIDADE PROPONENTE": P.texto("BRASILEIRA"),
    "ESTADO CIVIL": P.texto("CASADA"), "Email": P.email("ana@exemplo.test"), "Nº Whatsapp": P.tel("62 90000-0000"),
    "ENDERECO COMPRADOR 1": P.texto("RUA DE TESTE"), "NUMERO COMPRADOR 1": P.texto("10"),
    "SETOR COMPRADOR 1": P.texto("SETOR TESTE"), "CIDADE COMPRADOR 1": P.texto("CIDADE TESTE"), "CEP COMPRADOR 1": P.texto("74000-000"),
    "COMPRADOR 1": P.texto("BRUNO TESTE"), "CPF COMPRADOR 1": P.texto("111.444.777-35"), "RG COMPRADOR 1": P.texto("7654321"),
    "EMAIL COMPRADOR 1": P.email("bruno@exemplo.test"), "CELULAR COMPRADOR 1": P.texto("62 91111-1111"),
    "PROFISSÃO COMPRADOR 1": P.texto("PROFESSOR"), "NACIONALIDADE COMPRADOR 1": P.texto("BRASILEIRO"),
    "DATA DA VENDA": P.data("2026-09-01"), "DATA DE ASSINATURA DO CONTRATO": P.data("2026-09-10"),
    "VALOR DE VENDA": P.num(250000), "VALOR DO CRÉDITO": P.num(180000), "SUBISÍDIO": P.num(20000), "VALOR DO FGTS": P.num(10000),
    "CORRETOR": P.texto("corretor teste"), "IMOBILIÁRIA": P.texto("IMOBILIARIA, TESTE"),
    " COMISSÃO ": P.num(5000), "CONTRATO - CONDIÇÕES ESPECIAIS": P.texto("sem condições"),
    "TEM MANUAL DE OBRA?": P.sel("SIM"), "LOCALIZAÇÃO": P.url("https://mapa.exemplo.test/x"),
    "SETOR": P.texto("SETOR DA CASA"), "ENDEREÇO": P.texto("RUA DA CASA"), "CIDADE": P.texto("CIDADE DA CASA"),
    "SITUAÇÃO": P.formula(), "MC - SITUAÇÃO": P.texto("não copiar"), "ASSINATURA - SITUAÇÃO": P.texto("não copiar"),
    "DOSSIÊ - OBSERVAÇÃO DO COMPRADOR": P.texto("não copiar"),
    "DOC. PROPONENTE": P.arqs("rg-a.pdf"), "COMPROVANTE DE ENDEREÇO": P.arqs("luz-a.pdf"),
    "DOC. COMPRADOR 1": P.arqs("rg-b.pdf"), "COMP. END. COMPRADOR 1": P.arqs("luz-b.pdf"),
    "COMP. END. COMPRADOR 2": P.arqs("luz-c.pdf"), "COMPROVANTE CARTÓRIO": P.arqs("cartorio.pdf"),
    " PROTOCOLO DE TRANS. ÁGUA": P.arqs("agua.pdf"), "ANEXAR AQUIVO DE VISTORIA": P.arqs(),
    "CONTRATO": P.arqs("contrato-antigo.pdf"),
  }, extra);
}
