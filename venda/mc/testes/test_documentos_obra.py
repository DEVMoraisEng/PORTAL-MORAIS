# -*- coding: utf-8 -*-
"""05/11/2026 — vigia dos documentos do Orçamento do MC (venda/mc/documentos_obra.py) com Notion, ERP e download
falsos. Só dados inventados — o repositório é público."""
import copy
import json

import pytest

from venda.mc import documentos_obra as D

PID = "a" * 32
OBRA_ID = "11111111-2222-4333-8444-555555555555"


def rt(s):
    return {"type": "rich_text", "rich_text": [{"plain_text": s, "text": {"content": s}}] if s else []}


def tit(s):
    return {"type": "title", "title": [{"plain_text": s}]}


def arquivos(*nomes):
    return {"type": "files", "files": [{"type": "file", "name": n, "file": {"url": "https://s3.notion.falso/" + n}} for n in nomes]}


def pagina(**mud):
    p = {"ENDEREÇO": tit("RUA TESTE QD 07 LT 02"), "CLIENTES ": rt("Comprador Inventado"),
         "ASSINATURA - SITUAÇÃO": {"type": "select", "select": None},
         "IMÓVEL - MATRÍCULA": arquivos(), "IMÓVEL - ALVARÁ": arquivos(), "IMÓVEL - HABITE-SE": arquivos(),
         "IMÓVEL - CERTIDÃO MÃE": arquivos(), "DOSSIÊ IMÓVEL - OBSERVAÇÃO": rt(""),
         D.COL_NOVOS: rt(""), D.COL_VISTOS: rt(""),
         "VENDEDOR MC - NOME": rt(""), "VENDEDOR MC - CPF/CNPJ": rt(""), "VENDEDOR MC - ENDEREÇO": rt(""), "VENDEDOR MC - E-MAIL": rt("")}
    for k, v in mud.items():
        k = k.replace("_", " ")
        if v is None:
            p.pop(k, None)
        else:
            p[k] = v
    return p


def arq(i, nome, ext="pdf", tam=1000):
    return {"id": "mc-%d" % i, "name": nome, "extension": ext, "sizeInBytes": tam}


class NotionFalso:
    def __init__(self, props):
        self.paginas = {PID: {"id": PID, "properties": props}}
        self.subidos, self.patches = [], []

    def linhas(self, db_id):
        return [copy.deepcopy(p) for p in self.paginas.values()]

    def pagina(self, page_id):
        return copy.deepcopy(self.paginas[page_id])

    def subir(self, nome, mime, conteudo):
        self.subidos.append((nome, mime, conteudo))
        return "fu-%d" % len(self.subidos)

    def gravar(self, page_id, props):
        self.patches.append(copy.deepcopy(props))
        pg = self.paginas[page_id]["properties"]
        for k, v in props.items():
            if "files" in v:
                pg[k] = {"type": "files", "files": [
                    ({"type": "file", "name": f["name"], "file": {"url": "https://s3.notion.falso/" + f["file_upload"]["id"]}}
                     if f.get("type") == "file_upload" else f) for f in v["files"]]}
            else:
                txt = "".join(x["text"]["content"] for x in v["rich_text"])
                pg[k] = rt(txt)


class ErpFalso:
    def __init__(self, pastas, obras=None, cliente=None):
        self._pastas, self.pedidos = pastas, []
        self._obras = obras if obras is not None else [{"id": OBRA_ID, "name": "RUA TESTE QD 7 LT 2"}]
        self._cliente = cliente

    def obras(self):
        return self._obras

    def pastas(self, entidade_id, origem):
        self.pedidos.append(("pastas", entidade_id, origem))
        return copy.deepcopy(self._pastas)

    def obra(self, obra_id):
        return {"id": obra_id, "customer": self._cliente} if self._cliente else {"id": obra_id}

    def link_do_arquivo(self, aid):
        self.pedidos.append(("link", aid))
        return "https://s3.mc.falso/" + aid


class Resp:
    def __init__(self, conteudo, status=200):
        self.content, self.status_code = conteudo, status


class HttpFalso:
    def __init__(self, falhar=()):
        self.baixados, self.falhar = [], set(falhar)

    def get(self, url, timeout=None):
        self.baixados.append(url)
        if url.rsplit("/", 1)[-1] in self.falhar:
            return Resp(b"", 500)
        return Resp(b"%PDF-1.4 falso " + url.encode())


# ---------------------------------------------------------------- puro
@pytest.mark.parametrize("arquivo,pasta,esp", [
    ("Matrícula 12.345 atualizada.pdf", "", "IMOVEL_MATRICULA"),
    ("certidao de inteiro teor.pdf", "", "IMOVEL_MATRICULA"),
    ("scan001.pdf", "MATRÍCULAS", "IMOVEL_MATRICULA"),
    ("Matrícula-mãe do condomínio.pdf", "", "IMOVEL_CERTIDAO_MAE"),
    ("CERTIDÃO MÃE.pdf", "MATRÍCULAS", "IMOVEL_CERTIDAO_MAE"),
    ("Alvará de construção 2026.pdf", "", "IMOVEL_ALVARA"),
    ("habite-se.pdf", "", "IMOVEL_HABITESE"),
    ("Carta de Habite Se.jpg", "", "IMOVEL_HABITESE"),
    ("certidão de conclusão de obra.pdf", "", "IMOVEL_HABITESE"),
    ("projeto arquitetonico.pdf", "PROJETOS", ""),
    ("certidão negativa de débitos.pdf", "CERTIDÕES", ""),
    ("alvara e habite-se.pdf", "", D.AMBIGUO),
    ("documento.pdf", "ALVARÁ E MATRÍCULA", D.AMBIGUO),
    ("alvara.pdf", "MATRÍCULAS", "IMOVEL_ALVARA"),            # o nome do arquivo vale mais que o da pasta
])
def test_classificar(arquivo, pasta, esp):
    assert D.classificar(arquivo, pasta) == esp


def test_achar_obra_pelo_endereco_sem_zero_a_esquerda():
    obras = [{"id": "1", "name": "RUA TESTE QD 7 LT 2"}, {"id": "2", "name": "RUA TESTE QD 07 LT 20"}]
    assert D.achar_obra(obras, "Rua Teste QD 07 LT 02") == (obras[0], "")
    assert D.achar_obra(obras, "RUA OUTRA QD 1 LT 1") == (None, "SEM_OBRA")
    assert D.achar_obra(obras + [{"id": "3", "name": "rua teste qd 07 lt 02"}], "RUA TESTE QD 7 LT 2") == (None, "OBRA_AMBIGUA")


def test_casa_alvo_so_casa_de_rua_vendida_e_nao_assinada():
    assert D.casa_alvo(pagina())
    assert not D.casa_alvo(pagina(**{"CLIENTES ": rt("")}))
    assert not D.casa_alvo(pagina(**{"ASSINATURA - SITUAÇÃO": {"type": "select", "select": {"name": "ASSINADO"}}}))
    assert not D.casa_alvo(pagina(**{"CONDOMÍNIO - VENDA ID": rt("b" * 32)}))


def test_planejar_primeira_olhada_nao_duplica_documento_que_ja_estava():
    pastas = [{"name": "MATRÍCULAS", "files": [arq(1, "matricula.pdf"), arq(2, "certidao mae.pdf")]},
              {"name": "PREFEITURA", "files": [arq(3, "alvara.pdf"), arq(4, "habite-se.docx", "docx"),
                                               arq(5, "alvara e habite-se.pdf"), arq(6, "foto.jpg", "jpg", 9 * 1024 * 1024),
                                               {"id": "mc-7", "name": "alvara 2.pdf", "temporary": True}]}]
    props = pagina(**{"IMÓVEL - MATRÍCULA": arquivos("matricula lida.pdf")})
    p = D.planejar(props, pastas)
    assert [(e, a["id"]) for e, a in p["anexar"]] == [("IMOVEL_CERTIDAO_MAE", "mc-2"), ("IMOVEL_ALVARA", "mc-3")]
    assert [(e, a["id"]) for e, a in p["ja_tinha"]] == [("IMOVEL_MATRICULA", "mc-1")]
    assert (p["ambiguos"], p["formato"], p["vistos_antes"]) == (1, 1, False)
    assert p["ignorados"] == 1          # foto.jpg não tem pista: "foto" — formato não chega a contar
    # depois da 1ª olhada, arquivo novo entra mesmo com o espaço cheio; o já visto não volta
    props[D.COL_VISTOS] = rt(D.escrever_vistos({"mc-1": "J:IMOVEL_MATRICULA"}))
    p2 = D.planejar(props, [{"name": "MATRÍCULAS", "files": [arq(1, "matricula.pdf"), arq(8, "matricula atualizada.pdf")]}])
    assert [a["id"] for _, a in p2["anexar"]] == ["mc-8"]
    # mesmo nome de um arquivo que já está no espaço: não anexa de novo
    p3 = D.planejar(props, [{"name": "", "files": [arq(9, "Matricula Lida", "pdf")]}])
    assert p3["anexar"] == [] and [a["id"] for _, a in p3["ja_tinha"]] == ["mc-9"]


def test_espacos_novos_junta_sem_repetir():
    assert D.espacos_novos("IMOVEL_ALVARA", ["IMOVEL_MATRICULA", "IMOVEL_ALVARA"]) == "IMOVEL_MATRICULA, IMOVEL_ALVARA"


def test_vendedor_do_mc_formata_documento_e_endereco():
    v = D.vendedor_do_mc({"customer": {"name": "  Fulano   Dono Teste ", "cpf": "00000000434", "email": "dono@exemplo.test",
                                       "address": {"address": "Rua Inventada", "addressNumber": "1", "neighborhood": "Setor Teste",
                                                   "zipCode": "74000000", "city": {"name": "Cidade Teste", "state": {"abbreviation": "GO"}}}}})
    assert v == {"nome": "Fulano Dono Teste", "doc": "000.000.004-34", "email": "dono@exemplo.test",
                 "endereco": "Rua Inventada, 1, Setor Teste, CEP 74000-000, Cidade Teste - GO"}
    assert D.vendedor_do_mc({}) == {}


# ---------------------------------------------------------------- rodada
PASTAS = [{"name": "DOCUMENTOS", "files": [arq(1, "Matrícula atualizada.pdf"), arq(2, "Alvará.pdf"), arq(3, "projeto.pdf")]}]
CLIENTE = {"name": "Fulano Dono Teste", "cpf": "00000000434", "address": {"address": "Rua Inventada", "addressNumber": "1"}}


def rodar(notion, erp, http, aplicar=True):
    saida = []
    cod = D.rodar(notion, erp, http, "db-vendas", aplicar, "05/11", saida.append)
    return cod, saida


def test_simulacao_nao_grava_nem_baixa():
    n, e, h = NotionFalso(pagina()), ErpFalso(PASTAS, cliente=CLIENTE), HttpFalso()
    cod, saida = rodar(n, e, h, aplicar=False)
    assert cod == 0
    assert n.patches == [] and n.subidos == [] and h.baixados == []
    assert any("a anexar: 2" in l for l in saida), saida
    assert saida[-1].startswith("OK:") and "SIMULAÇÃO" in saida[-1]


def test_anexa_marca_novo_observa_e_lembra_os_ids():
    n, e, h = NotionFalso(pagina(**{"IMÓVEL - ALVARÁ": arquivos()})), ErpFalso(PASTAS, cliente=CLIENTE), HttpFalso()
    cod, saida = rodar(n, e, h)
    assert cod == 0, saida
    assert ("pastas", OBRA_ID, "PLANNING") in e.pedidos
    assert [s[0] for s in n.subidos] == ["Matrícula atualizada.pdf", "Alvará.pdf"]
    assert all(s[1] == "application/pdf" for s in n.subidos)
    pg = n.paginas[PID]["properties"]
    assert [f["name"] for f in pg["IMÓVEL - MATRÍCULA"]["files"]] == ["Matrícula atualizada.pdf"]
    assert [f["name"] for f in pg["IMÓVEL - ALVARÁ"]["files"]] == ["Alvará.pdf"]
    novos = pg[D.COL_NOVOS]["rich_text"][0]["text"]["content"]
    assert novos == "IMOVEL_MATRICULA, IMOVEL_ALVARA"
    obs = pg["DOSSIÊ IMÓVEL - OBSERVAÇÃO"]["rich_text"][0]["text"]["content"]
    assert "[05/11 robô] Matrícula do imóvel: arquivo Matrícula atualizada.pdf anexado do Mais Controle" in obs
    vistos = json.loads(pg[D.COL_VISTOS]["rich_text"][0]["text"]["content"])["ids"]
    assert vistos == {"mc-1": "A:IMOVEL_MATRICULA", "mc-2": "A:IMOVEL_ALVARA"}
    assert pg["VENDEDOR MC - CPF/CNPJ"]["rich_text"][0]["text"]["content"] == "000.000.004-34"
    assert len(n.patches) == 1, "uma escrita só por casa"
    # nada de nome, endereço ou CPF no relatório
    tudo = "\n".join(saida)
    for s in ("Fulano", "Matrícula atualizada", "RUA TESTE", "004-34", "Comprador"):
        assert s not in tudo, s
    # a 2ª rodada não repete nada e não regrava o vendedor que já está igual
    n.patches.clear()
    cod2, saida2 = rodar(n, e, h)
    assert cod2 == 0 and len(n.subidos) == 2
    assert all("files" not in v for p in n.patches for v in p.values())
    assert not any(k.startswith("VENDEDOR MC") for p in n.patches for k in p)


def test_arquivo_que_ja_estava_nao_e_apagado_e_o_novo_entra_junto():
    props = pagina(**{"IMÓVEL - MATRÍCULA": arquivos("antiga.pdf")})
    props[D.COL_VISTOS] = rt(D.escrever_vistos({}))        # a casa já foi olhada antes
    props[D.COL_NOVOS] = rt("IMOVEL_HABITESE")
    n, e, h = NotionFalso(props), ErpFalso([{"name": "", "files": [arq(1, "matricula nova.pdf")]}]), HttpFalso()
    assert rodar(n, e, h)[0] == 0
    pg = n.paginas[PID]["properties"]
    assert [f["name"] for f in pg["IMÓVEL - MATRÍCULA"]["files"]] == ["antiga.pdf", "matricula nova.pdf"]
    assert n.patches[0]["IMÓVEL - MATRÍCULA"]["files"][0] == {"type": "file", "name": "antiga.pdf", "file": {"url": "https://s3.notion.falso/antiga.pdf"}}
    assert pg[D.COL_NOVOS]["rich_text"][0]["text"]["content"] == "IMOVEL_MATRICULA, IMOVEL_HABITESE"


def test_download_que_falha_fica_para_amanha_e_o_codigo_e_1():
    n, e, h = NotionFalso(pagina()), ErpFalso(PASTAS), HttpFalso(falhar={"mc-1"})
    cod, saida = rodar(n, e, h)
    assert cod == 1 and saida[-1].startswith("FALHOU:")
    vistos = json.loads(n.paginas[PID]["properties"][D.COL_VISTOS]["rich_text"][0]["text"]["content"])["ids"]
    assert "mc-1" not in vistos and vistos["mc-2"] == "A:IMOVEL_ALVARA"


def test_sem_obra_no_mc_e_sem_coluna_de_vistos_viram_pendencia_sem_gravar_arquivo():
    n, e = NotionFalso(pagina()), ErpFalso(PASTAS, obras=[])
    cod, saida = rodar(n, e, HttpFalso())
    assert cod == 0 and any(l.endswith("sem_obra") for l in saida) and n.patches == []
    n2 = NotionFalso(pagina(**{D.COL_VISTOS: None}))
    cod2, saida2 = rodar(n2, ErpFalso(PASTAS), HttpFalso())
    assert any("sem_coluna_vistos" in l for l in saida2)
    assert n2.subidos == []


def test_main_recusa_sem_porteiro(monkeypatch, capsys):
    monkeypatch.delenv("MC_VIA", raising=False)
    assert D.main() == 2
    assert "SO_PELO_PORTEIRO" in capsys.readouterr().out


def test_robo_registrado_no_servidor():
    import importlib
    import sys
    import pathlib
    raiz = pathlib.Path(__file__).resolve().parents[3]
    sys.path.insert(0, str(raiz / "servidor"))
    rf = importlib.import_module("robo_fila")
    ro = importlib.import_module("reorganizar")
    assert rf.ROBOS["documentos"] == ["robo_mc_documentos.py"]
    assert ro.ORDEM[-1] == "documentos"
    assert (raiz / "robo_mc_documentos.py").exists()
