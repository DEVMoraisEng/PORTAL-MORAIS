# -*- coding: utf-8 -*-
"""Regras de decisão do robô da HyperFlow (servidor/robo_hyperflow.py) — sem navegador."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "servidor"))
import robo_hyperflow as R  # noqa: E402

L = [{"k": "6299990001", "nome": "A"}, {"k": "6299990002", "nome": "B"}, {"k": "6299990003", "nome": "C"},
     {"k": "6299990004", "nome": "D"}, {"k": "6299990005", "nome": "E"}]


def test_chave_tel():
    assert R.chave_tel("p:+5562985603824") == "6285603824"
    assert R.chave_tel("62 9271-0858") == "6292710858"
    assert R.chave_tel("123") == ""


def test_oportunidade_vence_conversa():
    it = R.decidir(L[:1], {}, {"6299990001": "Ativo - Corretor"},
                   {"6299990001": {"tipo": "CLIENTE", "etapa": "Conversa: x", "lida": True}}, "2026-11-25T07:00")
    assert it[0]["tipo"] == "CORRETOR" and it[0]["completo"] is True and it[0]["fonte"] == "HYPERFLOW OPORTUNIDADES"


def test_manual_nunca_muda():
    assert R.decidir(L[:1], {"6299990001": {"tipo": "CLIENTE", "fonte": "MANUAL"}},
                     {"6299990001": "Ativo - Corretor"}, {}, "x") == []


def test_prospeccao_nao_rebaixa_cliente():
    atual = {"6299990002": {"tipo": "CLIENTE", "etapa": "Conversa: concluiu", "fonte": "HYPERFLOW CONVERSAS"},
             "6299990003": {"tipo": "", "etapa": "", "fonte": ""}}
    it = R.decidir(L[1:3], atual, {"6299990002": "Prospecção", "6299990003": "Prospecção"}, {}, "x")
    assert [i["k"] for i in it] == ["6299990003"] and it[0]["tipo"] == "SEM RESPOSTA"


def test_sem_mudanca_nao_grava():
    atual = {"6299990004": {"tipo": "CLIENTE", "etapa": "Oportunidade: Ativo - Cliente", "fonte": "HYPERFLOW OPORTUNIDADES"}}
    assert R.decidir(L[3:4], atual, {"6299990004": "Ativo - Cliente"}, {}, "x") == []


def test_fora_da_hyperflow_fica_como_esta():
    assert R.decidir(L[4:5], {"6299990005": {"tipo": "SEM CONVERSA"}}, {}, {}, "x") == []


def test_conversa_lida():
    it = R.decidir(L[4:5], {}, {}, {"6299990005": {"tipo": "RESPONDEU E PAROU", "etapa": "Conversa: y", "lida": True}}, "x")
    assert it[0]["tipo"] == "RESPONDEU E PAROU" and it[0]["fonte"] == "HYPERFLOW CONVERSAS"
