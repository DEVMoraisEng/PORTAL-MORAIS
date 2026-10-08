import pathlib, subprocess, sys, tempfile, unittest

AQUI = pathlib.Path(__file__).resolve().parent
EXEC = "https://script.google.com/macros/s/AKfyTESTE123/exec"


EXEC_VENDA = "https://script.google.com/macros/s/AKfyVENDA456/exec"


def rodar(raiz, *extra):
    return subprocess.run([sys.executable, str(AQUI / "apontar_para_teste.py"), "--raiz", str(raiz), *extra],
                          capture_output=True, text=True)


PAGES_YML = (
    "    steps:\n"
    "      - name: Buscar dados das Obras\n"
    "        run: python fetch_obras.py\n"
    "        env:\n"
    "          TOKEN: ${{ secrets.GH_TOKEN }}\n"
    "      - name: Buscar dados do Notion\n"
    "        run: python fetch_notion.py\n"
    "        env:\n"
    "          NOTION_TOKEN: ${{ secrets.NOTION_TOKEN }}\n"
    "      - name: Espelhar anexos das Ligações\n"
    "        run: python espelhar.py\n"
    "        env:\n"
    "          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}\n"
    "          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}\n"
    "      - name: Publicar site\n"
    "        if: github.event_name == 'push'\n"
    "        run: python publicar.py\n"
    "        env:\n"
    "          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}\n"
)


class Apontar(unittest.TestCase):
    def montar(self, d):
        (d / "Code.gs").write_bytes(b'VENDAS: "33cc5ab532d38047ae3aee8b87ac1f4d",\r\nvar GH_REPO = "DEVMoraisEng/PORTAL-MORAIS";\r\n')
        (d / "app.js").write_text('const API   = "https://script.google.com/macros/s/PROD1/exec";\n'
                                  'const API_ESCRITA = "https://script.google.com/macros/s/PROD2/exec";\n', encoding="utf-8")
        (d / "login.html").write_text('const API = "https://script.google.com/macros/s/AKfyPROD3/exec";\n', encoding="utf-8")
        (d / "fetch_vendas.py").write_text('ID_VENDAS_PADRAO = "33cc5ab532d38047ae3aee8b87ac1f4d"\n', encoding="utf-8")
        wf = d / ".github" / "workflows"; wf.mkdir(parents=True)
        (wf / "pages.yml").write_text(PAGES_YML, encoding="utf-8")
        (wf / "robos-mc.yml").write_text("name: Robôs\n", encoding="utf-8")
        (wf / "robos-mc-contas.yml").write_text("name: Robôs Contas\n", encoding="utf-8")
        (wf / "outro.yml").write_text("name: Outro\n", encoding="utf-8")
        (wf / "mc-venda.yml").write_text("name: Venda no Mais Controle\n", encoding="utf-8")
        (wf / "mc-indices.yml").write_text("name: Indices\n", encoding="utf-8")
        (d / "venda").mkdir()
        (d / "venda" / "nota.md").write_text("33cc5ab532d38047ae3aee8b87ac1f4d\n", encoding="utf-8")
        (d / "venda-dossie.js").write_text('  var URL_PORTAL_VENDA = "";   // URL /exec do PORTAL-VENDA\n', encoding="utf-8")
        (d / "fetch_obras.py").write_text('ID_OBRAS = "306c5ab532d3812fa14fe9a281510128"\n', encoding="utf-8")
        (d / "index.html").write_text('<img src="https://devmoraiseng.github.io/PORTAL-MORAIS/logo.png">\n', encoding="utf-8")
        (d / "robo_mc_clientes.py").write_text('COLETA_REPO = "DEVMoraisEng/OR-ADO-REALIZADO"\n', encoding="utf-8")
        sp = d / ".superpowers"; sp.mkdir()
        (sp / "x.md").write_text("33cc5ab532d38047ae3aee8b87ac1f4d\n", encoding="utf-8")

    def test_aponta_tudo_e_preserva_crlf(self):
        with tempfile.TemporaryDirectory() as t:
            d = pathlib.Path(t); self.montar(d)
            r = rodar(d, "--exec", EXEC, "--venda", EXEC_VENDA)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            code = (d / "Code.gs").read_bytes()
            self.assertIn(b"f53c5ab532d38325aa4a0193011aad24", code)
            self.assertIn(b"MoraisEng-Teste/PORTAL-MORAIS", code)
            self.assertIn(b"\r\n", code)
            app = (d / "app.js").read_text(encoding="utf-8")
            self.assertEqual(app.count(EXEC), 2)
            login = (d / "login.html").read_text(encoding="utf-8")
            self.assertIn(EXEC, login)
            self.assertNotIn("AKfyPROD3", login)
            self.assertIn("f53c5ab532d38325aa4a0193011aad24", (d / "fetch_vendas.py").read_text(encoding="utf-8"))
            pages = (d / ".github" / "workflows" / "pages.yml").read_text(encoding="utf-8")
            self.assertIn("      - name: Buscar dados das Obras\n        if: ${{ false }}\n", pages)
            self.assertIn("      - name: Espelhar anexos das Ligações\n        if: ${{ false }}\n", pages)
            self.assertNotIn("      - name: Buscar dados do Notion\n        if: ${{ false }}\n", pages)
            wf = d / ".github" / "workflows"
            self.assertFalse((wf / "robos-mc.yml").exists())
            self.assertFalse((wf / "robos-mc-contas.yml").exists())
            self.assertFalse((wf / "outro.yml").exists())
            self.assertTrue((wf / "pages.yml").exists())
            self.assertTrue((wf / "mc-venda.yml").exists())
            self.assertTrue((wf / "mc-indices.yml").exists())
            self.assertIn("33cc5ab532d38047ae3aee8b87ac1f4d", (d / "venda" / "nota.md").read_text(encoding="utf-8"))
            dossie = (d / "venda-dossie.js").read_text(encoding="utf-8")
            self.assertIn('var URL_PORTAL_VENDA = "' + EXEC_VENDA + '";', dossie)
            self.assertNotIn(EXEC, dossie)
            self.assertIn("33cc5ab532d38047ae3aee8b87ac1f4d", (d / ".superpowers" / "x.md").read_text(encoding="utf-8"))

    def test_ids_de_producao_conhecidos_alem_dos_10_viram_aviso_nao_erro(self):
        # M-4: Obras e Proprietários (e outros ids de produção conhecidos além
        # dos 10 do IDS) ficam desligados no fork (passos/robôs desligados) —
        # é AVISO impresso, não erro que derruba o returncode.
        with tempfile.TemporaryDirectory() as t:
            d = pathlib.Path(t); self.montar(d)
            r = rodar(d, "--exec", EXEC, "--venda", EXEC_VENDA)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertIn("AVISO", r.stdout)
            self.assertIn("306c5ab532d3812fa14fe9a281510128", r.stdout)
            self.assertIn("306c5ab532d3812fa14fe9a281510128", (d / "fetch_obras.py").read_text(encoding="utf-8"))

    def test_dominio_do_github_pages_e_trocado(self):
        # M-5: devmoraiseng.github.io/PORTAL-MORAIS -> moraiseng-teste.github.io/PORTAL-MORAIS
        with tempfile.TemporaryDirectory() as t:
            d = pathlib.Path(t); self.montar(d)
            r = rodar(d, "--exec", EXEC, "--venda", EXEC_VENDA)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            index = (d / "index.html").read_text(encoding="utf-8")
            self.assertIn("moraiseng-teste.github.io/PORTAL-MORAIS", index)
            self.assertNotIn("devmoraiseng.github.io", index)

    def test_sobra_de_devmoraiseng_de_outro_repo_vira_aviso(self):
        # M-5: COLETA_REPO de outro repositório DEVMoraisEng/... (não o
        # PORTAL-MORAIS principal, já trocado) só pode virar AVISO.
        with tempfile.TemporaryDirectory() as t:
            d = pathlib.Path(t); self.montar(d)
            r = rodar(d, "--exec", EXEC, "--venda", EXEC_VENDA)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertIn("AVISO", r.stdout)
            self.assertIn("DEVMoraisEng/OR-ADO-REALIZADO", r.stdout)
            self.assertIn("DEVMoraisEng/OR-ADO-REALIZADO", (d / "robo_mc_clientes.py").read_text(encoding="utf-8"))

    def test_segunda_rodada_nao_duplica(self):
        with tempfile.TemporaryDirectory() as t:
            d = pathlib.Path(t); self.montar(d)
            rodar(d, "--exec", EXEC, "--venda", EXEC_VENDA)
            r = rodar(d, "--exec", EXEC, "--venda", EXEC_VENDA)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            pages = (d / ".github" / "workflows" / "pages.yml").read_text(encoding="utf-8")
            # 3 passos desligados: Buscar dados das Obras, Espelhar anexos das
            # Ligações, Publicar site (este já tinha outro if:, substituído).
            self.assertEqual(pages.count("if: ${{ false }}"), 3)
            self.assertEqual(pages.count("if:"), 3)
            dossie = (d / "venda-dossie.js").read_text(encoding="utf-8")
            self.assertEqual(dossie.count(EXEC_VENDA), 1)

    def test_passo_com_if_existente_troca_condicao_sem_duplicar(self):
        # "Publicar site" já tem if: github.event_name == 'push' e usa um
        # segredo de produção (SUPABASE_URL): a condição existente deve ser
        # SUBSTITUÍDA por if: ${{ false }}, nunca uma segunda linha if:.
        with tempfile.TemporaryDirectory() as t:
            d = pathlib.Path(t); self.montar(d)
            r = rodar(d, "--exec", EXEC, "--venda", EXEC_VENDA)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            pages = (d / ".github" / "workflows" / "pages.yml").read_text(encoding="utf-8")
            passo = pages.split("- name: Publicar site", 1)[1].split("- name:", 1)[0]
            self.assertEqual(passo.count("if:"), 1)
            self.assertIn("if: ${{ false }}", passo)
            self.assertNotIn("github.event_name", passo)
            self.assertIn("AVISO", r.stdout)

    def test_recusa_url_que_nao_e_do_apps_script(self):
        with tempfile.TemporaryDirectory() as t:
            d = pathlib.Path(t); self.montar(d)
            r = rodar(d, "--exec", "https://exemplo.com/exec", "--venda", EXEC_VENDA)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("33cc5ab532d38047ae3aee8b87ac1f4d", (d / "Code.gs").read_text(encoding="utf-8"))

    def test_recusa_url_de_venda_invalida(self):
        with tempfile.TemporaryDirectory() as t:
            d = pathlib.Path(t); self.montar(d)
            r = rodar(d, "--exec", EXEC, "--venda", "https://exemplo.com/exec")
            self.assertNotEqual(r.returncode, 0)

    def test_venda_dossie_generico_nao_troca_pela_url_do_exec(self):
        # I-1: a troca genérica de TODA URL .../exec pela do PORTAL-TESTE não
        # pode atingir venda-dossie.js — senão numa próxima sincronização o
        # bloco passaria a chamar o PORTAL-TESTE errado (o do PORTAL-LEITURA/
        # ESCRITA) em vez do PORTAL-VENDA-TESTE.
        with tempfile.TemporaryDirectory() as t:
            d = pathlib.Path(t); self.montar(d)
            r = rodar(d, "--exec", EXEC, "--venda", EXEC_VENDA)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            dossie = (d / "venda-dossie.js").read_text(encoding="utf-8")
            self.assertEqual(dossie.count(EXEC_VENDA), 1)
            self.assertNotIn(EXEC, dossie)

    def test_segunda_sincronizacao_venda_dossie_volta_vazio_recebe_venda(self):
        # Simula uma nova sincronização do fork com a produção: venda-dossie.js
        # volta a ter a URL vazia (a versão do dono), e a segunda rodada do
        # apontador precisa gravar --venda de novo, sem depender de sobra
        # anterior.
        with tempfile.TemporaryDirectory() as t:
            d = pathlib.Path(t); self.montar(d)
            rodar(d, "--exec", EXEC, "--venda", EXEC_VENDA)
            (d / "venda-dossie.js").write_text('  var URL_PORTAL_VENDA = "";   // URL /exec do PORTAL-VENDA\n', encoding="utf-8")
            r = rodar(d, "--exec", EXEC, "--venda", EXEC_VENDA)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            dossie = (d / "venda-dossie.js").read_text(encoding="utf-8")
            self.assertIn('var URL_PORTAL_VENDA = "' + EXEC_VENDA + '";', dossie)


if __name__ == "__main__":
    unittest.main()


class Simulador(unittest.TestCase):
    SIM = "https://script.google.com/macros/s/AKfySIMTESTE789/exec"
    PROD = ("https://script.google.com/macros/s/AKfycbzwUIApU5nKXi1vG3cEs_V2DWCdkLDwY_vo0zBxO59ZBLbEihIxuOqbHdNLm-8pVVwVJQ/exec")

    def montar(self, d):
        (d / "proposta.html").write_text("var APPS_SCRIPT_URL = '" + self.PROD + "';\nvar P = '"
                                         + "https://script.google.com/macros/s/AKfyPORTALPROD/exec';\n"
                                         + "var DB = 'bfdc5ab532d3833983fc0130cffb8bac';\n", encoding="utf-8")

    def test_com_sim_a_pagina_fala_com_o_simulador_de_teste(self):
        with tempfile.TemporaryDirectory() as t:
            d = pathlib.Path(t); self.montar(d)
            r = rodar(d, "--exec", EXEC, "--venda", EXEC_VENDA, "--sim", self.SIM)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            txt = (d / "proposta.html").read_text(encoding="utf-8")
            self.assertIn(self.SIM, txt)
            self.assertIn(EXEC, txt)
            self.assertNotIn(self.PROD, txt)
            self.assertIn("3f1c5ab532d381d38ba0d495b1bc8123", txt)

    def test_sem_sim_continua_como_antes(self):
        with tempfile.TemporaryDirectory() as t:
            d = pathlib.Path(t); self.montar(d)
            r = rodar(d, "--exec", EXEC, "--venda", EXEC_VENDA)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            txt = (d / "proposta.html").read_text(encoding="utf-8")
            self.assertNotIn(self.PROD, txt)
            self.assertEqual(txt.count(EXEC), 2)

    def test_sim_invalido_e_recusado(self):
        with tempfile.TemporaryDirectory() as t:
            d = pathlib.Path(t); self.montar(d)
            r = rodar(d, "--exec", EXEC, "--venda", EXEC_VENDA, "--sim", "https://exemplo.test/x")
            self.assertNotEqual(r.returncode, 0)


class PaginasDoFork(unittest.TestCase):
    def test_pagina_teste_do_fork_nao_e_tocada(self):
        with tempfile.TemporaryDirectory() as t:
            d = pathlib.Path(t)
            (d / "teste-gerar-venda.html").write_text('var URL_PV = "' + EXEC_VENDA + '";', encoding="utf-8")
            r = rodar(d, "--exec", EXEC, "--venda", EXEC_VENDA)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertIn(EXEC_VENDA, (d / "teste-gerar-venda.html").read_text(encoding="utf-8"))


class SimuladorJaApontado(unittest.TestCase):
    SIM = "https://script.google.com/macros/s/AKfySIMTESTE789/exec"

    def test_segunda_rodada_mantem_o_simulador_de_teste(self):
        with tempfile.TemporaryDirectory() as t:
            d = pathlib.Path(t)
            (d / "proposta.html").write_text("var APPS_SCRIPT_URL = '" + self.SIM + "';", encoding="utf-8")
            r = rodar(d, "--exec", EXEC, "--venda", EXEC_VENDA, "--sim", self.SIM)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertIn(self.SIM, (d / "proposta.html").read_text(encoding="utf-8"))
