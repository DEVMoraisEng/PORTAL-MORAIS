# -*- coding: utf-8 -*-
"""Notion: ler a página da venda e escrever as duas colunas de retorno."""
from __future__ import annotations

import requests

from . import regras as R

API = "https://api.notion.com/v1"
VERSAO = "2022-06-28"


class Notion:
    def __init__(self, token: str, sessao=None):
        self.token = token
        self.http = sessao or requests.Session()

    def _cab(self):
        return {"Authorization": "Bearer " + self.token, "Notion-Version": VERSAO,
                "Content-Type": "application/json"}

    def pagina(self, page_id: str) -> dict:
        r = self.http.get(API + "/pages/" + page_id, headers=self._cab(), timeout=60)
        if r.status_code >= 300:
            raise RuntimeError("Notion GET página -> HTTP %s: %s" % (r.status_code, r.text[:300]))
        return r.json()

    def linhas(self, db_id: str) -> list[dict]:
        """Todas as linhas de uma base (páginas com propriedades)."""
        out, cur = [], None
        while True:
            corpo = {"page_size": 100}
            if cur:
                corpo["start_cursor"] = cur
            r = self.http.post(API + "/databases/%s/query" % db_id, json=corpo, headers=self._cab(), timeout=60)
            if r.status_code >= 300:
                raise RuntimeError("Notion query -> HTTP %s: %s" % (r.status_code, r.text[:300]))
            j = r.json()
            out += j.get("results") or []
            if not j.get("has_more"):
                return out
            cur = j.get("next_cursor")

    def baixar(self, url: str) -> bytes:
        r = self.http.get(url, timeout=120)
        if r.status_code >= 300:
            raise RuntimeError("download do arquivo -> HTTP %s" % r.status_code)
        return r.content

    def gravar_textos(self, page_id: str, props_atuais: dict, valores: dict) -> list[str]:
        """Grava texto nas colunas que EXISTEM (pelo nome normalizado). Devolve as que faltaram."""
        reais = {R.chave(k): (k, v.get("type")) for k, v in (props_atuais or {}).items()}
        props, faltou = {}, []
        for nome, texto in valores.items():
            achou = reais.get(R.chave(nome))
            if not achou or achou[1] != "rich_text":
                faltou.append(nome)
                continue
            props[achou[0]] = {"rich_text": [{"text": {"content": str(texto)[:1900]}}] if texto else []}
        if props:
            r = self.http.patch(API + "/pages/" + page_id, json={"properties": props}, headers=self._cab(), timeout=60)
            if r.status_code >= 300:
                raise RuntimeError("Notion PATCH -> HTTP %s: %s" % (r.status_code, r.text[:300]))
        return faltou
