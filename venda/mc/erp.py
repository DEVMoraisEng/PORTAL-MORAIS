# -*- coding: utf-8 -*-
"""Mais Controle por HTTP puro (API legada). Só o que o lançamento da venda usa.

Login devolve o accessToken (vive pouco: um 401 refaz o login uma vez). O WAF
do ERP recusa sem user-agent de navegador. Nenhuma função aqui grava sem que
quem chama tenha decidido gravar — as duas que gravam se chamam criar_*."""
from __future__ import annotations

import datetime as _dt
import json
import os
from urllib.parse import urlencode

import requests

from . import regras as R

LEGACY = "https://legacy-api.maiscontroleerp.com.br/maiscontrole/services"
ORIGEM = "https://acessar.maiscontroleerp.com.br"
CORE = "https://prod-erp-api.maiscontroleerp.com.br"   # API nova (Financeiro > Contas bancárias); usa o jwtToken
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
        self.jwt = str(j.get("jwtToken") or "")
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

    def pedir_core(self, metodo: str, caminho: str, corpo=None, params=None, _de_novo=False):
        """Mesma ideia do pedir, na API nova (CORE), com o jwtToken do login."""
        if not self.token:
            self.logar()
        if not getattr(self, "jwt", ""):
            raise ErpErro("o login não devolveu jwtToken (API nova)")
        h = self._base()
        h.update({"authorization": "Bearer " + self.jwt, "company-id": self.company_id})
        r = self.http.request(metodo, CORE + caminho, json=corpo, params=params, headers=h, timeout=self.timeout)
        if r.status_code == 401 and not _de_novo:
            self.logar()
            return self.pedir_core(metodo, caminho, corpo, params, True)
        if r.status_code >= 300:
            raise ErpErro("%s %s -> HTTP %s: %s" % (metodo, caminho.split("?")[0], r.status_code, r.text[:600]))
        return r.json() if r.text.strip() else None

    # -- anexo (receita lida no código do site, 06/10/2026) ------------------
    def anexar(self, venda_id: str, nome: str, conteudo: bytes, mime: str = "application/pdf") -> str:
        """Anexa um arquivo à pasta do recebimento da venda (a mesma "Arquivos" da tela). Devolve o id do arquivo.
        Passos: configuração (bucket) -> pasta do tradeReceivable -> registra o arquivo -> sobe ao S3 -> confirma."""
        cfg = self._config_arquivos()
        pasta = self.pasta_da_venda(venda_id, criar=True)
        return self.subir_arquivo(pasta["id"], nome, conteudo, mime, cfg)

    # -- pastas e arquivos (lidos no código do site em 03/11/2026; ver venda/mc/ANEXOS-ERP.md) -----------
    def _config_arquivos(self) -> dict:
        cfg = self.pedir("GET", "/system-configuration") or {}
        if not cfg.get("filesBucketURL") or not cfg.get("filesAccessKey"):
            raise ErpErro("configuração de arquivos do ERP sem bucket/chave")
        return cfg

    def pastas(self, entidade_id: str, origem: str) -> list[dict]:
        """Pastas da aba "Arquivos" de uma entidade: GET /folder?id=&origin= (FolderService.getAllByRoutine).
        Cada pasta traz `name` e a lista `files` (cada um com `name` e `extension`)."""
        return self.pedir("GET", "/folder", params={"id": entidade_id, "origin": origem}) or []

    def pasta_da_venda(self, venda_id: str, criar: bool = False) -> dict | None:
        venda = self.pedir("GET", "/sales/%s" % venda_id) or {}   # GET /readjustment-sales/{id} dá 405
        tr_id = (venda.get("tradeReceivable") or {}).get("id")
        if not tr_id:
            raise ErpErro("venda sem tradeReceivable para anexar")
        pastas = self.pastas(tr_id, "TRADE_RECEIVABLE_READJUSTED")
        if pastas or not criar:
            return pastas[0] if pastas else None
        pasta = self.pedir("POST", "/folder", corpo={
            "origin": "TRADE_RECEIVABLE_READJUSTED", "tradeReceivable": {"id": tr_id}}) or {}
        if not pasta.get("id"):
            raise ErpErro("o ERP não devolveu a pasta de arquivos da venda")
        return pasta

    @staticmethod
    def tem_arquivo(pasta: dict | None, nome: str) -> bool:
        """A pasta já tem um arquivo com este nome? O ERP guarda `name` (às vezes sem a extensão) e `extension`.
        Revisão 03/11: o POST /file registra o nome ANTES do S3 (como temporário; a tela só tira o temporário depois
        do S3). Registro temporário ou com tamanho zero, se a lista mostrar esses campos, não conta como enviado."""
        alvo = R.chave(nome)
        for f in (pasta or {}).get("files") or []:
            if f.get("temporary") is True or ("sizeInBytes" in f and not (f.get("sizeInBytes") or 0) > 0):
                continue
            n, ext = str(f.get("name") or ""), str(f.get("extension") or "")
            if ext and not ext.startswith("."):
                ext = "." + ext
            if alvo in (R.chave(n), R.chave(n + ext)):
                return True
        return False

    def pasta_do_orcamento(self, obra_id: str, nome_pasta: str) -> dict | None:
        """Pasta de Obras > Orçamento > Arquivos: a aba usa origin PLANNING com o id da OBRA (planning.work.id)."""
        alvo = R.chave(nome_pasta)
        achadas = [p for p in self.pastas(obra_id, "PLANNING") if R.chave(p.get("name")) == alvo]
        if len(achadas) > 1:
            raise ErpErro("há %d pastas \"%s\" no Orçamento" % (len(achadas), nome_pasta))
        return achadas[0] if achadas else None

    def cabe_na_pasta(self, pasta_id: str, tamanho: int) -> bool:
        """A tela confere antes de subir: GET /file/{pasta}/check-storage-capacity/{bytes}."""
        r = self.pedir("GET", "/file/%s/check-storage-capacity/%d" % (pasta_id, tamanho)) or {}
        return not r.get("exceedStorageCapacity")

    def subir_arquivo(self, pasta_id: str, nome: str, conteudo: bytes, mime: str, cfg: dict | None = None) -> str:
        """Registra o arquivo na pasta (POST /file?folderId=), sobe ao S3 e confirma (PATCH /file/set-temporary)."""
        cfg = cfg or self._config_arquivos()
        arq = self.pedir("POST", "/file", corpo={"name": nome, "type": mime, "sizeInBytes": len(conteudo)},
                         params={"folderId": pasta_id}) or {}
        if not arq.get("id"):
            raise ErpErro("o ERP não registrou o arquivo")
        try:
            if arq.get("saved") is not False:
                campos = [("AWSAccessKeyId", cfg["filesAccessKey"]), ("acl", "private"), ("success_action_status", "201"),
                          ("key", arq.get("key")), ("policy", arq.get("policy")), ("signature", arq.get("signature"))]
                r = self.http.post(cfg["filesBucketURL"], data=campos, files={"file": (nome, conteudo, mime)},
                                   timeout=max(self.timeout, 300))
                if r.status_code >= 300:
                    raise ErpErro("upload do arquivo recusado (HTTP %s)" % r.status_code)
            self.pedir("PATCH", "/file/set-temporary", params={"fileId": arq["id"], "temporary": "false"})
        except Exception as e:   # noqa: BLE001 — o registro já existe com o nome: sem apagar, o próximo pedido acharia "já enviado"
            motivo = str(e)[:200]
            try:   # FilesService.removeBatch = DELETE /file/delete-batch?fileIds=<id> (o "Remover" da tela)
                self.pedir("DELETE", "/file/delete-batch", params={"fileIds": [arq["id"]]})
            except Exception:   # noqa: BLE001
                raise ErpErro("%s — o registro do arquivo \"%s\" ficou na pasta sem conteúdo: apague à mão no Mais "
                              "Controle antes de pedir de novo" % (motivo, nome)) from None
            raise ErpErro("%s (registro apagado; pode pedir de novo)" % motivo) from None
        return arq["id"]

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

    def participantes_por_documento(self, doc: str) -> list[dict]:
        """Cadastros (de qualquer papel) com este CPF/CNPJ."""
        d, out = R.so_digitos(doc), []
        for papel in ("SUPPLIER", "CUSTOMER", "EMPLOYEE"):
            j = self.pedir("GET", "/participants", params={"role": papel, "keyword": d, "page": 0,
                                                            "size": 20, "sort": "name"}) or {}
            for p in j.get("content") or []:
                if d in (R.so_digitos(p.get("cpf")), R.so_digitos(p.get("cnpj"))) and                         p.get("id") not in {x.get("id") for x in out}:
                    out.append(dict(p, role=p.get("role") or papel))
        return out

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


class ErpPeloPorteiro(Erp):
    """O mesmo cliente, mas pela aba do Chrome do porteiro (servidor): nenhum login, nenhum código de aparelho.
    A autenticação é a que a própria tela usa (copiada do tráfego dela); um 401 manda a aba recapturar
    e repete UMA vez — 401 quer dizer que o ERP recusou antes de fazer qualquer coisa."""

    def __init__(self, aba=None, timeout: int = 90):
        super().__init__("", "", timeout=timeout)
        self._aba = aba            # sem aba: abre na 1ª chamada (o erro cai no try de quem chamou, como o login)

    def logar(self) -> None:
        from .porteiro import HOST_CORE, HOST_LEGACY, AbaPorteiro, PorteiroErro
        if self._aba is None:
            try:
                self._aba = AbaPorteiro.abrir()
            except PorteiroErro as e:
                raise ErpErro(str(e)) from None
            # 28/10 (prova no servidor): a aba ficava aberta no Chrome do porteiro depois do robô — fecha ao sair
            import atexit
            atexit.register(self.fechar)
        leg, core = self._aba.cabecalhos(HOST_LEGACY), self._aba.cabecalhos(HOST_CORE)
        if not leg.get("authorization") or not leg.get("company-id"):
            raise ErpErro("o Chrome do porteiro não está logado no Mais Controle — o porteiro precisa entrar")
        sem = lambda v: str(v or "").replace("Bearer ", "", 1).strip()   # noqa: E731
        self.token, self.company_id = sem(leg["authorization"]), str(leg["company-id"])
        self.user_id, self.ou_id = str(leg.get("user-id") or ""), str(leg.get("organization-unit-id") or "")
        self.jwt = sem(core.get("authorization"))

    def pedido_da_tela(self, trecho: str, espera: float = 20.0) -> str | None:
        """03/11: URL do pedido que a própria tela do porteiro fez (ver AbaPorteiro.pedido_da_tela)."""
        if not self.token:
            self.logar()
        f = getattr(self._aba, "pedido_da_tela", None)
        return f(trecho, espera) if f else None

    def fechar(self) -> None:
        """Fecha a aba deste robô (o Chrome do porteiro continua aberto e logado)."""
        if self._aba is not None:
            try:
                self._aba.fechar()
            except Exception:
                pass
            self._aba = None

    def _pela_aba(self, metodo, base, caminho, cab, corpo, params, de_novo, refazer):
        url = base + caminho
        if params:
            url += ("&" if "?" in url else "?") + urlencode(params, doseq=True)
        st, texto = self._aba.fetch(metodo, url, cab, corpo)
        if st == 401 and not de_novo:
            try:
                self._aba.capturar()
            except Exception as e:
                raise ErpErro(str(e)) from None
            self.logar()
            return refazer()
        if st >= 300:
            # mesma mensagem do login por senha: o CORPO da recusa diz o campo que falta
            raise ErpErro("%s %s -> HTTP %s: %s" % (metodo, caminho.split("?")[0], st, texto[:600]))
        if not texto.strip():
            return None
        try:
            return json.loads(texto)
        except ValueError:
            # 04/11 (4ª descoberta dos anexos): GET /file/{id}/get-url responde o LINK em texto puro, não JSON
            return texto.strip()

    def _cab_pagina(self, token: str) -> dict:
        return {"authorization": "Bearer " + token, "company-id": str(self.company_id)}

    def pedir(self, metodo: str, caminho: str, corpo=None, params=None, _de_novo=False):
        if not self.token:
            self.logar()
        cab = self._cab_pagina(self.token)
        cab.update({"user-id": self.user_id or "", "organization-unit-id": self.ou_id or ""})
        return self._pela_aba(metodo, LEGACY, caminho, cab, corpo, params, _de_novo,
                              lambda: self.pedir(metodo, caminho, corpo, params, True))

    def pedir_core(self, metodo: str, caminho: str, corpo=None, params=None, _de_novo=False):
        if not self.token:
            self.logar()
        if not getattr(self, "jwt", ""):
            raise ErpErro("a tela do porteiro não mostrou o token da API nova (prod-erp-api)")
        return self._pela_aba(metodo, CORE, caminho, self._cab_pagina(self.jwt), corpo, params, _de_novo,
                              lambda: self.pedir_core(metodo, caminho, corpo, params, True))


def pelo_porteiro() -> bool:
    """MC_VIA=porteiro: o robô roda no servidor e fala com o ERP pelo Chrome do porteiro."""
    return os.environ.get("MC_VIA", "").strip().lower() == "porteiro"


def faltam_segredos(outros=()) -> list:
    """Segredos que faltam. Pelo porteiro não há senha do robô: só os `outros` (ex.: NOTION_TOKEN)."""
    nomes = tuple(outros) + (() if pelo_porteiro() else ("MC_ROBO_EMAIL", "MC_ROBO_SENHA"))
    return [n for n in nomes if not os.environ.get(n)]


def do_ambiente() -> Erp:
    """O cliente do ERP certo para onde o robô está: servidor (porteiro) ou GitHub (login com senha, plano B)."""
    if pelo_porteiro():
        return ErpPeloPorteiro()
    return Erp(os.environ["MC_ROBO_EMAIL"].strip(), os.environ["MC_ROBO_SENHA"].strip(chr(13) + chr(10)),
               aparelho=os.environ.get("MC_ROBO_APARELHO", "").strip())


def resumo(obj) -> str:
    return json.dumps(obj, ensure_ascii=False)[:300]
