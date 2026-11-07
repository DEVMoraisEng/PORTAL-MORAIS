"""venda/ferramentas/criar_coluna_contrato_gerado_em.py (dono, 05/11/2026): só mostra por padrão; --criar faz UM
PATCH com a CONTRATO - GERADO EM (Data). Notion falso (nenhuma rede). Só dados inventados."""
import importlib.util
import pathlib

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "ferramentas" / "criar_coluna_contrato_gerado_em.py"


def carregar():
    spec = importlib.util.spec_from_file_location("criar_coluna_contrato_gerado_em", SCRIPT)
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


def test_plano_acento_caixa_e_tipo():
    m = carregar()
    p = m.plano({"RESERVADA ": {"type": "select"}, "Data da Reserva": {"type": "date"}})
    assert p["existem"] == ["RESERVADA ", "Data da Reserva"]
    assert p["faltam"] == ["CONTRATO - GERADO EM"]
    assert p["faltam_conferir"] == []
    assert m.corpo_patch(["CONTRATO - GERADO EM"]) == {"properties": {"CONTRATO - GERADO EM": {"date": {}}}}
    assert m.plano({"contrato - gerado em": {"type": "rich_text"}})["tipo_errado"] == [("contrato - gerado em", "rich_text")]


def test_padrao_so_mostra(tmp_path, capsys):
    m = carregar()
    pedir, ch = falso({"ENDEREÇO": {"type": "title"}})
    assert m.main(["abc-123", token(tmp_path)], pedir=pedir) == 0
    assert [c[0] for c in ch] == ["GET"]
    assert ch[0][1] == "/databases/abc123"
    out = capsys.readouterr().out
    assert "faltam: CONTRATO - GERADO EM" in out
    assert "AVISO: a coluna RESERVADA não existe" in out
    assert "ntn-falso" not in out


def test_criar_faz_um_patch_so_com_a_coluna_nova(tmp_path):
    m = carregar()
    pedir, ch = falso({"RESERVADA": {"type": "select"}, "DATA DA RESERVA": {"type": "date"}})
    assert m.main(["abc", token(tmp_path), "--criar"], pedir=pedir) == 0
    assert [c[0] for c in ch] == ["GET", "PATCH"]
    assert ch[1][3] == {"properties": {"CONTRATO - GERADO EM": {"date": {}}}}


def test_tipo_errado_para_sem_gravar(tmp_path):
    m = carregar()
    pedir, ch = falso({"CONTRATO - GERADO EM": {"type": "rich_text"}})
    assert m.main(["abc", token(tmp_path), "--criar"], pedir=pedir) == 2
    assert [c[0] for c in ch] == ["GET"]
