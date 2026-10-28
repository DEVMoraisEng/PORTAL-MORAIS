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
