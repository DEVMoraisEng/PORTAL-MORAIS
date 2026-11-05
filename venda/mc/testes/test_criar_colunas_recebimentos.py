"""venda/ferramentas/criar_colunas_recebimentos.py (dono, 05/11/2026): só mostra por padrão; --criar faz UM PATCH com as
colunas que faltam; tipo errado para. Notion falso (nenhuma rede). Só dados inventados."""
import importlib.util
import pathlib

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "ferramentas" / "criar_colunas_recebimentos.py"


def carregar():
    spec = importlib.util.spec_from_file_location("criar_colunas_recebimentos", SCRIPT)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def falso(props):
    chamadas = []

    def pedir(metodo, caminho, token, corpo=None):
        chamadas.append((metodo, caminho, token, corpo))
        return {"title": [{"plain_text": "VENDAS TESTE"}], "properties": props}
    return pedir, chamadas


def token(tmp_path):
    t = tmp_path / "token.txt"
    t.write_text("ntn-falso\n", encoding="utf-8")
    return str(t)


def test_bate_com_as_colunas_que_o_portal_usa():
    """As mesmas de RecebimentoVenda.colunasNovas() (venda/RecebimentoVenda.gs)."""
    m = carregar()
    fonte = (SCRIPT.parents[1] / "RecebimentoVenda.gs").read_text(encoding="utf-8")
    for nome in ("PAGAMENTOS", "OUTROS COMPROVANTE", "MC - RECEBIMENTOS", "CONTRATO DE FINANCIAMENTO"):
        assert nome in fonte
    assert len(m.CRIAR) == 9
    assert m.corpo_patch(["MC - RECEBIMENTOS", "CONTRATO DE FINANCIAMENTO"]) == {
        "properties": {"MC - RECEBIMENTOS": {"rich_text": {}}, "CONTRATO DE FINANCIAMENTO": {"files": {}}}}


def test_padrao_so_mostra_e_criar_faz_um_patch(tmp_path, capsys):
    m = carregar()
    pedir, ch = falso({"ENDEREÇO": {"type": "title"}, "mc - venda id": {"type": "rich_text"}})
    assert m.main(["abc-123", token(tmp_path)], pedir=pedir) == 0
    assert [c[0] for c in ch] == ["GET"] and ch[0][1] == "/databases/abc123"
    out = capsys.readouterr().out
    assert "faltam: RECEBIMENTO - SINAL PAGAMENTOS" in out and "ntn-falso" not in out
    pedir, ch = falso({"ENDEREÇO": {"type": "title"}})
    assert m.main(["abc", token(tmp_path), "--criar"], pedir=pedir) == 0
    assert [c[0] for c in ch] == ["GET", "PATCH"] and len(ch[1][3]["properties"]) == 9


def test_tipo_errado_para(tmp_path, capsys):
    m = carregar()
    pedir, ch = falso({"MC - RECEBIMENTOS": {"type": "number"}})
    assert m.main(["abc", token(tmp_path), "--criar"], pedir=pedir) == 2
    assert [c[0] for c in ch] == ["GET"]
    assert "ATENÇÃO: a coluna MC - RECEBIMENTOS existe com o tipo number" in capsys.readouterr().out
