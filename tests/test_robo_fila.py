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


def test_mc_retrato_vira_robo_sem_aplicar():
    assert R.argumentos("mc-retrato", {"pageId": PG, "aplicar": True}, True) == (["-m", "venda.mc.retrato", "--page", PG], {})


def test_mc_retrato_pagina_invalida():
    assert R.argumentos("mc-retrato", {"pageId": "x"}, True) is None


def test_retrato_nao_tem_marcar_erro():
    assert R.marcar_erro_argv(["-m", "venda.mc.retrato", "--page", PG]) is None
    assert R.marcar_erro_argv(["-m", "venda.mc.lancar", "--page", PG])[-2] == "--marcar-erro"


# ---- 31/10/2026: depois de gravar uma venda pela fila, lê o retrato de TODAS as vendas ----
def test_apos_gravar_so_depois_de_gravar_de_verdade():
    todas = ["-m", "venda.mc.retrato", "--todas"]
    assert R.apos_gravar(["-m", "venda.mc.lancar", "--page", PG, "--aplicar"]) == todas
    assert R.apos_gravar(["-m", "venda.mc.lancar", "--page", PG, "--aplicar", "--anexar"]) == todas
    assert R.apos_gravar(["-m", "venda.mc.distrato", "--page", PG, "--recebeu", "sim", "--aplicar"]) == todas
    assert R.apos_gravar(["-m", "venda.mc.lancar", "--page", PG]) is None             # prévia
    assert R.apos_gravar(["-m", "venda.mc.lancar", "--page", PG, "--bloqueado"]) is None
    assert R.apos_gravar(["-m", "venda.mc.retrato", "--page", PG]) is None
    assert R.apos_gravar(["-m", "venda.mc.retrato", "--todas", "--aplicar"]) is None


def _atender_lancar_aplicando(tmp_path, monkeypatch, codigos):
    """Roda Fila.atender de um lançar --aplicar com subprocess.run trocado; codigos = código de cada chamada."""
    monkeypatch.setattr(R, "LOGS", tmp_path / "logs")
    chamadas, marcas = [], []

    class Res:
        def __init__(self, c):
            self.returncode, self.stdout, self.stderr = c, '{"situacao": "ok"}\n', ""

    def falso(argv, **k):
        chamadas.append((argv, k))
        c = codigos[min(len(chamadas) - 1, len(codigos) - 1)]
        if c == "excecao":
            raise OSError("quebrou")
        if c == "prazo":
            raise R.subprocess.TimeoutExpired(argv, 1)
        return Res(c)

    monkeypatch.setattr(R.subprocess, "run", falso)
    f = fila([], nome="producao")
    f.pode_gravar, f.vars = True, {"DB_VENDAS_COND": "d" * 32}
    monkeypatch.setattr(f, "marcar", lambda pid, sit, res="": marcas.append(sit))
    ln = linha("PENDENTE")
    ln["properties"]["PAYLOAD"]["rich_text"][0]["plain_text"] = json.dumps({"pageId": PG, "aplicar": True})
    return f.atender(ln), chamadas, marcas


def test_atender_gravou_com_sucesso_roda_o_retrato_de_todas_com_o_mesmo_env(tmp_path, monkeypatch):
    res, chamadas, marcas = _atender_lancar_aplicando(tmp_path, monkeypatch, [0, 0])
    assert res == "FEITO" and marcas == ["PEGO", "FEITO"]
    assert len(chamadas) == 2
    (a1, k1), (a2, k2) = chamadas
    assert a1[1:3] == ["-m", "venda.mc.lancar"] and "--aplicar" in a1
    assert a2[1:] == ["-m", "venda.mc.retrato", "--todas"]
    assert k2["env"] == k1["env"] and k2["env"]["DB_VENDAS_COND"] == "d" * 32
    assert k2["cwd"] == R.RAIZ and k2["timeout"] == R.PRAZO_ROBO_S


def test_atender_com_erro_nao_roda_o_retrato(tmp_path, monkeypatch):
    res, chamadas, marcas = _atender_lancar_aplicando(tmp_path, monkeypatch, [1, 0])
    assert res == "ERRO" and marcas == ["PEGO", "ERRO"]
    assert all("--todas" not in a for a, _ in chamadas)


def test_atender_previa_nao_roda_o_retrato(tmp_path, monkeypatch):
    monkeypatch.setattr(R, "LOGS", tmp_path / "logs")
    chamadas = []

    class Res:
        returncode, stdout, stderr = 0, "ok\n", ""

    monkeypatch.setattr(R.subprocess, "run", lambda argv, **k: chamadas.append(argv) or Res())
    f = fila([], nome="producao")
    monkeypatch.setattr(f, "marcar", lambda *a, **k: None)
    assert f.atender(linha("PENDENTE")) == "FEITO"      # payload só com pageId: prévia
    assert len(chamadas) == 1


def test_atender_retrato_que_falha_nao_muda_o_feito(tmp_path, monkeypatch):
    for falha in (2, "excecao", "prazo"):
        res, chamadas, marcas = _atender_lancar_aplicando(tmp_path, monkeypatch, [0, falha])
        assert res == "FEITO" and marcas == ["PEGO", "FEITO"], falha
        assert len(chamadas) == 2, falha
        log_do_dia = next((tmp_path / "logs").glob("*.log")).read_text(encoding="utf-8")
        assert "retratos depois de gravar" in log_do_dia, falha
