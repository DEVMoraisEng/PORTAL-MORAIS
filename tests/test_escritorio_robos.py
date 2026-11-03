# -*- coding: utf-8 -*-
"""Escritório de Robôs (servidor/escritorio_robos.py): horários das tarefas, rodadas e o .json ao lado do PDF."""
import datetime as dt
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "servidor"))
import escritorio_robos as E  # noqa: E402


def test_horario_das_tarefas_em_portugues():
    assert E.horario_texto({"tipo": "MSFT_TaskDailyTrigger", "inicio": "2026-10-29T06:23:00", "cadaDias": 1}) == "todo dia às 06:23"
    # seg–sáb, 07:20 a 19:20 de 2 em 2 h (medições)
    g = {"tipo": "MSFT_TaskWeeklyTrigger", "inicio": "2026-10-29T07:20:00-03:00", "dias": 2 + 4 + 8 + 16 + 32 + 64,
         "repetir": "PT2H", "duracao": "PT12H"}
    assert E.horario_texto(g) == "seg a sáb, das 07:20 às 19:20, de 2 em 2 h"
    assert E.horario_texto({"tipo": "MSFT_TaskWeeklyTrigger", "inicio": "2026-10-29T07:00:00", "dias": 2 | 32}) == "seg, sex às 07:00"
    assert E.horario_texto({"tipo": "MSFT_TaskTimeTrigger", "inicio": "2026-10-27T10:00:00", "repetir": "PT1M"}) == "a cada minuto"
    assert E.horario_texto({"tipo": "MSFT_TaskLogonTrigger", "inicio": ""}) == "quando o usuário do servidor entra"
    assert E._dias_texto(127) == "todo dia" and E._dias_texto(2 | 4) == "seg e ter"


def test_chave_da_tarefa_pelo_comando():
    assert E.chave_da_tarefa("MoraisEng - Robo contas", ['pythonw.exe "...rodar_e_relatar.py" --robo contas']) == "contas"
    assert E.chave_da_tarefa("MoraisEng - Robo indices", ["pythonw.exe rodar_e_relatar.py --indices"]) == "indices"
    assert E.chave_da_tarefa("MoraisEng - Água", ['pythonw.exe rodar_e_relatar.py --nome "Água e energia" --pasta x -- python a.py']) == "agua-e-energia"
    assert E.chave_da_tarefa("MoraisEng - Porteiro do ERP", ["python -m erp.porteiro vigiar"]) == "porteiro"
    assert E.chave_da_tarefa("MoraisEng - Robo do portal (fila)", ['pythonw.exe "C:\\x\\servidor\\robo_fila.py"']) == "fila"
    assert E.chave_da_tarefa("MoraisEng - Anexos da auditoria (tarde)", ["pythonw.exe robo_fila.py --robo anexos"]) == "anexos"


def test_montar_tarefas_resultado_e_estado():
    t = E.montar_tarefas([{"nome": "MoraisEng - Robo bases", "estado": "Running", "resultado": 267009,
                           "acoes": ["x --robo bases"], "gatilhos": [{"tipo": "MSFT_TaskDailyTrigger",
                                                                     "inicio": "2026-10-29T07:17:00", "ativo": True}]},
                          {"nome": "MoraisEng - Velha", "estado": "Disabled", "resultado": -2147216609, "acoes": [],
                           "gatilhos": []}])
    assert t[0]["chave"] == "bases" and t[0]["estado"] == "trabalhando" and t[0]["resultado_texto"] == "trabalhando agora"
    assert t[0]["horario"] == ["todo dia às 07:17"] and t[0]["titulo"] == "Robo bases"
    assert t[1]["estado"] == "desligada" and t[1]["resultado"] == 2147750687 and t[1]["horario"] == ["sem horário (só à mão)"]


def _r(ok=False):
    return {"robo": "medicoes", "nome": "Medições de contratos", "inicio": dt.datetime(2026, 11, 3, 13, 20),
            "fim": dt.datetime(2026, 11, 3, 13, 22), "codigo": 0 if ok else 1, "ok": ok,
            "itens": [{"hora": "13:21:10", "parte": "robo_mc_medicoes.py", "codigo": 0 if ok else 1, "texto": "HTTP 401"}],
            "falhas": [] if ok else [{"hora": "13:21:10", "parte": "robo_mc_medicoes.py", "codigo": 1, "texto": "HTTP 401"}],
            "porteiro": "porteiro: logado no Mais Controle", "indices": [], "evidencias": ["a.png"],
            "gravando": True, "saida": ["linha"], "repeticao": None}


def test_registro_tem_o_mesmo_o_que_fazer_do_email(tmp_path):
    explicar = lambda t: ("A sessão caiu.", "Entrar de novo.") if "401" in t else ("", "Ver o log.")
    pdf = tmp_path / "2026-11" / "2026-11-03_1320_medicoes_FALHOU.pdf"
    pdf.parent.mkdir()
    pdf.write_bytes(b"%PDF")
    js = E.salvar_rodada(_r(), pdf, explicar)
    reg = json.loads(js.read_text(encoding="utf-8"))
    assert reg["inicio"] == "2026-11-03T13:20:00" and reg["ok"] is False and reg["pdf"] == pdf.name
    assert reg["atencao"] == [{"parte": "robo_mc_medicoes.py", "oque": "A sessão caiu.", "fazer": "Entrar de novo."}]
    assert reg["evidencias"] == 1      # só a contagem, sem nome de arquivo


def test_rodadas_junta_json_e_pdf_antigo_sem_json(tmp_path):
    pasta = tmp_path / "2026-11"
    pasta.mkdir()
    pdf_novo = pasta / "2026-11-03_1320_medicoes_ok.pdf"
    pdf_novo.write_bytes(b"%PDF")
    E.salvar_rodada(_r(ok=True), pdf_novo)
    (pasta / "2026-11-02_0720_medicoes_FALHOU.pdf").write_bytes(b"%PDF")
    (pasta / "2026-09-01_0720_medicoes_ok.pdf").write_bytes(b"%PDF")       # velho demais: sai
    (pasta / "pendentes.txt").write_text("x")
    r = E.rodadas(tmp_path, hoje=dt.date(2026, 11, 3))
    assert list(r) == ["medicoes"] and len(r["medicoes"]) == 2
    novo, velho = r["medicoes"]
    assert novo["ok"] is True and novo["itens"]
    assert velho == {"robo": "medicoes", "inicio": "2026-11-02T07:20:00", "ok": False, "so_pdf": True,
                     "pdf": "2026-11-02_0720_medicoes_FALHOU.pdf"}


def test_publicar_nunca_lanca_erro(monkeypatch, tmp_path):
    monkeypatch.setattr(E, "CONFIG", tmp_path / "nao-existe.json")
    monkeypatch.setattr(E, "RELATORIOS", tmp_path)
    monkeypatch.setattr(E, "SAUDE", tmp_path / "saude.json")
    msgs = []
    assert E.publicar(msgs.append) is False and msgs[0].startswith("escritório FALHOU")
    pdf = tmp_path / "2026-11-03_1320_medicoes_ok.pdf"
    pdf.write_bytes(b"%PDF")
    E.depois_da_rodada(_r(ok=True), pdf, None, msgs.append)       # grava o .json mesmo sem conseguir subir
    assert pdf.with_suffix(".json").exists()


def test_rodar_de_novo_so_tarefas_morais_e_nunca_porteiro_fila_ou_teste():
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "servidor"))
    import robo_fila as R
    assert R.tarefa_para_rodar({"tarefa": "MoraisEng - Robo medicoes"}, "producao") == ("MoraisEng - Robo medicoes", "")
    assert R.tarefa_para_rodar({"tarefa": "MoraisEng - Anexos da auditoria (tarde)"}, "producao")[0]
    assert R.tarefa_para_rodar({"tarefa": "MoraisEng - Robo medicoes"}, "teste")[0] is None
    assert R.tarefa_para_rodar({"tarefa": "MoraisEng - Porteiro do ERP"}, "producao")[0] is None
    assert R.tarefa_para_rodar({"tarefa": "MoraisEng - Robo do portal (fila)"}, "producao")[0] is None
    for ruim in ("Outra tarefa", "MoraisEng - x\" & del *", "MoraisEng - a/b", "", None):
        assert R.tarefa_para_rodar({"tarefa": ruim}, "producao")[0] is None
