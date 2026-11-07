"""venda/ferramentas/criar_colunas_corretor_pagamento.py (dono, 05/11/2026): só mostra por padrão; --criar faz UM
PATCH com as colunas que faltam. Notion falso (nenhuma rede). Só dados inventados."""
import importlib.util
import pathlib

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "ferramentas" / "criar_colunas_corretor_pagamento.py"


def carregar():
    spec = importlib.util.spec_from_file_location("criar_colunas_corretor_pagamento", SCRIPT)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def falso(props):
    chamadas = []

    def pedir(metodo, caminho, token, corpo=None):
        chamadas.append((metodo, caminho, token, corpo))
        return {"title": [{"plain_text": "CORRETORES TESTE"}], "properties": props}
    return pedir, chamadas


def token(tmp_path):
    t = tmp_path / "token.txt"
    t.write_text("ntn-falso\n", encoding="utf-8")
    return str(t)


def test_plano_acento_caixa_e_tipo():
    m = carregar()
    p = m.plano({"NOME": {"type": "title"}, "Chave Pix": {"type": "rich_text"}, "AGENCIA": {"type": "rich_text"},
                 "CONTA": {"type": "number"}})
    assert p["existem"] == ["Chave Pix", "AGENCIA"]
    assert p["faltam"] == ["BANCO", "TITULAR DA CONTA"]
    assert p["tipo_errado"] == [("CONTA", "number")]
    assert m.corpo_patch(["BANCO"]) == {"properties": {"BANCO": {"rich_text": {}}}}


def test_padrao_so_mostra(tmp_path, capsys):
    m = carregar()
    pedir, ch = falso({"NOME": {"type": "title"}})
    assert m.main(["abc-123", token(tmp_path)], pedir=pedir) == 0
    assert [c[0] for c in ch] == ["GET"]
    assert ch[0][1] == "/databases/abc123"
    out = capsys.readouterr().out
    assert "faltam: CHAVE PIX, BANCO, AGÊNCIA, CONTA, TITULAR DA CONTA" in out
    assert "ntn-falso" not in out


def test_criar_faz_um_patch_so_com_as_que_faltam(tmp_path):
    m = carregar()
    pedir, ch = falso({"NOME": {"type": "title"}, "BANCO": {"type": "rich_text"}})
    assert m.main(["abc", token(tmp_path), "--criar"], pedir=pedir) == 0
    assert [c[0] for c in ch] == ["GET", "PATCH"]
    assert sorted(ch[1][3]["properties"]) == ["AGÊNCIA", "CHAVE PIX", "CONTA", "TITULAR DA CONTA"]


def test_tipo_errado_para_sem_gravar(tmp_path):
    m = carregar()
    pedir, ch = falso({"CONTA": {"type": "number"}})
    assert m.main(["abc", token(tmp_path), "--criar"], pedir=pedir) == 2
    assert [c[0] for c in ch] == ["GET"]
