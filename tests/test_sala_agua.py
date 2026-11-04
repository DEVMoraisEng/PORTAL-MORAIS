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
