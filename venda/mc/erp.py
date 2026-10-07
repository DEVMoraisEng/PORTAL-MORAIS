# -*- coding: utf-8 -*-
"""Mais Controle por HTTP puro (API legada). Só o que o lançamento da venda usa.

Login devolve o accessToken (vive pouco: um 401 refaz o login uma vez). O WAF
do ERP recusa sem user-agent de navegador. Nenhuma função aqui grava sem que
quem chama tenha decidido gravar — as duas que gravam se chamam criar_*."""
from __future__ import annotations

import datetime as _dt
import json

import requests

from . import regras as R

LEGACY = "https://legacy-api.maiscontroleerp.com.br/maiscontrole/services"
ORIGEM = "https://acessar.maiscontroleerp.com.br"
USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
NATUREZAS_DE_VENDA = ("85a40f0e-320c-4b0f-a0cc-54926c9d5aaf",
                      "af7b5fdf-ec24-441c-9eee-e925a94c3bb8",
                      "204c948d-ec08-49fb-9813-d06a7ed27746")


class ErpErro(Exception):
    pass


class Erp:
    def __init__(self, email: str, senha: str, sessao=None, timeout: int = 90, aparelho: str = ""):
        self._email, self._senha = email, senha
        self._aparelho = aparelho   # deviceToken de um aparelho confiável (o site guarda no cookie MFA_DEVICE_CODES)
        self.http = sessao or requests.Session()
        self.timeout = timeout
        self.token = self.company_id = self.user_id = self.ou_id = None

    # -- infraestrutura ----------------------------------------------------
    def _base(self) -> dict:
        return {"accept": "application/json, text/plain, */*", "accept-language": "pt-BR",
                "origin": ORIGEM, "referer": ORIGEM + "/", "user-agent": USER_AGENT}

    def logar(self) -> None:
        h = self._base()
        if self._aparelho:
            h["x-device-code"] = self._aparelho
        r = self.http.post(LEGACY + "/users/login", json={"username": self._email, "password": self._senha},
                           headers=h, timeout=self.timeout)
        if r.status_code == 401:
            try:
                mfa = bool((r.json() or {}).get("mfaToken"))
            except ValueError:
                mfa = False
            if mfa:
                raise ErpErro("o Mais Controle pediu código de verificação (aparelho não confiável): "
                              + ("o código de aparelho MC_ROBO_APARELHO venceu ou não vale" if self._aparelho
                                 else "falta o segredo MC_ROBO_APARELHO"))
        if r.status_code >= 300:
            raise ErpErro("login recusado (HTTP %s)" % r.status_code)
        j = r.json()
        if j.get("mfaEnabled") and not j.get("accessToken"):
            raise ErpErro("o usuário do robô exige segundo fator e o login não devolveu acesso")
        emp = j.get("companies") or []
        if not j.get("accessToken") or not emp:
            raise ErpErro("login sem accessToken ou sem empresa")
        self.token, self.company_id = j["accessToken"], str(emp[0].get("id"))
        self.user_id, self.ou_id = str(j.get("id") or ""), str(j.get("organizationUnitId") or "")

    def _cab(self) -> dict:
        h = self._base()
        h.update({"authorization": "Bearer " + self.token, "company-id": self.company_id,
                  "user-id": self.user_id, "organization-unit-id": self.ou_id})
        return h

    def pedir(self, metodo: str, caminho: str, corpo=None, params=None, _de_novo=False):
        if not self.token:
            self.logar()
        r = self.http.request(metodo, LEGACY + caminho, json=corpo, params=params,
                              headers=self._cab(), timeout=self.timeout)
        if r.status_code == 401 and not _de_novo:
            self.logar()
            return self.pedir(metodo, caminho, corpo, params, True)
        if r.status_code >= 300:
            # guarda o CORPO da recusa: é ele que diz o campo que falta
            raise ErpErro("%s %s -> HTTP %s: %s" % (metodo, caminho.split("?")[0], r.status_code, r.text[:600]))
        return r.json() if r.text.strip() else None

    # -- leitura -----------------------------------------------------------
    def obras(self) -> list[dict]:
        return self.pedir("GET", "/works/all-for-sale", params={"projection": "simple"}) or []

    def obra(self, obra_id: str) -> dict:
        return self.pedir("GET", "/works/" + obra_id) or {}

    def cliente_por_cpf(self, cpf: str) -> list[dict]:
        d = R.so_digitos(cpf)
        j = self.pedir("GET", "/participants", params={"role": "CUSTOMER", "keyword": d, "page": 0,
                                                        "size": 20, "sort": "name"}) or {}
        return [p for p in j.get("content") or [] if R.so_digitos(p.get("cpf")) == d]

    def participante_por_nome(self, nome: str) -> list[dict]:
        alvo = R.chave(nome)
        j = self.pedir("GET", "/participants", params={"role": "CUSTOMER", "keyword": nome, "page": 0,
                                                        "size": 20, "sort": "name"}) or {}
        return [p for p in j.get("content") or [] if R.chave(p.get("name")) == alvo]

    def tabelas_reajuste(self) -> list[dict]:
        return self.pedir("GET", "/readjustment-tables/all") or []

    def homonimos(self, nome: str) -> list[dict]:
        """Qualquer cadastro (cliente, fornecedor, funcionário...) com o mesmo nome: o ERP recusa
        criar outro participante com nome igual ("Já existe um Fornecedor com este mesmo nome")."""
        alvo, out = R.chave(nome), []
        for papel in ("CUSTOMER", "SUPPLIER", "EMPLOYEE"):   # a busca exige o papel
            j = self.pedir("GET", "/participants", params={"role": papel, "keyword": nome, "page": 0,
                                                            "size": 20, "sort": "name"}) or {}
            for p in j.get("content") or []:
                if R.chave(p.get("name")) == alvo and p.get("id") not in {x.get("id") for x in out}:
                    out.append(dict(p, role=p.get("role") or papel))
        return out

    def recebimentos(self, inicio: str = "2020-01-01", fim: str | None = None) -> list[dict]:
        """Parcelas de venda por data de competência — serve para achar venda já lançada.
        Lista incompleta seria pior que erro (abriria espaço para duplicata): por isso lança."""
        fim = fim or (_dt.date.today() + _dt.timedelta(days=800)).isoformat()
        out, pagina = [], 0
        while True:
            params = [("startDate", inicio), ("endDate", fim), ("dateField", "REFERENCE_DATE"),
                      ("page", pagina), ("size", 2000)] + [("natureIds", n) for n in NATUREZAS_DE_VENDA]
            j = self.pedir("GET", "/receipt-installments", params=params)
            if not isinstance(j, dict):
                raise ErpErro("lista de recebimentos em formato inesperado")
            lote = j.get("content") or []
            out += lote
            if j.get("last", True) or not lote:
                return out
            pagina += 1
            if pagina >= 30:
                raise ErpErro("mais de 30 páginas de recebimentos; parei para não decidir com lista incompleta")

    # -- gravação (só com --aplicar) ----------------------------------------
    def criar_cliente(self, corpo: dict) -> dict:
        return self.pedir("POST", "/participants", corpo=corpo)

    def criar_venda(self, corpo: dict) -> dict:
        return self.pedir("POST", "/readjustment-sales", corpo=corpo)


def resumo(obj) -> str:
    return json.dumps(obj, ensure_ascii=False)[:300]
