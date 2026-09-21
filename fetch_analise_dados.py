#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_analise_dados.py — PORTAL-MORAIS
Morais Engenharia e Construção

Gera os dados da analise-dados.html (ANÁLISE DE DADOS: dashboard, metas,
prazos, fluxo de caixa, análise de desempenho e custos) e grava no SUPABASE —
não no dist/. É o fetch_all.py do repositório CONTROLES-INTERNOS trazido para o
portal, com cinco diferenças:

0. NADA PÚBLICO. Mesmo desenho do Orçado x Realizado: o resultado vai para a
   tabela analise_dados do Supabase (RLS ligado, sem policy — só a
   service_role lê e grava) e a tela busca pelo Apps Script (ação
   analiseDados), que confere login e o acesso "ANÁLISE DE DADOS". Fluxo de
   caixa e pagamento por fornecedor deixam de ficar num JSON aberto.
   A tabela é criada uma vez com o supabase_analise_dados.sql.

1. UM TOKEN SÓ. Lá eram NOTION_TOKEN_DOCS / _VENDAS / _METAS; aqui é o mesmo
   NOTION_TOKEN dos outros fetch_*.py. Os ids das bases ficam fixos no código
   (id do Notion não é credencial).

2. SEM DADO PESSOAL. O data.json de lá publicava CPF do comprador, CPF/CNPJ do
   proprietário e o NOME dos clientes. A tela nunca usou CPF, e de CLIENTES só
   usa "tem ou não tem" (venda feita). Aqui sai "clientes": true/false — mesma
   regra do "vendida" do mapa_vendas.json.

3. CAMPOS QUE MUDARAM DE CASA. Nº DE CASAS, IMPLANTAÇÃO, COTA DA EMPRESA (%) e
   DATA DE AQUISIÇÃO DO LOTE passam a ser digitados na base de OBRAS
   ((EMP) Projeto 2.0). Para obra ligada (OBRA-AUTO), vale o valor da OBRA;
   para obra antiga sem relação, continua valendo o de DOCUMENTOS.

4. ENDEREÇO PADRONIZADO NO CRUZAMENTO COM O ERP. O ERP escreve a obra do jeito
   dele ("LT34", "SV-24"); o Notion passa a usar "LT 34", "SV 24". Os dois
   lados passam pela mesma regra antes de casar — a mesma do Apps Script
   (obrPadronizarEndereco_).

Variáveis de ambiente (secrets do GitHub):
  NOTION_TOKEN          -> o mesmo dos outros fetch
  SUPABASE_URL          -> mesmos valores das Propriedades do Apps Script
  SUPABASE_SERVICE_KEY     (e do repositório OR-ADO-REALIZADO)
  ERP_CSV_PROPOSTAS     -> abas do ERP publicadas como CSV (Google Sheets)
  ERP_CSV_PAGAMENTOS
  ERP_CSV_OBRAS
  ERP_CSV_RECEBIMENTOS
Sem as URLs do ERP o arquivo sai do mesmo jeito, só sem a parte financeira.
"""

import csv
import io
import os
import re
from datetime import datetime, timezone

import json

import requests

from fetch_vendas import ler_banco, valor, norm, TOKEN

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()

ID_DOCS   = "32fc5ab532d380a0900dd7f4bfc619bd"   # BASE DE DADOS DOCUMENTOS
ID_VENDAS = "33cc5ab532d38047ae3aee8b87ac1f4d"   # BANCO DE DADOS VENDAS
ID_METAS  = "358c5ab532d3804fbcbfebc3656b1220"   # METAS
ID_OBRAS  = "306c5ab532d3812fa14fe9a281510128"   # (EMP) Projeto 2.0

ERP_CSV_PROPOSTAS    = os.environ.get("ERP_CSV_PROPOSTAS", "").strip()
ERP_CSV_PAGAMENTOS   = os.environ.get("ERP_CSV_PAGAMENTOS", "").strip()
ERP_CSV_OBRAS        = os.environ.get("ERP_CSV_OBRAS", "").strip()
ERP_CSV_RECEBIMENTOS = os.environ.get("ERP_CSV_RECEBIMENTOS", "").strip()

# coluna da OBRA -> chave do JSON (campos que mudaram de casa)
OBRA_SOBREPOE = {
    "N DE CASAS": "n_casas",
    "IMPLANTACAO": "implantacao",
    "COTA DA EMPRESA (%)": "cota_empresa",
    "DATA DE AQUISICAO DO LOTE": "data_aquisicao_lote",
}


# ─── ENDEREÇO NO PADRÃO "RUA QD XX LT XX" (igual ao Apps Script) ─────────
def padronizar_endereco(s):
    t = str(s or "").replace("\u2013", "-").replace("\u2014", "-").upper()
    t = re.sub(r"\s+", " ", t).strip()
    if not t:
        return t
    t = re.sub(r"\bQUADRA\b", "QD", t)
    t = re.sub(r"\bLOTE\b", "LT", t)
    t = re.sub(r"\s*-\s*", " ", t)
    t = re.sub(r"\b(QD|LT|CS)\.(?=\s*\d)", r"\1", t)
    t = re.sub(r"\b([A-Z]{1,4})(?=\d)", r"\1 ", t)

    def pad(m):
        n = m.group(2)
        return m.group(1) + " " + (n if len(n) >= 2 else "0" + n) + m.group(3)
    t = re.sub(r"\b(QD|LT) 0*(\d+)([A-Z]?)\b", pad, t)
    return re.sub(r"\s+", " ", t).strip()


# ─── LEITURA TOLERANTE ────────────────────────────────────────────────────
def indice_props(props):
    """nome normalizado -> propriedade (tolera acento, caixa e espaço sobrando)."""
    return {norm(k): v for k, v in (props or {}).items()}


def cru(ip, *nomes):
    for n in nomes:
        p = ip.get(norm(n))
        if p is not None:
            return valor(p)
    return None


def txt(ip, *nomes):
    """Texto de select/status/pessoa/texto/fórmula. Lista vira 'a, b'.
    Pessoa também — ENG. EXECUÇÃO e ENGENHEIRO RT estão virando 'Pessoa'."""
    v = cru(ip, *nomes)
    if isinstance(v, list):
        v = ", ".join(str(x) for x in v if x)
    if v is True:
        return "SIM"
    if v is False or v == "":
        return None
    return v


def num(ip, *nomes):
    v = cru(ip, *nomes)
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def data(ip, *nomes):
    v = cru(ip, *nomes)
    return str(v)[:10] if v else None


# ─── DOCUMENTOS ───────────────────────────────────────────────────────────
def parse_doc(page):
    p = indice_props(page.get("properties"))
    s = lambda *n: txt(p, *n)
    d = lambda *n: data(p, *n)
    return {
        "id":                        page.get("id"),
        "endereco":                  s("ENDEREÇO"),
        "ref":                       s("REF."),
        "setor":                     s("SETOR"),
        "cidade":                    s("CIDADE"),
        "data_aquisicao_lote":       d("DATA DE AQUISIÇÃO DO LOTE"),
        "cota_empresa":              num(p, "COTA DA EMPRESA (%)", "COTA DA EMPRESA"),
        "mestre":                    s("MESTRE"),
        "despachante":               s("DESPACHANTE"),
        "eng_execucao":              s("ENG. EXECUÇÃO"),
        "engenheiro_rt":             s("ENGENHEIRO RT"),
        "previsao_inicio_obra":      d("PREVISÃO DE INÍCIO DE OBRA"),
        "obra_iniciada":             s("OBRA INCIADA", "OBRA INICIADA"),
        "obra_finalizada":           s("OBRA FINALIZADA?"),
        "data_inicio_obra":          d("DATA DE INÍCIO DA OBRA"),
        "uso_solo_solicitado":       s("USO DO SOLO SOLICITADO"),
        "data_sol_uso_solo":         d("DATA DE SOLICITAÇÃO USO DO SOLO"),
        "uso_solo_emitido":          s("USO DO SOLO EMITIDO E ARMAZENADO"),
        "data_emissao_uso_solo":     d("DATA DE EMISSÃO DO USO DO SOLO"),
        "escritura_assinada":        s("ESCRITURA ASSINADA POR TODOS?"),
        "itbi_pago":                 s("ITBI PAGO ?", "ITBI PAGO?"),
        "registro_pago":             s("REGISTRO PAGO?"),
        "projeto_feito":             s("PROJETO FEITO?"),
        "art_feita_paga":            s("ART FEITA E PAGA?"),
        "escritura_registrada":      s("ESCRITURA REGISTRADA E DIGITALIZADA?"),
        "certidao_lote":             s("CERTIDÃO DO LOTE ANEXADA?"),
        "contrato_mestre":           s("CONTRATO MESTRE ASSINADO E ARMAZENADO?"),
        "contrato_investidor":       s("CONTRATO INVESTIDOR ASSINADO E ARMAZENADO?"),
        "taxas_alvara_pagas":        s("TAXAS ENTRADA ALVARÁ EMITIDAS E PAGAS?"),
        "data_entrada_alvara":       d("DATA DE ENTRADA DE ALVARA"),
        "mao_obra_despachante":      s("MAO OBRA INICIAL DESPACHANTE PAGA?"),
        "projeto_aprovado":          s("PROJETO APROVADO E ALVARA EMITIDO E ARMAZENADO?"),
        "data_aprovacao_projeto":    d("DATA DE APROVAÇÃO DO PROJETO"),
        "entrada_incorporacao":      s("FOI DADO ENTRADA NA INCORPORAÇÃO? (OBRAS CNPJ)"),
        "taxas_habite_se":           s("FORAM EMITIDAS E PAGAS AS TAXAS DE NUM OFICIAL, HABITE-SE E VISTORIA?"),
        "incorporacao_finalizada":   s("INCORPORAÇÃO FINALIZOU (OBRAS CNPJ)?"),
        "data_finalizacao_incorp":   d("DATA DE FINALIZAÇÃO DA INCORPORAÇÃO"),
        "entrada_ret":               s("FOI DATA A ENTRADA NO RET? (OBRAS CNPJ)"),
        "data_entrada_ret":          d("DATA DE ENTRADA DO RET"),
        "ret_armazenado":            s("RET ARMAZENADO"),
        "agendou_habite_se":         s("AGENDOU HABITE-SE?"),
        "data_finalizacao_ret":      d("DATA DE FINALIZAÇÃO DO RET"),
        "turno_habite_se":           s("TURNO HABITE-SE"),
        "data_habite_se":            d("DATA HABITE-SE"),
        "aprovou_habite_se":         s("APROVOU HABITE-SE?"),
        "data_aprovacao_habite":     d("DATA DE APROVAÇÃO DO HABITE-SE"),
        "armazenou_habite":          s("ARMAZENOU HABITE-SE?"),
        "issqn":                     s("GEROU E ARMAZENOU ISSQN?"),
        "cno_cnd":                   s("EMITIU CNO E CND DE OBRA?"),
        "art_acrescimo":             s("EMITIU ART DE ACRESCIMO?"),
        "certidoes_matricula":       s("SAIRAM AS CERTIDOES DE MATRICULA?"),
        "data_certidoes":            d("DATA DE EMISSÃO DAS CERTIDÕES"),
        "docs_vistoria_scpo":        s("EMITIU DOCUMENTOS DE VISTORIA E SCPO?"),
        "boletos_vistoria":          s("PAGOU BOLETOS DE VISTORIA CAIXA?"),
        "data_termino_obra":         d("DATA DE TÉRMINO DE OBRA"),
        "entrada_incorporacao_data": d("DATA DE ENTRADA NA INCORPORAÇÃO"),
        "n_casas":                   num(p, "Nº DE CASAS"),
        "implantacao":               s("IMPLANTAÇÃO"),
        "erp_orcado":                None,
        "erp_valor_pago":            None,
        "_obra_id":                  obra_id_de(p),
    }


def obra_id_de(ip):
    p = ip.get(norm("OBRA-AUTO"))
    rel = (p or {}).get("relation") or []
    return str(rel[0].get("id") or "").replace("-", "") if rel else None


def sobrepor_obras(documentos):
    """Para obra ligada, os quatro campos que mudaram de casa vêm da OBRA."""
    try:
        obras = ler_banco(ID_OBRAS, "OBRAS")
    except Exception as e:
        print(f"  ! OBRAS não lida ({e}) — segue com os valores de DOCUMENTOS", flush=True)
        return
    idx = {str(o.get("id")).replace("-", ""): indice_props(o.get("properties")) for o in obras}
    trocas = 0
    for doc in documentos:
        ip = idx.get(doc.get("_obra_id") or "")
        if not ip:
            continue
        for col, chave in OBRA_SOBREPOE.items():
            p = ip.get(norm(col))
            if p is None:
                continue
            v = valor(p)
            if isinstance(v, list):
                v = ", ".join(str(x) for x in v if x)
            if v in (None, "", []):
                continue
            if chave == "data_aquisicao_lote":
                v = str(v)[:10]
            doc[chave] = v
            trocas += 1
    print(f"  OBRAS: {trocas} valor(es) vieram da base de OBRAS", flush=True)


# ─── VENDAS ───────────────────────────────────────────────────────────────
def parse_venda(page):
    p = indice_props(page.get("properties"))
    s = lambda *n: txt(p, *n)
    d = lambda *n: data(p, *n)
    return {
        "id":                     page.get("id"),
        "endereco":               s("ENDEREÇO"),
        "casa":                   num(p, "CASA"),
        "ref":                    s("REF"),
        "cidade":                 s("CIDADE V1", "CIDADE VI", "CIDADE"),
        "setor":                  s("SETOR"),
        # booleano, nunca o nome — a tela só pergunta "está vendida?"
        "clientes":               bool(s("CLIENTES")),
        "data_venda":             d("DATA DA VENDA"),
        "correspondente":         s("CORRESPONDENTE"),
        "corretor":               s("CORRETOR"),
        "imobiliaria":            s("IMOBILIÁRIA", "IMOBILIARIA"),
        "avaliacao":              num(p, "AVALIAÇÃO"),
        "validade":               d("VALIDADE"),
        "valor_na_mao":           num(p, "VALOR NA MÃO"),
        "comissao":               num(p, "COMISSÃO"),
        "valor_venda_contrato":   num(p, "VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)"),
        "banco":                  s("BANCO"),
        "armazenou_contrato":     s("ARMAZENOU CONTRATO COMPRA E VENDA?"),
        "emitiu_rcpm":            s("EMITIU RCPM?"),
        "mandou_docs_corresp":    s("MANDOU TODOS OS DOCS. P/ CORESSPONDENTE?"),
        "data_envio_docs":        d("DATA DE ENVIO DOS DOCUMENTOS"),
        "mandou_conformidade":    s("MANDOU P/ CONFORMIDADE?"),
        "processo_conforme":      s("PROCESSO CONFORME?"),
        "assinou_contrato_banco": s("ASSINOU E ARMAZENOU CONTRATO DO BANCO?"),
        "data_assinatura":        d("DATA DE ASSINATURA DO CONTRATO"),
        "recebeu_taxa_vistoria":  s("RECEBEU TAXA VISTORIA?"),
        "tem_cadastro":           s("TEM NUMERO DE CADASTRO?"),
        "num_cadastro":           num(p, "Nº DE CADASTRO PREFEITURA"),
        "entrada_cartorio":       s("DEU ENTRADA NO CARTORIO?"),
        "agendou_pre_vistoria":   s("AGENDOU PRE VISTORIA?"),
        "data_pre_vistoria":      d("DATA DA PRÉ-VISTORIA"),
        "tem_manual":             s("TEM MANUAL DE OBRA?"),
        "registro_pronto":        s("FICOU PRONTO O REGISTRO?"),
        "devolveu_banco":         s("DEVOLVEU NO BANCO?"),
        "recebeu":                s("RECEBEU?"),
        "entregou_casa":          s("ENTEGOU A CASA E PEGOU TERMO DE ENTREGA?"),
        "data_entrega":           d("DATA DA ENTREGA"),
        "gcap_gerado":            s("GEROU E ARMAZENOU GCAP?"),
        "gcap_pago":              s("PAGOU GCAP?"),
        "pesquisa":               s("PREENCHEU A PESQUISA?"),
    }


# ─── METAS ────────────────────────────────────────────────────────────────
def buscar_metas():
    metas = []
    for page in ler_banco(ID_METAS, "METAS"):
        ano_str = None
        vals = {"meta_casas": None, "cs_cond_invest": None, "cs_cond_morais": None,
                "cs_rua_invest": None, "cs_rua_morais": None}
        for k, v in (page.get("properties") or {}).items():
            t, kl = v.get("type", ""), k.strip().lower()
            if t == "title":
                ano_str = valor(v)
            elif t == "number":
                n = v.get("number")
                if "meta" in kl and "casas" in kl:
                    vals["meta_casas"] = n
                elif "ano" in kl and n is not None:
                    ano_str = str(int(n))
                elif "cs cond" in kl and "invest" in kl:
                    vals["cs_cond_invest"] = n
                elif "cs cond" in kl and "morais" in kl:
                    vals["cs_cond_morais"] = n
                elif "cs rua" in kl and "invest" in kl:
                    vals["cs_rua_invest"] = n
                elif "cs rua" in kl and "morais" in kl:
                    vals["cs_rua_morais"] = n
        if not ano_str:
            continue
        try:
            metas.append({
                "ano": int(str(ano_str).strip()),
                "meta_casas": int(vals["meta_casas"] or 0),
                "cs_cond_invest": vals["cs_cond_invest"] or 0,
                "cs_cond_morais": vals["cs_cond_morais"] or 0,
                "cs_rua_invest": vals["cs_rua_invest"] or 0,
                "cs_rua_morais": vals["cs_rua_morais"] or 0,
            })
        except Exception as e:
            print(f"  METAS: ano inválido {ano_str!r}: {e}", flush=True)
    metas.sort(key=lambda x: x["ano"])
    return metas


# ─── ERP (abas do Google Sheets publicadas como CSV) ─────────────────────
def erp_csv(url, nome):
    if not url:
        print(f"  ERP {nome}: sem URL (secret ERP_CSV_{nome.upper()}) — pulado", flush=True)
        return []
    try:
        r = requests.get(url, timeout=60)
        if r.status_code != 200:
            print(f"  ERP {nome}: HTTP {r.status_code}", flush=True)
            return []
        rows = list(csv.DictReader(io.StringIO(r.content.decode("utf-8-sig"))))
        print(f"  ERP {nome}: {len(rows)} linhas", flush=True)
        return rows
    except Exception as e:
        print(f"  ERP {nome}: falhou — {e}", flush=True)
        return []


def mes_de(dt):
    dt = dt or ""
    m1 = re.match(r"(\d{2})/(\d{2})/(\d{4})", dt)
    m2 = re.match(r"(\d{4})-(\d{2})", dt)
    if m1:
        return f"{m1.group(3)}-{m1.group(2)}"
    if m2:
        return f"{m2.group(1)}-{m2.group(2)}"
    return "SEM DATA"


def num_br(v):
    s = str(v or "").strip()
    if not s:
        return None
    s = s.replace(".", "").replace(",", ".") if "," in s else s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def buscar_erp():
    orcados, pagos, pagos_detalhe, pagamentos_full = {}, {}, {}, []
    for row in erp_csv(ERP_CSV_PROPOSTAS, "propostas"):
        obra = padronizar_endereco(row.get("obra"))
        v = row.get("preco_total_com_desconto")
        if obra and v:
            try:
                orcados[obra] = float(str(v).replace(",", "."))
            except ValueError:
                pass
    for row in erp_csv(ERP_CSV_PAGAMENTOS, "pagamentos"):
        cc = padronizar_endereco(row.get("centro_de_custo") or row.get("obra") or row.get("descricao"))
        val = row.get("valor_pago")
        if not cc or not val:
            continue
        try:
            v = float(str(val).replace(",", "."))
        except ValueError:
            continue
        mes = mes_de(row.get("data_pagamento"))
        pagos[cc] = pagos.get(cc, 0) + v
        pagos_detalhe.setdefault(cc, {})
        pagos_detalhe[cc][mes] = pagos_detalhe[cc].get(mes, 0) + v
        jm = row.get("valor_juros_e_multa") or row.get("valor juros e multa") or ""
        pagamentos_full.append({
            "cc": cc, "valor": v, "mes": mes,
            "grupo": (row.get("grupo") or "").strip(),
            "categoria": (row.get("categoria") or "").strip(),
            "plano_de_conta": (row.get("plano_de_conta") or row.get("plano de conta") or "").strip(),
            "fornecedor": (row.get("fornecedor") or "").strip(),
            "juros_multa": num_br(jm) or 0,
        })
    print(f"  ERP: {len(orcados)} orçados, {len(pagos)} centros de custo, "
          f"{len(pagamentos_full)} pagamentos", flush=True)
    return orcados, pagos, pagos_detalhe, pagamentos_full


def buscar_obras_erp():
    obras = {}
    for row in erp_csv(ERP_CSV_OBRAS, "obras"):
        nome = padronizar_endereco(row.get("nome"))
        area = row.get("area_total")
        cliente = next((row[k] for k in row if "cliente" in k.lower()), "") or ""
        if not nome or not area:
            continue
        try:
            val = float(str(area).replace(",", "."))
        except ValueError:
            continue
        obras[nome] = {"area_total": obras.get(nome, {}).get("area_total", 0) + val,
                       "cliente": cliente.strip().upper()}
    return obras


def buscar_recebimentos_erp():
    rows = erp_csv(ERP_CSV_RECEBIMENTOS, "recebimentos")
    if not rows:
        return []
    cols = list(rows[0].keys())

    def achar(exatos, parciais):
        for c in exatos:
            if c in cols:
                return c
        for c in cols:
            if any(p in c.lower() for p in parciais):
                return c
        return None
    c_val = achar(["valor_recebido", "Valor Recebido", "VALOR RECEBIDO"], ["valor_receb", "valor receb"])
    c_dt = achar(["data_recebimento", "Data Recebimento", "DATA RECEBIMENTO"], ["data_receb", "data receb", "data"])
    c_cc = achar(["centro_de_custo", "centro de custo", "Centro de Custo", "CENTRO DE CUSTO"], ["centro", "custo", "obra"])
    if not c_val:
        print(f"  ERP recebimentos: coluna de valor não encontrada em {cols}", flush=True)
        return []
    rec = []
    for row in rows:
        cc = padronizar_endereco(row.get(c_cc, "") if c_cc else "")
        v = num_br(row.get(c_val, ""))
        if not cc or not v or v <= 0:
            continue
        rec.append({"cc": cc, "valor": v, "mes": mes_de((row.get(c_dt, "") if c_dt else "").strip())})
    return rec


# ─── SUPABASE ─────────────────────────────────────────────────────────────
def compactar_pagamentos(lista):
    """~18 mil linhas com os mesmos fornecedores, grupos e centros de custo
    repetidos: em objeto eram 3,7 MB. Em colunas com dicionário, o mesmo dado
    cabe numa fração disso — e é o que passa pelo Apps Script até o navegador.
    A tela remonta os objetos (ver expandirPagamentos na analise-dados.html).
    Ordem de cada linha: cc, valor, mes, grupo, categoria, plano_de_conta,
    fornecedor, juros_multa."""
    campos = ["cc", "mes", "grupo", "categoria", "plano_de_conta", "fornecedor"]
    dic = {c: [] for c in campos}
    pos = {c: {} for c in campos}

    def i(c, v):
        v = v or ""
        if v not in pos[c]:
            pos[c][v] = len(dic[c])
            dic[c].append(v)
        return pos[c][v]
    rows = [[i("cc", p["cc"]), round(p["valor"], 2), i("mes", p["mes"]), i("grupo", p["grupo"]),
             i("categoria", p["categoria"]), i("plano_de_conta", p["plano_de_conta"]),
             i("fornecedor", p["fornecedor"]), round(p["juros_multa"] or 0, 2)] for p in lista]
    return {"dic": dic, "rows": rows}


def gravar_supabase(partes):
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise SystemExit("Faltam os secrets SUPABASE_URL e/ou SUPABASE_SERVICE_KEY no GitHub.")
    agora = datetime.now(timezone.utc).isoformat()
    corpo = [{"parte": k, "dados": v, "atualizado": agora} for k, v in partes.items()]
    texto = json.dumps(corpo, ensure_ascii=False, separators=(",", ":"))
    r = requests.post(
        SUPABASE_URL + "/rest/v1/analise_dados?on_conflict=parte",
        data=texto.encode("utf-8"), timeout=120,
        headers={"apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY,
                 "Content-Type": "application/json",
                 "Prefer": "resolution=merge-duplicates,return=minimal"})
    if r.status_code >= 300:
        raise SystemExit(f"Supabase recusou ({r.status_code}): {r.text[:300]}")
    print(f"  Supabase: {len(corpo)} parte(s) gravada(s), {len(texto) // 1024} KB", flush=True)


# ─── MAIN ─────────────────────────────────────────────────────────────────
def main():
    if not TOKEN:
        raise SystemExit("Falta o secret NOTION_TOKEN no GitHub.")

    print("ANÁLISE DE DADOS — lendo DOCUMENTOS…", flush=True)
    documentos = [parse_doc(p) for p in ler_banco(ID_DOCS, "DOCUMENTOS")]
    sobrepor_obras(documentos)
    for d in documentos:
        d.pop("_obra_id", None)

    print("ANÁLISE DE DADOS — lendo VENDAS…", flush=True)
    vendas = [parse_venda(p) for p in ler_banco(ID_VENDAS, "VENDAS")]

    print("ANÁLISE DE DADOS — lendo METAS…", flush=True)
    metas = buscar_metas()

    print("ANÁLISE DE DADOS — lendo ERP…", flush=True)
    orcados, pagos, pagos_detalhe, pagamentos_full = buscar_erp()
    obras_erp = buscar_obras_erp()
    faturamentos_erp = buscar_recebimentos_erp()

    # Endereço padronizado nos DOIS lados (docs/vendas e ERP): a tela cruza
    # docs x vendas x ERP pelo endereço, e isso tem que casar mesmo antes de a
    # padronização rodar no Notion.
    for v in vendas:
        v["endereco"] = padronizar_endereco(v.get("endereco")) or v.get("endereco")
    enderecos = set()
    for doc in documentos:
        end = padronizar_endereco(doc.get("endereco"))
        doc["endereco"] = end or doc.get("endereco")
        enderecos.add(end)
        doc["erp_orcado"] = orcados.get(end, "SEM DADOS")
        doc["erp_valor_pago"] = pagos.get(end, "SEM DADOS")

    fat_por_tipo = {}
    for item in faturamentos_erp:
        cc = item["cc"]
        if "ESCRIT" in cc:
            tipo = "escritorio"
        elif cc == "POS OBRA MORAIS ENGENHARIA":
            tipo = "pos_obra"
        elif cc in enderecos or any(cc in e for e in enderecos):
            tipo = "obra"
        else:
            tipo = "outros"
        fat_por_tipo.setdefault(tipo, {})
        fat_por_tipo[tipo][item["mes"]] = fat_por_tipo[tipo].get(item["mes"], 0) + item["valor"]

    gravar_supabase({
        "base": {
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "documentos": documentos,
            "vendas": vendas,
            "pagamentos_detalhe": pagos_detalhe,
            "obras_erp": obras_erp,
            "faturamentos_erp": faturamentos_erp,
            "fat_por_tipo": fat_por_tipo,
            "metas": metas,
        },
        "pagamentos": compactar_pagamentos(pagamentos_full),
    })
    print(f"ANÁLISE DE DADOS: {len(documentos)} docs, {len(vendas)} vendas, "
          f"{len(pagamentos_full)} pagamentos, {len(metas)} metas", flush=True)


if __name__ == "__main__":
    main()
