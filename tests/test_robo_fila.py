# -*- coding: utf-8 -*-
"""Robô do servidor (servidor/robo_fila.py): pedido da fila -> comando, travas de gravar, pedidos presos."""
import datetime as dt
import json
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "servidor"))
import robo_fila as R  # noqa: E402

PG = "a" * 32


def test_previa_lancar_e_distrato_como_no_workflow():
    assert R.argumentos("mc-venda", {"pageId": PG, "aplicar": False}, True) == (["-m", "venda.mc.lancar", "--page", PG], {})
    assert R.argumentos("mc-venda", {"pageId": PG, "aplicar": True}, True)[0][-1] == "--aplicar"
    assert R.argumentos("mc-venda", {"pageId": PG, "aplicar": True, "anexar": True}, True)[0][-2:] == ["--aplicar", "--anexar"]
    argv = R.argumentos("mc-venda", {"acao": "distrato", "pageId": PG, "aplicar": False, "recebeu": "sim",
                                     "destino": "devolvido", "valor": "1.000,00", "data": "2026-11-30"}, True)[0]
    assert argv[:2] == ["-m", "venda.mc.distrato"] and "--recebeu" in argv and argv[-1] == "2026-11-30"


def test_sem_poder_gravar_vira_bloqueado_e_nunca_aplica():
    argv = R.argumentos("mc-venda", {"pageId": PG, "aplicar": True, "anexar": True}, False)[0]
    assert "--aplicar" not in argv and argv[-1] == "--bloqueado"


def test_pedido_invalido_e_recusado():
    assert R.argumentos("mc-venda", {"pageId": "x; rm -rf"}, True) is None
    assert R.argumentos("robos-mc", {"pageId": PG}, True) is None
    assert R.argumentos("mc-venda", {"pageId": PG, "acao": "outra"}, True) is None
    assert R.argumentos("mc-venda", {"acao": "distrato", "pageId": PG, "recebeu": "talvez"}, True) is None
    assert R.argumentos("mc-venda", {"acao": "distrato", "pageId": PG, "recebeu": "sim", "valor": "1;2"}, True) is None


def test_marcar_erro_na_pagina_da_venda():
    assert R.marcar_erro_argv(["-m", "venda.mc.lancar", "--page", PG, "--aplicar"]) == \
        ["-m", "venda.mc.lancar", "--page", PG, "--marcar-erro", "o robô do servidor falhou — veja o log do servidor"]


class NotionFalso:
    def __init__(self, linhas):
        self.linhas, self.chamadas = linhas, []

    def api(self, metodo, caminho, corpo=None):
        self.chamadas.append((metodo, caminho, corpo))
        if caminho.endswith("/query"):
            return {"results": self.linhas}
        return {}


def linha(sit, quando=None, tipo="mc-venda"):
    pr = {"SITUAÇÃO": {"type": "select", "select": {"name": sit}}, "TIPO": {"type": "select", "select": {"name": tipo}},
          "PAYLOAD": {"type": "rich_text", "rich_text": [{"plain_text": json.dumps({"pageId": PG})}]}}
    if quando:
        pr["CONCLUÍDO EM"] = {"type": "date", "date": {"start": quando}}
    return {"id": "l-" + sit, "properties": pr}


def fila(linhas, nome="teste"):
    f = R.Fila.__new__(R.Fila)
    f.nome, f.db, f.notion, f.token, f.vars, f.pode_gravar = nome, "f" * 32, NotionFalso(linhas), "tok", {}, False
    return f


def test_pego_recente_espera_e_pego_velho_volta():
    agora = dt.datetime.now(dt.timezone.utc)
    recente = (agora - dt.timedelta(minutes=2)).isoformat()
    velho = (agora - dt.timedelta(minutes=20)).isoformat()
    f = fila([linha("PENDENTE"), linha("PEGO", recente), {**linha("PEGO", velho), "id": "velho"}])
    assert [l["id"] for l in f.pendentes()] == ["l-PENDENTE", "velho"]


def test_env_do_robo_nunca_leva_senha_e_liga_o_porteiro(monkeypatch):
    monkeypatch.setenv("MC_ROBO_SENHA", "nao-pode")
    e = fila([]).env()
    assert e["MC_VIA"] == "porteiro" and e["NOTION_TOKEN"] == "tok" and "MC_ROBO_SENHA" not in e


def test_fila_teste_nunca_pode_gravar(tmp_path, monkeypatch):
    tok = tmp_path / "t.txt"
    tok.write_text("tok", encoding="utf-8")
    monkeypatch.setattr(R, "APLICAR", tmp_path / "VENDA_APLICAR.txt")
    (tmp_path / "VENDA_APLICAR.txt").write_text("", encoding="utf-8")
    cfg = {"db_fila": "f" * 32, "notion_token_arquivo": str(tok), "pode_gravar": True}
    assert R.Fila(dict(cfg, nome="teste")).pode_gravar is False
    assert R.Fila(dict(cfg, nome="producao")).pode_gravar is True
    (tmp_path / "VENDA_APLICAR.txt").unlink()
    assert R.Fila(dict(cfg, nome="producao")).pode_gravar is False, "sem o arquivo do dono, não grava"


# ---- 30/10/2026: robôs que rodavam no GitHub, agora no servidor pela aba do porteiro ----
def _cfg_robos(tmp_path, monkeypatch, **extra):
    tok = tmp_path / "notion.txt"
    tok.write_text("tok-ficticio", encoding="utf-8")
    cfg = {"robos": dict({"notion_token_arquivo": str(tok), "vars": {"CONTAS_DB_ID": "c" * 32}}, **extra)}
    (tmp_path / "robos-portal.json").write_text(json.dumps(cfg), encoding="utf-8")
    monkeypatch.setattr(R, "CENTRAL", tmp_path)
    monkeypatch.setattr(R, "CONFIG", tmp_path / "robos-portal.json")
    monkeypatch.setattr(R, "SAUDE", tmp_path / "saude.json")
    monkeypatch.setattr(R, "LOGS", tmp_path / "logs")
    return cfg["robos"]


def test_env_dos_robos_sem_senha_pelo_porteiro_e_aplicar_so_com_arquivo(tmp_path, monkeypatch):
    cfg = _cfg_robos(tmp_path, monkeypatch)
    monkeypatch.setenv("MC_SENHA", "nao-pode")
    monkeypatch.setenv("MC_ROBO_SENHA", "nao-pode")
    e = R.env_robos(cfg)
    assert e["MC_VIA"] == "porteiro" and e["NOTION_TOKEN"] == "tok-ficticio" and e["CONTAS_DB_ID"] == "c" * 32
    assert "MC_SENHA" not in e and "MC_ROBO_SENHA" not in e
    assert e["APLICAR"] == ""
    (tmp_path / "ROBOS_APLICAR.txt").write_text("", encoding="utf-8")
    assert R.env_robos(cfg)["APLICAR"] == "1"


def test_robo_antigo_roda_os_scripts_do_workflow_em_ordem_e_guarda_a_saude(tmp_path, monkeypatch):
    _cfg_robos(tmp_path, monkeypatch)
    rodou = []

    class Res:
        returncode, stdout, stderr = 0, "ok\n", ""

    monkeypatch.setattr(R.subprocess, "run", lambda argv, **k: rodou.append(argv[1]) or Res())
    assert R.robo_antigo("contas") == 0
    assert rodou == ["robo_mc_contas.py", "robo_mc_clientes.py", "robo_mc_obras.py"]
    assert json.loads((tmp_path / "saude.json").read_text(encoding="utf-8"))["robos"]["contas"]["codigo"] == 0
    assert R.robo_antigo("nao-existe") == 2


def test_medicoes_sem_token_do_github_nao_publica(tmp_path, monkeypatch):
    cfg = _cfg_robos(tmp_path, monkeypatch)
    monkeypatch.setattr(R, "RAIZ", tmp_path)
    (tmp_path / "dist" / "mc_medicoes").mkdir(parents=True)
    (tmp_path / R.ARQ_MEDICOES).write_text("{}", encoding="utf-8")
    monkeypatch.setattr(R.subprocess, "run", lambda *a, **k: None)
    assert "não publiquei" in R.publicar_medicoes(cfg)
