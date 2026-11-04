# -*- coding: utf-8 -*-
"""Sala da água e energia (04/11/2026): lê o resumo da rodada do outro robô. Texto inventado, sem dado real."""
import datetime as dt
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "servidor"))

import sala_agua as A  # noqa: E402

RODADA = """=== RODADA 04/11/2026 07:30 (mês 2026-11) ===
python: C:\\Python\\python.exe

[0/4] Base mestre direto do Notion:
  lidas 10 linhas do Notion em 07:30:04
    problema na base: XX 01 QD 01 LT 01 CS 1 (EQUATORIAL): sem UC/matrícula
    problema na base: XX 01 QD 01 LT 02 CS 1 (EQUATORIAL): sem UC/matrícula
    problema na base: XX 01 QD 01 LT 02 CS 1 (EQUATORIAL): sem UC/matrícula
  planilha: base.xlsx regravada (10 linhas)

[1/4] Filas do mês (base mestre):
  EQUATORIAL: 3 na fila -> estado.json
  UC 000 repetida em mais de uma casa: não lança

[2/4] Equatorial:
  [07:31:23] rodada encerrada: 0 emissões; restam 3 UCs a tentar; parou por BOTAO_NAO_LIBERADO

[3/5] Sanesc:
  [07:47:23] rodada sanesc encerrada; restam 0 instalações a tentar

[4/6] Lançar no Mais Controle (Equatorial + Sanesc):
  Nada a lançar.

[5/6] Ligações novas: atrasados + 12 recorrências (criar_contas.py):
  [X] Não capturei a autenticação. A tela de Pagamentos carregou?
  ERRO (criar_contas.py, código 1):

[5b/6] Recorrências acabando: renovar 12 (renovar_recorrencias.py):
  ERRO (renovar_recorrencias.py, código 1): ar\\Lib\\x.py", line 1, in f
playwright._impl._errors.TimeoutError: Page.goto: Timeout 30000ms exceeded.

[6/6] Lembretes: DUVIDA em criar_contas = obra não resolvida.

duração: 0:41:45

ALERTA:
  - passo(s) com erro: criar_contas, renovar_recorrencias
  - Equatorial: 4 dias úteis sem emitir, 3 UC(s) pendente(s)
resumo salvo em C:\\x\\rodada.txt
e-mail NÃO enviado: SSLEOFError
"""

SAUDE = {"quando": "2026-11-04T08:12:08", "passos": {"notion_base": 0, "gerar_fila": 0, "coletar": 0, "coletar_sanesc": 0,
                                                     "lancar_mc": 0, "criar_contas": 1, "renovar_recorrencias": 1},
         "alertas": [], "codigo_saida": 1}


def test_le_os_passos_os_erros_e_as_repetidas():
    r = A.ler_rodada(RODADA, "rodada_2026-11-04_0730.txt")
    assert r["inicio"] == "2026-11-04T07:30:00" and r["mes"] == "2026-11" and r["duracao"] == "0:41:45"
    assert set(r["passos"]) == {"notion", "filas", "equatorial", "sanesc", "lancar", "contas", "recorrencias"}
    assert r["passos"]["lancar"]["linhas"] == ["Nada a lançar."]           # não confunde com "Equatorial + Sanesc"
    assert r["passos"]["contas"]["erro"].startswith("criar_contas.py, código 1 — [X] Não capturei")
    assert r["passos"]["recorrencias"]["erro"].endswith("TimeoutError: Page.goto: Timeout 30000ms exceeded.")
    assert len(r["alertas"]) == 2 and r["email"].startswith("e-mail NÃO enviado") and not r["ok"]
    assert [p["casa"] for p in r["problemas"]] == ["XX 01 QD 01 LT 01 CS 1", "XX 01 QD 01 LT 02 CS 1"]
    dup = [d["motivo"] for d in r["duplicados"]]
    assert dup[0].startswith("aparece 2 vezes na base do Notion") and any("repetida em mais de uma casa" in d for d in dup)


def _pasta(tmp_path, saude=SAUDE):
    rel = tmp_path / "relatorios"
    (rel / "rodadas" / "2026-11").mkdir(parents=True)
    (rel / "rodadas" / "2026-11" / "rodada_2026-11-04_0730.txt").write_text(RODADA, encoding="utf-8")
    (rel / "rodadas" / "2026-11" / "rodada_2026-11-04_0730.pdf").write_bytes(b"%PDF-1.4")
    (rel / "rodadas" / "2026-11" / "rodada_2026-11-03_0730.txt").write_text(
        RODADA.replace("04/11/2026", "03/11/2026").split("ALERTA:")[0].replace("ERRO (", "ok ("), encoding="utf-8")
    (rel / "rodadas" / "2026-09").mkdir()
    (rel / "rodadas" / "2026-09" / "rodada_2026-09-01_0730.txt").write_text(RODADA, encoding="utf-8")   # velha demais
    (rel / "ULTIMA_SAUDE.json").write_text(json.dumps(saude), encoding="utf-8")
    (rel / "ALERTA.txt").write_text("passo(s) com erro: criar_contas\n", encoding="utf-8")
    return tmp_path


def test_monta_a_sala_com_estado_de_cada_passo(tmp_path):
    sala = A.montar_sala(_pasta(tmp_path), hoje=dt.date(2026, 11, 4))
    assert [r["arquivo"] for r in sala["rodadas"]] == ["rodada_2026-11-04_0730.txt", "rodada_2026-11-03_0730.txt"]
    e = sala["rodadas"][0]["estados"]
    assert e["contas"]["st"] == "erro" and e["recorrencias"]["st"] == "erro" and e["equatorial"]["st"] == "erro"
    assert e["sanesc"] == {"st": "ok", "texto": "[07:47:23] rodada sanesc encerrada; restam 0 instalações a tentar"}
    assert e["lancar"]["st"] == "ok" and sala["alerta"] == ["passo(s) com erro: criar_contas"]
    ontem = sala["rodadas"][1]
    assert ontem["ok"] and ontem["estados"]["contas"]["st"] == "ok"      # a saúde de hoje não vale para ontem
    assert "texto" in sala["rodadas"][0]
    json.dumps(sala)


def test_pdf_sobe_com_o_nome_que_o_apps_script_aceita(tmp_path):
    import re
    sala = A.montar_sala(_pasta(tmp_path), hoje=dt.date(2026, 11, 4))
    r = sala["rodadas"][0]
    cam = A.caminho_do_pdf(r)
    assert cam == "robos/pdf/2026-11/2026-11-04_0730_agua_FALHOU.pdf"
    assert re.match(r"^robos/pdf/\d{4}-\d\d/\d{4}-\d\d-\d\d_\d{4}_[0-9a-z-]{1,40}_(ok|FALHOU)\.pdf$", cam)
    assert A.arquivo_local_do_pdf(r, tmp_path).exists()
    assert A.caminho_do_pdf(sala["rodadas"][1]) is None                   # sem PDF ao lado


def test_sem_a_pasta_do_robo_nao_tem_sala(tmp_path):
    assert A.montar_sala(tmp_path / "nao-existe") is None


def test_concessionarias_do_resumo():
    t = ("    por concessionária: {'EQUATORIAL': 3, 'SANEAGO': 2, 'SANESC': 4}\n"
         "  EQUATORIAL: 1 na fila -> x.json\n  SANESC: 2 na fila -> y.json\n")
    assert A.concessionarias(t) == {"base": {"EQUATORIAL": 3, "SANEAGO": 2, "SANESC": 4},
                                    "fila": {"EQUATORIAL": 1, "SANESC": 2}}


EMAIL_FALSO = '''
SO_AVISO = ("cliente",)
def resumir(texto):
    return {"problemas": [{"obra": "XX 01 QD 01 LT 01 CS 1", "motivo": "sem matrícula válida"}], "falhas": [{"passo": "Ligações novas", "texto": "Não capturei a autenticação"}],
            "baixadas": [], "lancamentos": [], "ja_lancadas": 0, "recorrencias": 0, "renovadas": 0, "avista": 0, "sem_fatura": 1}
def agrupar(r):
    return [{"chave": "taxa", "titulo": "Taxa", "quem": "Financeiro", "fazer": "pedir boleto", "itens": ["XX 01 QD 01 LT 02 CS 1 — taxa R$ 1,00"]},
            {"chave": "sem_uc", "titulo": "Sem UC", "quem": "Cadastro", "fazer": "preencher", "itens": ["XX 01 QD 01 LT 01 CS 1"]}]
def pendencias(g):
    return 2
def explicar_falha(t):
    return ("o Chrome não entrou", "ver o login")
'''
PDF_FALSO = '''
URL_PARCELA = "https://mc/#/payable-installments/{}"
L = [{"obra": "XX 01 QD 01 LT 02 CS 1", "conc": "EQUATORIAL", "url": "https://notion/e2", "chave": "111"},
     {"obra": "XX 01 QD 01 LT 02 CS 1", "conc": "SANESC", "url": "https://notion/s2", "chave": "222"},
     {"obra": "XX 01 QD 01 LT 01 CS 1", "conc": "SANESC", "url": "https://notion/s1", "chave": ""},
     {"obra": "XX 01 QD 01 LT 01 CS 1", "conc": "SANESC", "url": "https://notion/s1b", "chave": ""}]
def _norm(t):
    return t.upper()
def indice_notion(raiz):
    po, pc = {}, {}
    for l in L:
        po.setdefault(l["obra"], []).append(l)
        if l["chave"]:
            pc.setdefault(l["chave"], []).append(l)
    return po, pc
def carregar_parcelas(raiz):
    return {"111": {"id": "uu-e"}, "222": {"id": "uu-s"}}
def _casa(t, idx):
    obra = t.split(" — ")[0]
    return obra, t[len(obra):].strip(" —"), idx[0].get(obra, [])
'''


def test_pendencias_casa_a_casa_pelas_regras_do_robo(tmp_path):
    pasta = _pasta(tmp_path)
    (pasta / "coletor").mkdir()
    (pasta / "coletor" / "email_rodada.py").write_text(EMAIL_FALSO, encoding="utf-8")
    (pasta / "coletor" / "relatorio_pdf.py").write_text(PDF_FALSO, encoding="utf-8")
    sala = A.montar_sala(pasta, hoje=dt.date(2026, 11, 4))
    assert sala["avisos"] == []
    p = sala["rodadas"][0]["pend"]
    taxa = p["grupos"][0]["itens"][0]
    assert taxa["conc"] == "SANESC" and [l["url"] for l in taxa["notion"]] == ["https://notion/s2"]
    assert taxa["mc"] == ["https://mc/#/payable-installments/uu-s"]            # só a parcela da água
    sem_uc = p["grupos"][1]["itens"][0]
    assert sem_uc["conc"] == "SANESC" and sem_uc["mc"] == []
    assert p["falhas"][0]["causa"] == "o Chrome não entrou"
    d = sala["duplicadas"]
    assert len(d) == 1 and d[0]["tipo"] == "casa" and d[0]["obra"] == "XX 01 QD 01 LT 01 CS 1" and len(d[0]["notion"]) == 2
    assert sala["rodadas"][0]["conc"] == {} or isinstance(sala["rodadas"][0]["conc"], dict)


def test_email_reenviado_conta_como_enviado(tmp_path):
    pasta = _pasta(tmp_path)
    (pasta / "relatorios" / "emails_enviados.txt").write_text("rodada_2026-11-04_0730.txt\n", encoding="utf-8")
    sala = A.montar_sala(pasta, hoje=dt.date(2026, 11, 4))
    assert sala["rodadas"][0]["email_enviado"] is True and sala["rodadas"][1]["email_enviado"] is False


def test_problemas_publicos_sem_valor_nem_cpf():
    sala = {"rodadas": [{"arquivo": "rodada_2026-11-04_0730.txt", "inicio": "2026-11-04T07:30:00", "pend": {"grupos": [
        {"chave": "duvida", "titulo": "Lançamento em dúvida", "quem": "Financeiro", "fazer": "conferir", "so_aviso": False,
         "itens": [{"obra": "XX 01 QD 01 LT 01 CS 1", "conc": "SANESC", "detalhe": "R$ 123,45 — CPF 123.456.789-00 sem obra",
                    "mc": ["https://mc/#/payable-installments/uu"],
                    "notion": [{"url": "https://www.notion.so/Casa-0123456789abcdef0123456789abcdef", "uc": "777"}]}]},
        {"chave": "cliente", "titulo": "Casa do cliente", "so_aviso": True, "itens": [{"obra": "Y"}]}]}}],
        "duplicadas": [{"tipo": "casa", "obra": "XX", "conc": "EQUATORIAL", "uc": "sem UC",
                        "notion": [{"url": "https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}]}
    d = A.problemas_publicos(sala)
    it = d["itens"][0]
    assert d["ok"] and len(d["itens"]) == 1 and it["grupo"] == "duvida"
    assert "123,45" not in it["motivo"] and "456.789" not in it["motivo"] and "sem obra" in it["motivo"]
    assert it["notion"] == ["0123456789abcdef0123456789abcdef"] and it["uc"] == "777" and it["mc"]
    assert d["duplicadas"][0]["notion"] == ["a" * 32]
    assert A.problemas_publicos(None)["ok"] is False
