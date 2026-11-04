# -*- coding: utf-8 -*-
"""Coordenador da fila (servidor/reorganizar.py): quem falhou entra em ordem e roda um de cada vez."""
import datetime as dt
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "servidor"))
import reorganizar as RZ  # noqa: E402

REF = dt.datetime(2026, 11, 4, 10, 0)


def T(chave, estado="pronta", res=0, ultima="2026-11-04T07:00:00"):
    return {"nome": "MoraisEng - Robo " + chave, "titulo": "Robo " + chave, "chave": chave, "estado": estado,
            "resultado": res, "resultado_texto": "terminou bem" if res == 0 else "terminou com erro", "ultima": ultima}


def rods_falhas():
    return {"medicoes": [{"inicio": "2026-11-04T09:20:00", "ok": False}],
            "contas": [{"inicio": "2026-11-04T06:24:00", "ok": False}],
            "bases": [{"inicio": "2026-11-04T07:17:00", "ok": True}],
            "indices": [{"inicio": "2026-11-01T09:00:00", "ok": False}]}     # velho: fora da janela


def test_falharam_na_ordem_e_sem_porteiro_fila_ou_velhos():
    tarefas = [T("medicoes"), T("contas"), T("bases"), T("indices", res=0), T("retratos", res=1), T("coleta-agua-e-energia-diaria", res=1),
               T("porteiro", res=1), T("fila", res=1), T("anexos", estado="desligada", res=1)]
    assert [c for c, _ in RZ.falharam(tarefas, rods_falhas(), REF)] == ["contas", "medicoes", "retratos"]


def test_um_de_cada_vez_espera_outro_robo_e_o_porteiro(monkeypatch, tmp_path):
    monkeypatch.setattr(RZ, "PLANO", tmp_path / "reorganizar.json")
    monkeypatch.setattr(RZ, "agora", lambda: REF)
    tarefas = [T("medicoes", res=1), T("contas", res=1), T("bases")]
    plano, _ = RZ.criar_plano(tarefas, rods_falhas(), "Morais")
    assert [i["chave"] for i in plano["fila"]] == ["contas", "medicoes"]
    assert RZ.criar_plano(tarefas, rods_falhas())[0] is None          # já tem uma andando
    rodados = []
    rodar = lambda n: (rodados.append(n) or True, "")                   # noqa: E731
    porteiro = [False]
    # porteiro fora: espera
    msg = RZ.passo(tarefas, lambda: (porteiro[0], "não está logado"), rodar, REF)
    assert "esperando o porteiro" in msg and not rodados
    porteiro[0] = True
    # outro robô rodando no horário dele: espera
    ocupado = [T("medicoes", res=1), T("contas", res=1), T("bases", estado="trabalhando")]
    assert "esperando Robo bases" in RZ.passo(ocupado, lambda: (True, ""), rodar, REF)
    # solta o 1º
    assert RZ.passo(tarefas, lambda: (True, ""), rodar, REF) == "contas: disparado" and rodados == ["MoraisEng - Robo contas"]
    # ainda rodando: não solta o 2º
    rodando = [T("medicoes", res=1), T("contas", estado="trabalhando", res=267009), T("bases")]
    assert RZ.passo(rodando, lambda: (True, ""), rodar, REF + dt.timedelta(minutes=5)) is None and len(rodados) == 1
    # terminou bem → anota e depois solta o 2º
    fim = [T("medicoes", res=1), T("contas", res=0), T("bases")]
    assert RZ.passo(fim, lambda: (True, ""), rodar, REF + dt.timedelta(minutes=8)).startswith("contas: feito")
    assert RZ.passo(fim, lambda: (True, ""), rodar, REF + dt.timedelta(minutes=9)) == "medicoes: disparado"
    fim2 = [T("medicoes", res=1), T("contas", res=0), T("bases")]
    assert RZ.passo(fim2, lambda: (True, ""), rodar, REF + dt.timedelta(minutes=15)).startswith("medicoes: falhou")
    assert RZ.passo(fim2, lambda: (True, ""), rodar, REF + dt.timedelta(minutes=16)) == "terminado: 1 deram certo, 1 deram errado"
    assert RZ.passo(fim2, lambda: (True, ""), rodar, REF + dt.timedelta(minutes=17)) is None


def test_porteiro_fora_por_2h_cancela(monkeypatch, tmp_path):
    monkeypatch.setattr(RZ, "PLANO", tmp_path / "reorganizar.json")
    monkeypatch.setattr(RZ, "agora", lambda: REF)
    tarefas = [T("contas", res=1)]
    RZ.criar_plano(tarefas, {"contas": [{"inicio": "2026-11-04T06:24:00", "ok": False}]})
    fora = lambda: (False, "não está logado")                           # noqa: E731
    RZ.passo(tarefas, fora, lambda n: (True, ""), REF)
    assert "cancelei" in RZ.passo(tarefas, fora, lambda n: (True, ""), REF + dt.timedelta(hours=2, minutes=1))
    assert RZ.ler()["status"] == "cancelado"


def test_nada_falhou_nao_cria():
    assert RZ.criar_plano([T("contas")], {"contas": [{"inicio": "2026-11-04T06:24:00", "ok": True}]})[0] is None
