/* =====================================================================================================
 * obra-orcamento.js · PORTAL-MORAIS — 16/11/2026
 * PLANILHA PRÉVIA DO ORÇAMENTO da obra (aba "3D e Orçamento" da janela da obra, obras.html).
 *
 * De onde sai cada linha:
 *   1. o MODELO (orcamento/modelo-casa-rua.json): as etapas e os itens do orçamento de casa de rua (REF 127 do
 *      Mais Controle), cada item com a sua REGRA de quantidade:
 *        revit      soma das linhas do quantitativo do Revit com o mesmo nome (× multiplicador da disciplina
 *                   × fator, arredondado); sem a linha no Revit, vale a proporção do REF e a linha fica marcada
 *        casa / lote / fixo    f × nº de casas · f por lote · quantidade fixa
 *        cada       uma linha por casa (CASA 1, CASA 2…) — bancadas, mestre, encanador
 *        padrao     padrões de energia 5 m / 7 m — do formulário de obra
 *        area_real  área construída real (averbada + pós habite-se) — INSS e ISSQN
 *        area       soma das áreas de ambientes do Revit pelo nome (grama)
 *        soma       soma de outras linhas (argamassa = pisos + revestimentos; pintura de portas = portas)
 *      cidade: itens de Goiânia trocam para o equivalente de Senador Canedo (alt.CANEDO) quando a obra é de lá;
 *      cond: "arrimo" só entra com arrimo (formulário ou tabelas do arrimo no Revit); "fossa" em Senador Canedo
 *      sempre e em Goiânia quando não tem rede de esgoto.
 *   2. o QUANTITATIVO DO REVIT (modelo3d.json publicado pelo MORAIS → Geral → Publicar 3D);
 *   3. o CATÁLOGO DO MAIS CONTROLE (robô do servidor → Supabase → Apps Script orcCatalogo): nome, unidade e custo
 *      de cada código, e a busca para trocar ou acrescentar item.
 * Tudo é editável (quantidade, trocar o código, apagar, acrescentar). "Salvar" grava a prévia da obra no
 * Supabase (orcPreviaSalvar); "Baixar planilha" sai em CSV (abre no Excel).
 * ===================================================================================================== */
(function (g) {
  "use strict";
  const ST = {};            // estado por obra (id sem traço)
  let MODELO = null, CAT = null, CAT_MAP = null, CAT_ERRO = "", CAT_LIDO = null;
  const sT = v => String(v || "").replace(/-/g, "").toLowerCase();
  const NN = s => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
  const escH = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  /* chave de comparação de nomes Revit × MC: sem acento, sem "PVC", sem pontuação, "3,00m" = "3m", "6.3" = "6,3" */
  function chave(s) {
    let t = NN(s).replace(/[º°]/g, "");
    t = t.replace(/(\d+)[,.](\d+)/g, (m, a, b) => { b = b.replace(/0+$/, ""); return b ? a + "_" + b : a; });
    return t.replace(/\bPVC\b/g, "").replace(/\bLONGA\b/g, "").replace(/[^A-Z0-9_]/g, "");
  }
  const moeda = v => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const numBr = (v, d) => (Number(v) || 0).toLocaleString("pt-BR", { maximumFractionDigits: d == null ? 2 : d });
  function arred(q, modo) {
    q = Number(q) || 0;
    if (modo === "teto") return Math.ceil(q - 1e-9);
    if (modo === "meio") return Math.ceil(q * 2 - 1e-9) / 2;
    if (modo === "baixo") return Math.floor(q + 1e-9);
    return Math.round(q * 100) / 100;
  }

  /* ---------------- carregamentos ---------------- */
  async function carregarModelo() {
    if (MODELO) return MODELO;
    const r = await fetch("orcamento/modelo-casa-rua.json?v=1", { cache: "no-cache" });
    if (!r.ok) throw new Error("não carregou o modelo do orçamento (HTTP " + r.status + ")");
    MODELO = await r.json(); return MODELO;
  }
  async function carregarCatalogo(forcar) {
    if (CAT && !forcar) return CAT;
    if (!forcar) { try { const c = JSON.parse(sessionStorage.getItem("orc_catalogo_v2") || "null"); if (c && c.itens && Date.now() - c.ts < 30 * 60e3) { CAT = c.itens; CAT_LIDO = c.lido_em; indexar(); return CAT; } } catch (e) {} }
    let r; try { r = await g.chamar({ action: "orcCatalogo", forcar: !!forcar }, 60000, true); } catch (e) { r = { ok: false, erro: "sem conexão" }; }
    if (!r || !r.ok) { CAT_ERRO = (r && r.erro) || "erro"; return null; }
    CAT = r.itens || []; CAT_LIDO = r.lido_em || null; CAT_ERRO = ""; indexar();
    try { sessionStorage.setItem("orc_catalogo_v2", JSON.stringify({ ts: Date.now(), itens: CAT, lido_em: CAT_LIDO })); } catch (e) {}
    return CAT;
  }
  function indexar() {
    CAT_MAP = { cod: {}, chave: {} };
    (CAT || []).forEach(x => { CAT_MAP.cod[String(x[1])] = x; const k = chave(x[2]); if (!CAT_MAP.chave[k] || (!CAT_MAP.chave[k][7] && x[7])) CAT_MAP.chave[k] = x; });
  }
  const catDe = cod => CAT_MAP && CAT_MAP.cod[String(cod)];

  /* quantitativos do Revit: a lista de arquivos vem do Apps Script (ação modelo3d — já resolve o "mesmo layout");
     o modelo3d.json vem direto do link do Notion ou, se o navegador bloquear, em pedaços pelo Apps Script */
  async function carregarRevit(obraId) {
    const r = await g.chamar({ action: "modelo3d", pageId: obraId }, 60000, true);
    if (!r || !r.ok) return { erro: r && r.erro === "SEM_COLUNA_MODELO_3D" ? "sem 3D publicado" : ("não li o 3D: " + ((r && r.erro) || "erro")) };
    const a = (r.arquivos || []).find(x => /\.json$/i.test(x.nome));
    if (!a) return { erro: "o 3D desta obra não tem os quantitativos (publique de novo pelo Revit)" };
    let txt = null;
    try { const f = await fetch(a.url); if (f.ok) txt = await f.text(); } catch (e) {}
    if (!txt) {
      const partes = []; let ini = 0, total = 1;
      while (ini < total) {
        const p = await g.chamar({ action: "modelo3dParte", pageId: obraId, nome: a.nome, inicio: ini }, 120000, true);
        if (!p || !p.ok) return { erro: "não baixei os quantitativos: " + ((p && p.erro) || "erro") };
        partes.push(Uint8Array.from(atob(p.base64), c => c.charCodeAt(0))); total = p.total; ini += p.tamanho; if (!p.tamanho) break;
      }
      const tam = partes.reduce((s, u) => s + u.length, 0), u8 = new Uint8Array(tam); let k = 0; partes.forEach(u => { u8.set(u, k); k += u.length; });
      txt = new TextDecoder().decode(u8);
    }
    let j; try { j = JSON.parse(txt); } catch (e) { return { erro: "quantitativos ilegíveis" }; }
    return { linhas: lerTabelas(j), areas: lerAreas(j), em: j.atualizado_em || j.gerado_em || "", base: r.base || null, titulo: r.titulo || "" };
  }
  function tabelasDe(j) {
    const T = [];
    if (j && j.disciplinas && !Array.isArray(j.disciplinas)) Object.keys(j.disciplinas).forEach(d => (j.disciplinas[d].tabelas || []).forEach(t => T.push(Object.assign({ disc: d }, t))));
    (j && j.tabelas || []).forEach(t => T.push(Object.assign({ disc: t.disciplina || "" }, t)));
    return T;
  }
  function lerTabelas(j) {
    const out = [];
    tabelasDe(j).forEach(t => {
      if (t.tipo === "areas") return;
      const cols = (t.colunas || []).map(NN);
      const iTipo = cols.findIndex(c => c === "TIPO");
      const iDesc = cols.findIndex(c => /DESCRI|NOME PECA|^NOME$/.test(c));
      const iQ = cols.findIndex(c => /QUANTIDADE|CONTAGEM|COMPRIMENTO|AREA DA LAJE|^AREA/.test(c));
      const iUn = cols.findIndex(c => /^UNID/.test(c));
      const iDiam = cols.findIndex(c => /DIAMETRO/.test(c));
      if (iDesc < 0 || iQ < 0) return;
      let secao = "";
      (t.linhas || []).forEach(l => {
        const v = l.valores || [];
        const q = Number(v[iQ]);
        const desc = String(v[iDesc] == null ? "" : v[iDesc]).trim();
        if (!desc && typeof v[0] === "string" && v[0].trim() && !(q > 0)) { secao = v[0].trim(); return; }
        if (!desc || !(q > 0)) return;
        if (iTipo >= 0 && v[iTipo] && NN(v[iTipo]) !== "ITEM") return;
        const nome = desc + (iDiam >= 0 && v[iDiam] ? " " + v[iDiam] + " mm" : "");
        out.push({ disc: t.disc, tabela: t.nome || "", secao: secao, arrimo: /ARRIMO/.test(NN(secao)), nome: nome, k: chave(nome), q: q, un: iUn >= 0 ? String(v[iUn] || "") : "", raw: l });
      });
    });
    return out;
  }
  function lerAreas(j) {
    const out = [];
    tabelasDe(j).forEach(t => {
      if (t.tipo !== "areas" || !/AMBIENTE/.test(NN(t.nome))) return;
      const cols = (t.colunas || []).map(NN), iN = cols.findIndex(c => c === "NOME"), iA = cols.findIndex(c => /^AREA/.test(c));
      if (iN < 0 || iA < 0) return;
      (t.linhas || []).forEach(l => { const v = l.valores || []; out.push({ disc: t.disc, nome: String(v[iN] || ""), a: Number(v[iA]) || 0 }); });
    });
    return out;
  }

  /* ---------------- motor: modelo + obra + formulário + Revit -> linhas ---------------- */
  function gerar(o, ctx, revit) {
    const M = MODELO, nC = Number(o.n_casas) || 0, canedo = /CANEDO/.test(NN(o.cidade)), f = ctx.form || {};
    const mult = Object.assign({}, M.multiplicadores);
    Object.keys(mult).forEach(d => { if (mult[d] === "casas") mult[d] = nC || 1; });
    const temRevit = !!(revit && revit.linhas && revit.linhas.length);
    const discsRevit = {}; (revit && revit.linhas || []).forEach(r => { discsRevit[r.disc] = 1; });
    const arrimoRevit = (revit && revit.linhas || []).some(r => r.arrimo);
    const usados = new Set(), L = [], alertas = [];
    let seq = 0;
    const nova = (it, extra) => Object.assign({ id: "l" + (++seq), etapa: paiDe(it.idx), idx: it.idx, orig: it.idx, cod: it.cod, cat: it.cat, nome: it.nome, un: it.un, q: 0, origem: "", aviso: "",
      qref: it.q_ref ? Math.round(it.q_ref / (M.casas_ref || 2) * (nC || 1) * 100) / 100 : null }, extra);
    M.itens.forEach(it0 => {
      let it = it0;
      if (it.so_cidade === "CANEDO" && !canedo) return;
      if (it.cidade === "GOIANIA" && canedo && it.alt && it.alt.CANEDO) it = Object.assign({}, it, it.alt.CANEDO);
      const r = it.regra || {};
      if (r.cond === "arrimo" && !(f.arrimoSim === true || arrimoRevit)) return;
      if (r.cond === "fossa" && !canedo && f.semEsgoto === false) return;
      const ln = nova(it);
      if (r.variavel) ln.aviso = "item variável — conferir (Felipe)";
      if (r.conferir) ln.aviso = (ln.aviso ? ln.aviso + " · " : "") + r.conferir;
      if (r.cond === "fossa" && !canedo && !f.semEsgoto) ln.aviso = "conferir se tem rede de esgoto (formulário de obra, pergunta 10)";
      switch (r.t) {
        case "revit": {
          const ks = new Set([chave(it0.nome), chave(it.nome)].concat((r.revit || []).map(chave)));
          const rows = (revit && revit.linhas || []).filter(x => ks.has(x.k) && (!r.disc || x.disc === r.disc) && (!!r.secao === x.arrimo));
          if (rows.length) {
            rows.forEach(x => usados.add(x));
            const base = rows.reduce((s, x) => s + x.q, 0), m = mult[r.disc] || 1, fa = r.fator || 1;
            Object.assign(ln, { q: arred(base * m * fa, r.arred), revit: { base: base, disc: r.disc, fator: fa, arred: r.arred }, refs: refsDe(rows), unRevit: rows[0].un,
              origem: "Revit " + r.disc + ": " + numBr(base) + (m !== 1 ? " × " + m : "") + (fa !== 1 ? " × " + fa : "") });
          } else {
            const p = r.padrao || { t: "fixo", q: 0 };
            ln.q = qtdSimples(p, nC); ln.origem = "não veio do Revit — " + descr(p, nC);
            ln.semRevit = true;
            if (!ln.aviso && ln.q > 0 && (discsRevit[r.disc] || !temRevit)) ln.aviso = temRevit ? "não achei no quantitativo do Revit" : "";
          }
          break;
        }
        case "cada": {
          for (let c = 1; c <= Math.max(nC, 1); c++) L.push(Object.assign(nova(it), { nome: it.nome + " — CASA " + c, q: r.f || 1, origem: "1 linha por casa", aviso: ln.aviso }));
          return;
        }
        case "padrao": {
          const v = r.m === 7 ? f.p7 : f.p5;
          ln.q = Number(v) || 0; ln.origem = "formulário de obra — padrões de " + r.m + " m";
          if (v == null) ln.aviso = "formulário de obra sem a quantidade de padrões de " + r.m + " m";
          if (!ln.q && v != null) return;   // 0 padrões desse tamanho: a linha não entra
          break;
        }
        case "area_real": {
          const a = (Number(o.area_averbada) || 0) + (Number(o.area_habite) || 0);
          ln.q = Math.round(a * 100) / 100; ln.origem = "área construída real (averbada + pós habite-se)";
          if (!a) ln.aviso = "falta a área construída averbada da obra";
          break;
        }
        case "area": {
          const re = new RegExp(r.re, "i"), as = (revit && revit.areas || []).filter(x => re.test(NN(x.nome)));
          if (as.length) { const s = as.reduce((t, x) => t + x.a, 0); ln.q = arred(s, r.arred); ln.origem = "Revit: áreas " + r.re.toLowerCase() + " " + numBr(s) + " m²"; }
          else { ln.q = it.q_ref ? Math.round(it.q_ref / (M.casas_ref || 2) * nC * 100) / 100 : 0; ln.origem = "não veio do Revit — proporção do REF"; ln.semRevit = true; }
          break;
        }
        case "soma": ln.soma = r.de; ln.origem = "soma de " + r.de.join(" + "); break;
        default: ln.q = qtdSimples(r, nC); ln.origem = descr(r, nC);
      }
      L.push(ln);
    });
    /* somas depois de tudo */
    L.forEach(ln => { if (ln.soma) ln.q = Math.round(L.filter(x => ln.soma.indexOf(x.idx) >= 0).reduce((s, x) => s + (Number(x.q) || 0), 0) * 100) / 100; });
    /* o que veio do Revit e não está no modelo: entra no fim da etapa pelo índice da seção do Revit */
    (revit && revit.linhas || []).filter(x => !usados.has(x)).forEach(x => {
      const c = CAT_MAP && CAT_MAP.chave[x.k];
      const et = etapaDaSecao(x.secao);
      const m = mult[x.disc] || 1;
      L.push({ id: "l" + (++seq), etapa: et, idx: "", cod: c ? c[1] : "", cat: c ? c[0] : "", nome: c ? c[2] : x.nome, un: c ? c[3] : x.un,
        q: arred(x.q * m, /^M$|^M2|^M²/i.test(x.un) ? "teto" : "nenhum"), revit: { base: x.q, disc: x.disc, fator: 1, arred: "teto" }, refs: refsDe([x]), unRevit: x.un,
        origem: "Revit " + x.disc + " (" + x.tabela + "): " + numBr(x.q) + (m !== 1 ? " × " + m : ""), extra: true,
        aviso: c ? "veio do Revit e não está no modelo — conferir" : "veio do Revit e não achei no catálogo do MC: escolha o código" });
    });
    if (!temRevit) alertas.push(revit && revit.erro ? "Quantitativos do Revit: " + revit.erro + " — as linhas do Revit saíram pela proporção do REF." : "Sem quantitativos do Revit — as linhas do Revit saíram pela proporção do REF.");
    /* a soma passa a apontar para as LINHAS (o índice pode mudar na mão depois) */
    L.forEach(ln => { if (ln.soma) { ln.somaIds = L.filter(x => ln.soma.indexOf(x.orig) >= 0).map(x => x.id); delete ln.soma; } });
    renumerar(L, false);
    const R = revit && revit.linhas || [];
    const info = { temRevit: temRevit, arrimoRevit: arrimoRevit, discs: Object.keys(discsRevit),
      inexistentes: R.filter(x => /INEXISTENTE|VERIFICAR/.test(NN(x.nome))).map(x => x.disc + " · " + x.tabela + ": " + x.nome + " (" + numBr(x.q) + ")"),
      hidCaixa: R.filter(x => x.disc === "HID" && /CAIXA D.?AGUA/.test(NN(x.nome))).reduce((t, x) => t + x.q, 0),
      p5: f.p5 == null ? null : f.p5, p7: f.p7 == null ? null : f.p7, arrimoForm: f.arrimoSim == null ? null : f.arrimoSim, nC: nC };
    return { linhas: L, mult: mult, alertas: alertas, info: info };
  }
  /* ---------------- índices (17/11: editáveis e reorganizáveis) ----------------
     Índice "8.10" = etapa 8, item 10. Mudar o índice de uma linha leva ela para a etapa e a posição do novo índice;
     "Renumerar" deixa os itens de cada etapa em sequência (1, 2, 3…) na ordem em que estão. */
  function cmpIdx(a, b) {
    const A = String(a || "").split("."), B = String(b || "").split(".");
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
      if (A[i] == null) return -1; if (B[i] == null) return 1;
      const x = parseFloat(A[i]), y = parseFloat(B[i]);
      if (isNaN(x) || isNaN(y)) { const c = String(A[i]).localeCompare(String(B[i]), "pt-BR", { numeric: true }); if (c) return c; }
      else if (x !== y) return x - y;
    }
    return 0;
  }
  const chaveOrdem = l => l.idx || ((l.etapa && l.etapa !== "_revit" ? l.etapa : "9999") + ".9999");
  function ordenar(L) { const pos = new Map(L.map((l, i) => [l, i])); L.sort((a, b) => cmpIdx(chaveOrdem(a), chaveOrdem(b)) || pos.get(a) - pos.get(b)); return L; }
  /* todos=false: só as etapas com índice repetido ou linha sem índice; todos=true (ou raiz informada): numera tudo */
  function renumerar(L, todos, raiz) {
    const porPai = {}, ordem = [];
    L.forEach(l => { const p = l.idx ? paiDe(l.idx) : (l.etapa || "_revit"); if (!porPai[p]) { porPai[p] = []; ordem.push(p); } porPai[p].push(l); });
    ordem.forEach(p => {
      if (p === "_revit" || !p) return;
      if (raiz != null && String(p).split(".")[0] !== String(raiz)) return;
      const ls = porPai[p], vistos = new Set();
      let precisa = !!todos || raiz != null;
      ls.forEach(l => { if (!l.idx) precisa = true; else { const a = vistos.size; vistos.add(l.idx); if (vistos.size === a) precisa = true; } });
      if (!precisa) return;
      ls.forEach((l, i) => { l.idx = p + "." + (i + 1); l.etapa = p; });
    });
  }

  /* ---------------- CONFERÊNCIA DOS QUANTITATIVOS (17/11, pedido do dono) ----------------
     Procura o que parece erro antes de o orçamento ir para o MC — não muda nada, só aponta. */
  const unN = u => { const t = NN(u).replace(/[²2]/g, "2").replace(/\s/g, ""); if (/^M2$/.test(t)) return "M2"; if (/^(M|ML)$/.test(t)) return "M"; if (/^(UN|UND|PC|PECA|UNID)$/.test(t)) return "UN"; return t; };
  function conferir(s, o) {
    const C = [], add = (nivel, txt, id) => C.push({ nivel: nivel, txt: txt, id: id || null });
    const I = s.info || {}, nC = s.nCasas || Number(o && o.n_casas) || 1, L = s.linhas;
    L.forEach(l => {
      const nm = (l.idx ? l.idx + " · " : "") + l.nome;
      if (l.revit && l.qref && l.q) { const r = l.q / l.qref; if (r > 2 || r < 0.5) add("alto", `${nm}: ${numBr(l.q)} ${l.un} — o REF (proporcional a ${nC} casas) daria ~${numBr(l.qref)} (${r > 1 ? "+" : ""}${Math.round((r - 1) * 100)}%)`, l.id); }
      if (l.revit && l.unRevit && l.un && unN(l.unRevit) !== unN(l.un)) add("medio", `${nm}: o Revit mede em ${l.unRevit} e o item do MC é em ${l.un}`, l.id);
      if (!l.cod) add("medio", `${nm}: sem código do MC`, l.id);
      else if (l.semCat) add("medio", `${nm}: o código ${l.cod} não está no catálogo do MC (Própria/Condomínio)`, l.id);
      else if (l.inativo) add("medio", `${nm}: o código ${l.cod} está INATIVO no MC`, l.id);
      else if (CAT_MAP && !l.custo && l.q) add("baixo", `${nm}: custo zero no catálogo do MC`, l.id);
      if (!l.idx) add("baixo", `${l.nome}: sem índice — escolha a etapa`, l.id);
    });
    const porCod = {}; L.forEach(l => { if (l.cod && l.nome.indexOf(" — CASA ") < 0) (porCod[l.cod] = porCod[l.cod] || []).push(l); });
    Object.keys(porCod).forEach(c => { if (porCod[c].length > 1) add("medio", `O código ${c} aparece ${porCod[c].length} vezes (${porCod[c].map(l => l.idx).join(", ")}) — conferir se não está em dobro`, porCod[c][0].id); });
    (I.inexistentes || []).forEach(x => add("alto", `Revit com item a verificar: ${x}`));
    const aReal = (Number(o && o.area_averbada) || 0) + (Number(o && o.area_habite) || 0);
    const soma = origs => L.filter(l => origs.indexOf(l.orig) >= 0).reduce((t, l) => t + (Number(l.q) || 0), 0);
    if (aReal) {
      const piso = soma(["8.1", "8.2"]); if (piso) { const r = piso / aReal; if (r < 0.7 || r > 1.3) add("alto", `Pisos (8.1 + 8.2) = ${numBr(piso)} m² para ${numBr(aReal)} m² de área construída real (${Math.round(r * 100)}%) — conferir`); }
      const laje = soma(["4.9", "4.10"]); if (laje) { const r = laje / aReal; if (r < 0.6 || r > 1.4) add("medio", `Lajes (4.9 + 4.10) = ${numBr(laje)} m² para ${numBr(aReal)} m² de área construída (${Math.round(r * 100)}%)`); }
    }
    if (I.p5 != null || I.p7 != null) { const t = (Number(I.p5) || 0) + (Number(I.p7) || 0); if (t !== nC) add("alto", `Padrões de energia: ${I.p5 || 0} de 5 m + ${I.p7 || 0} de 7 m = ${t}, mas a obra tem ${nC} casas (formulário de obra)`); }
    const mH = Number((s.mult || {}).HID) || 1;
    if (I.hidCaixa && nC > 1) {
      if (I.hidCaixa >= nC && mH > 1) add("alto", `O HID do Revit já tem ${I.hidCaixa} caixas d'água (parece ter as ${nC} casas) e o multiplicador está × ${mH} — ficaria em dobro`);
      if (I.hidCaixa === 1 && mH === 1) add("alto", `O HID do Revit tem 1 caixa d'água (1 casa) e o multiplicador está × 1 — as outras ${nC - 1} casas ficam de fora`);
    }
    if (I.arrimoForm === false && I.arrimoRevit) add("alto", "O formulário diz que NÃO tem arrimo, mas o Revit tem tabelas do arrimo");
    if (I.arrimoForm === true && I.temRevit && !I.arrimoRevit) add("alto", "O formulário diz que tem arrimo, mas o Revit não tem as tabelas do arrimo — as linhas do arrimo ficaram sem quantidade");
    const ord = { alto: 0, medio: 1, baixo: 2 };
    return C.sort((a, b) => ord[a.nivel] - ord[b.nivel]);
  }

  /* de onde veio cada linha do Revit: disciplina, tabela, nome (chave) e se é do arrimo — o visualizador 3D usa para marcar */
  function refsDe(rows) { const v = {}; rows.forEach(x => { v[x.disc + "|" + x.tabela + "|" + x.k + "|" + (x.arrimo ? 1 : 0)] = 1; }); return Object.keys(v); }
  function qtdSimples(r, nC) {
    if (r.t === "casa") return Math.round((r.f || 0) * nC * 100) / 100;
    if (r.t === "lote") return r.f || 0;
    if (r.t === "fixo") return r.q || 0;
    return 0;
  }
  function descr(r, nC) {
    if (r.t === "casa") return numBr(r.f) + " por casa × " + nC;
    if (r.t === "lote") return numBr(r.f) + " por lote";
    if (r.t === "fixo") return "quantidade fixa";
    return "";
  }
  function paiDe(idx) { const p = String(idx || "").split("."); p.pop(); return p.join(".") || String(idx || ""); }
  function etapaDaSecao(secao) {
    const m = String(secao || "").match(/^(\d+(?:\.\d+)*)\s+(.*)$/);
    if (m) { const e = MODELO.etapas.find(x => x.idx === m[1]) || MODELO.etapas.find(x => NN(x.nome) === NN(m[2])); if (e) return e.idx; }
    if (/ARRIMO/.test(NN(secao))) { const e = MODELO.etapas.find(x => /ARRIMO/.test(NN(x.nome))); if (e) return e.idx; }
    return "_revit";
  }

  /* ---------------- contratos de empreiteiros (medição no MC) ----------------
     Os 4 contratos de casa de rua analisados no MC (11/11/2026). Cada contrato tem uma etapa por casa (CASA 1, CASA 2…),
     como no MC, e se liga à etapa do orçamento (vínculo por ETAPA). Os preços são o padrão de hoje e ficam editáveis aqui
     (vão salvos junto com a prévia da obra). */
  const CONTRATOS = [
    { id: "412", nome: "Cerâmica — assentamento de pisos e revestimentos", modelo: "412 - CERÂMICA", etapa: "8", tipo: "m2",
      precos: { comum: 19.5, retificado: 31.67 }, itens: [["8.1", "Piso da casa", "comum"], ["8.2", "Piso banheiro, área de serviço e garagem", "comum"],
        ["8.3", "Revestimento branco padrão", "comum"], ["8.4", "Revestimento detalhe da cozinha (retificado)", "retificado"],
        ["8.5", "Revestimento da ducha", "comum"], ["8.7", "Revestimento do box do banheiro (retificado)", "retificado"]] },
    { id: "411", nome: "Elétrica — instalações elétricas por casa", modelo: "411 - ELÉTRICA", etapa: "12", tipo: "vb", preco: 1900, item: "Instalações elétricas — empreitada" },
    { id: "406", nome: "Pintura — mão de obra por casa", modelo: "406 - PINTURA", etapa: "11", tipo: "vb", preco: 3450, item: "Pintura — empreitada" },
    { id: "372", nome: "Mestre de obras (com hidráulica)", modelo: "372 - MESTRE DE OBRAS", etapa: "16", tipo: "vb", preco: 31500, item: "Empreitada do mestre — tabela 2026-2 3Q" }
  ];
  function gerarContratos(s) {
    const nC = Math.max(Number(s.nCasas) || 1, 1), out = [];
    CONTRATOS.forEach(c => {
      const k = { id: c.id, nome: c.nome, modelo: c.modelo, etapa: c.etapa, linhas: [] };
      for (let n = 1; n <= nC; n++) {
        if (c.tipo === "vb") k.linhas.push({ casa: n, item: c.item, un: "VB", q: 1, preco: c.preco });
        else c.itens.forEach(([idx, nome, tp]) => {
          const l = s.linhas.find(x => (x.orig || x.idx) === idx); if (!l || !/m/i.test(l.un || "")) return;
          const q = Math.round((Number(l.q) || 0) / nC * 100) / 100; if (!q) return;
          k.linhas.push({ casa: n, item: nome, un: "m²", q: q, preco: c.precos[tp], tipo: tp, de: l.idx || idx });
        });
      }
      out.push(k);
    });
    return out;
  }
  const totalContrato = k => k.linhas.reduce((t, l) => t + (Number(l.q) || 0) * (Number(l.preco) || 0), 0);
  function contratoHtml(s, ki) {
    const k = s.contratos[ki]; if (!k) return "";
    const tot = totalContrato(k), casas = [...new Set(k.linhas.map(l => l.casa))];
    const ligadas = s.linhas.filter(l => String(l.etapa || l.idx || "").split(".")[0] === String(k.etapa));
    const orcado = ligadas.reduce((t, l) => t + (l.q || 0) * (l.custo || 0), 0);
    let h = `<div class="ct-cab"><div class="ct-h"><span class="ct-n">${escH(k.id)}</span><div class="ct-t"><b>${escH(k.nome)}</b>
        <span>modelo do MC: ${escH(k.modelo)} · uma etapa por casa · vínculo com a etapa ${escH(nomeEtapa(s, k.etapa))} do orçamento</span></div>
        <div class="ct-tt"><b>${moeda(tot)}</b><span>total do contrato</span></div></div>
      <div class="ct-cmp"><span>Etapa ${escH(k.etapa)} no orçamento (material + mão de obra): <b>${moeda(orcado)}</b> em ${ligadas.length} linhas</span>
        <span class="sp"></span><button class="bt ghost" onclick="OrcObra.refazerContratos('${escH(k.id)}')" title="Monta este contrato de novo pela planilha atual e pelo preço padrão">↻ Refazer pelos números do orçamento</button></div></div>
      <div class="ct"><table class="ct-tb"><colgroup><col><col style="width:44px"><col style="width:92px"><col style="width:100px"><col style="width:120px"></colgroup>
        <thead><tr><th>Item</th><th>Un</th><th class="n">Qtd</th><th class="n">Preço un.</th><th class="n">Total</th></tr></thead><tbody>${casas.map(c => {
          const ls = k.linhas.map((l, i) => [l, i]).filter(([l]) => l.casa === c), sub = ls.reduce((t, [l]) => t + (l.q || 0) * (l.preco || 0), 0);
          return `<tr class="cs"><td colspan="4"><b>CASA ${c}</b> <small class="mu">etapa ${c} do contrato</small></td><td class="n"><b>${moeda(sub)}</b></td></tr>` + ls.map(([l, i]) => `<tr><td>${escH(l.item)}${l.de ? `<small class="mu"> · linha ${escH(l.de)} do orçamento</small>` : ""}</td><td class="mu">${escH(l.un)}</td>
            <td class="n"><input type="number" step="any" min="0" value="${escH(l.q)}" onchange="OrcObra.ctEditar(${ki},${i},'q',this.value)"></td>
            <td class="n"><input type="number" step="any" min="0" value="${escH(l.preco)}" onchange="OrcObra.ctEditar(${ki},${i},'preco',this.value)"></td>
            <td class="n">${moeda((l.q || 0) * (l.preco || 0))}</td></tr>`).join("");
        }).join("") || `<tr><td colspan="5" class="mu">Sem linhas — a planilha não tem os itens desta etapa.</td></tr>`}</tbody>
        <tfoot><tr><td colspan="4"><b>TOTAL DO CONTRATO</b></td><td class="n"><b>${moeda(tot)}</b></td></tr></tfoot></table></div>
      <div class="ajuda" style="margin-top:8px">${k.id === "412" ? "Cerâmica: m² de cada piso/revestimento da planilha dividido pelas casas; R$ 19,50 o comum e R$ 31,67 o retificado (padrão — editável)." : "Valor por casa (VB), editável."} Vai salvo junto com a planilha da obra.</div>`;
    return h;
  }
  function nomeEtapa(s, idx) { const n = (s.nomesEtapa || {})[idx]; if (n) return idx + " · " + n; const e = MODELO && MODELO.etapas.find(x => x.idx === idx); return e ? e.idx + " · " + e.nome : idx; }

  /* ---------------- estado / ações ---------------- */
  function precificar(s) {
    s.linhas.forEach(ln => {
      const c = ln.cod && catDe(ln.cod);
      ln.custo = c ? Number(c[4]) || 0 : (ln.custo || 0);
      ln.semCat = !!ln.cod && !!CAT_MAP && !c;
      ln.inativo = !!c && !c[7];
      if (c) { if (!ln.nomeFixo) ln.nome = ln.nome.indexOf(" — CASA ") > 0 ? c[2] + ln.nome.slice(ln.nome.indexOf(" — CASA ")) : c[2]; ln.un = c[3] || ln.un; ln.cat = c[0]; }
    });
  }
  function total(s) { return s.linhas.reduce((t, l) => t + (Number(l.q) || 0) * (Number(l.custo) || 0), 0); }
  function avisos(s) { return s.linhas.filter(l => l.aviso || l.semCat || l.inativo || (!l.cod)); }

  async function abrir(o, ctx, opts) {
    const id = sT(o.id); opts = opts || {};
    let s = ST[id];
    if (s && !opts.regerar) return s;
    s = ST[id] = ST[id] || { id: id, obraId: o.id, linhas: [], carregando: true, msg: "", aberto: {}, filtro: "", soAvisos: false };
    s.carregando = true; s.msg = "Carregando o modelo e o catálogo…"; g.OrcObra.repintar();
    try { await carregarModelo(); } catch (e) { s.carregando = false; s.erro = String(e.message || e); g.OrcObra.repintar(); return s; }
    await carregarCatalogo();
    if (!opts.regerar) {
      let p = null; try { p = await g.chamar({ action: "orcPreviaLer", obra_id: o.id }, 30000, true); } catch (e) {}
      s.podeSalvar = !p || p.podeSalvar !== false;
      s.envio = (p && p.previa && p.previa.envio) || null; s.desbloqueio = (p && p.desbloqueio) || "";
      if (p && p.ok && p.previa && p.previa.dados && Array.isArray(p.previa.dados.linhas)) {
        const d = p.previa.dados;
        Object.assign(s, { linhas: d.linhas, mult: d.mult || {}, alertas: d.alertas || [], contratos: d.contratos || null, info: d.info || null, nomesEtapa: d.nomes_etapa || {}, nCasas: d.n_casas || Number(o.n_casas) || 1, versao: p.previa.versao, salvoPor: p.previa.salvo_por,
          salvoEm: p.previa.salvo_em, revitEm: d.revit_em || "", sujo: false, carregando: false, msg: "", origemTxt: "salva" });
        precificar(s); g.OrcObra.repintar(); return s;
      }
      if (p && p.aviso) s.aviso = p.aviso;
    }
    s.msg = "Lendo os quantitativos do Revit…"; g.OrcObra.repintar();
    let rv; try { rv = await carregarRevit(o.id); } catch (e) { rv = { erro: String(e.message || e) }; }
    const gx = gerar(o, ctx, rv && !rv.erro ? rv : { erro: rv && rv.erro });
    Object.assign(s, { linhas: gx.linhas, mult: gx.mult, alertas: gx.alertas, info: gx.info, nomesEtapa: {}, revitEm: rv && rv.em || "", sujo: true, carregando: false, msg: "", origemTxt: "gerada", nCasas: Number(o.n_casas) || 1 });
    s.contratos = gerarContratos(s);
    precificar(s); g.OrcObra.repintar(); return s;
  }
  async function salvar(o) {
    const s = ST[sT(o.id)]; if (!s) return;
    s.salvando = true; g.OrcObra.repintar();
    const dados = { modelo: MODELO && MODELO.versao, linhas: s.linhas.map(l => { const c = Object.assign({}, l); delete c.semCat; delete c.inativo; return c; }),
      mult: s.mult, alertas: s.alertas, revit_em: s.revitEm || "", total: total(s), gerado_em: new Date().toISOString(),
      n_casas: s.nCasas || null, contratos: s.contratos || null, info: s.info || null, nomes_etapa: s.nomesEtapa || {} };
    let r; try { r = await g.chamar({ action: "orcPreviaSalvar", obra_id: o.id, obra: o.titulo || "", versao: s.versao == null ? null : s.versao, dados: dados }, 60000); } catch (e) { r = { ok: false, erro: "sem conexão" }; }
    s.salvando = false;
    if (r && r.ok) { Object.assign(s, { versao: r.versao, salvoPor: r.salvo_por, salvoEm: r.salvo_em, sujo: false }); g.toast && g.toast("Orçamento salvo ✓"); }
    else if (r && r.erro === "OUTRA_VERSAO") g.toast && g.toast("Não salvou: " + (r.salvo_por || "alguém") + " salvou outra versão antes. Abra de novo para ver.");
    else g.toast && g.toast("Não salvou: " + ((r && r.erro) || "erro"));
    g.OrcObra.repintar();
  }
  function baixar(o) {
    const s = ST[sT(o.id)]; if (!s) return;
    const lin = [["Etapa", "Índice", "Código", "Tipo", "Descrição", "Unidade", "Quantidade", "Custo unitário", "Total", "Origem", "Aviso"]];
    grupos(s, true).forEach(gp => gp.linhas.forEach(l => lin.push([gp.nome, l.idx, l.cod, l.cat === "C" ? "Composição" : l.cat === "I" ? "Insumo" : "", l.nome, l.un,
      String(l.q).replace(".", ","), String(l.custo || 0).replace(".", ","), String(Math.round((l.q || 0) * (l.custo || 0) * 100) / 100).replace(".", ","), l.origem, l.aviso || ""])));
    const csv = "﻿" + lin.map(r => r.map(c => { c = String(c == null ? "" : c); return /[;"\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(";")).join("\r\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "Orcamento previo - " + (o.titulo || "obra") + ".csv"; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------------- tela ---------------- */
  function grupos(s, todos) {
    const et = MODELO ? MODELO.etapas : [];
    const raiz = idx => String(idx || "").split(".")[0];
    const nomeEt = idx => { const n = (s.nomesEtapa || {})[idx]; if (n) return n; const e = et.find(x => x.idx === idx); return e ? e.nome : (idx === "_revit" ? "Do Revit, sem lugar no modelo" : "Etapa nova — clique ✎ para dar nome"); };
    const G = {}, ordem = [];
    s.linhas.forEach(l => {
      if (!todos) {
        if (s.soAvisos && !(l.aviso || l.semCat || l.inativo || !l.cod)) return;
        if (s.filtro) { const f = NN(s.filtro); if (NN(l.nome).indexOf(f) < 0 && NN(l.cod).indexOf(f) < 0) return; }
      }
      const k = l.etapa === "_revit" ? "_revit" : raiz(l.etapa || l.idx);
      if (!G[k]) { G[k] = { k: k, nome: nomeEt(k), linhas: [] }; ordem.push(k); }
      G[k].linhas.push(l);
    });
    const num = k => k === "_revit" ? 9999 : Number(k) || 9998;
    return ordem.sort((a, b) => num(a) - num(b)).map(k => G[k]);
  }
  /* ---------------- 17/11: Enviar ao Mais Controle ----------------
     O envio TRAVA: depois de enviado, o botão some e só a senha da Paula (pedida aqui, conferida no Apps Script
     contra o login dela) destrava para enviar de novo. O robô do servidor escreve o andamento em s.envio. */
  const SIT_ENVIO = { "NA FILA": ["⏳", "na fila do robô do servidor — ele olha a cada 2 min; com o MC ocupado por outro robô pode levar uns 15 min"],
    "TRABALHANDO": ["⚙", "o robô está trabalhando"], "PRÉVIA PRONTA": ["👀", "prévia pronta — o robô leu o Mais Controle e guardou uma cópia; ainda não gravou nada"],
    "FEITO": ["✓", "lançado no Mais Controle"], "ERRO": ["⚠", "o robô não conseguiu"] };
  /* 17/11 (mo17): um envio por ITEM — "orcamento" e "ct:<id>" de cada contrato —, cada um com a sua trava (só a senha
     da Paula destrava), a sua situação e o seu resultado. O formato antigo (um envio só) vira o item do orçamento. */
  function normEnvio(e) {
    e = e || {};
    if (e.itens) return e;
    const it = {}; Object.keys(e).forEach(k => { if (k !== "historico") it[k] = e[k]; });
    return { itens: e.pedido_em ? { orcamento: it } : {}, historico: e.historico || [] };
  }
  const itemEnvio = (s, item) => (normEnvio(s.envio).itens || {})[item] || null;
  const travado = (s, item) => !!(itemEnvio(s, item) || {}).travado;
  function rotuloItem(s, item) {
    if (item === "orcamento") return "o orçamento da obra";
    const k = (s.contratos || []).find(x => "ct:" + x.id === item);
    return k ? "o contrato " + k.id + " · " + k.nome.split(" — ")[0] : "o contrato " + item.slice(3);
  }
  function envioBloco(s, item) {
    const e = itemEnvio(s, item), rot = rotuloItem(s, item), q = "'" + item + "'";
    const nomeP = (s.desbloqueio || "Paula").split(" ")[0];
    if (e && e.travado) {
      const sit = SIT_ENVIO[e.situacao] || ["•", String(e.situacao || "").toLowerCase()], rb = e.robo || {};
      const mudou = s.versao && e.versao && Number(s.versao) !== Number(e.versao);
      return `<div class="orc-envio ${e.situacao === "ERRO" ? "erro" : e.situacao === "FEITO" ? "ok" : ""}">
        <div class="oe-t">🔒 <b>${escH(rot.charAt(0).toUpperCase() + rot.slice(1))} foi enviado ao Mais Controle</b> em ${escH(new Date(e.pedido_em).toLocaleString("pt-BR"))} por <b>${escH(e.pedido_por || "")}</b> · versão ${escH(e.versao)} · ${escH(moeda(e.total || 0))}
          <span class="oe-sit">${sit[0]} ${escH(sit[1])}</span></div>
        ${rb.msg ? `<div class="oe-m">${escH(rb.msg)}</div>` : ""}
        ${rb.copia ? `<div class="oe-m">Cópia de segurança do que estava no MC: <b>${escH(rb.copia)}</b></div>` : ""}
        ${mudou ? `<div class="oe-m rd">A planilha mudou depois do envio (agora versão ${escH(s.versao)}). O Mais Controle recebe a versão ${escH(e.versao)}; para mandar a nova é preciso desbloquear.</div>` : ""}
        <div class="oe-b"><button class="bt ghost" onclick="OrcObra.envioAtualizar()">↻ Atualizar situação</button>
          <button class="bt ghost" onclick="OrcObra.desbloquear(${q})">🔓 Desbloquear (senha da ${escH(nomeP)})</button></div>
      </div>`;
    }
    const pode = s.podeSalvar !== false && s.salvoEm && !s.sujo && !s.salvando;
    const tit = s.podeSalvar === false ? "Sem permissão para enviar" : !s.salvoEm ? "Salve a planilha antes de enviar" : s.sujo ? "Há alterações não salvas — salve antes de enviar" : "Envia esta versão salva ao Mais Controle";
    const ult = e && (normEnvio(s.envio).historico || []).filter(x => x.acao === "desbloqueio" && x.item === item).slice(-1)[0];
    return `<div class="orc-envio pronto"><span>📤 Enviar <b>${escH(rot)}</b> ao Mais Controle${e ? ` <small class="mu">· desbloqueado${ult ? " por " + escH(ult.por || "") + " com a senha de " + escH(ult.autorizou || "") : ""}; último envio em ${escH(new Date(e.pedido_em).toLocaleString("pt-BR"))} (versão ${escH(e.versao)})</small>` : ""}${!pode ? ` <small class="mu">· ${escH(tit)}</small>` : ""}</span>
      <button class="bt envmc" ${pode ? "" : "disabled"} title="${escH(tit)}" onclick="OrcObra.enviarMC(${q})">📤 Enviar ${item === "orcamento" ? "orçamento" : "contrato " + escH(item.slice(3))}</button></div>`;
  }
  function janela(htmlInt) {
    fecharJanela();
    const d = document.createElement("div"); d.className = "orc-mod"; d.id = "orc-mod";
    d.innerHTML = `<div class="om-c" role="dialog" aria-modal="true">${htmlInt}</div>`;
    d.addEventListener("mousedown", ev => { if (ev.target === d) fecharJanela(); });
    document.body.appendChild(d);
    return d;
  }
  function fecharJanela() { const d = document.getElementById("orc-mod"); if (d) d.remove(); }
  function confirmarEnvio(o, item) {
    const s = ST[sT(o.id)]; if (!s) return;
    let corpo;
    if (item === "orcamento") {
      const CF = conferir(s, o), nAlto = CF.filter(x => x.nivel === "alto").length;
      corpo = `<div class="om-l"><span>Total previsto</span><b>${moeda(total(s))} · ${s.linhas.length} linhas</b></div>
        ${nAlto ? `<div class="om-av">⚠ A conferência apontou <b>${nAlto} possíveis erros</b>. Confira antes de enviar.</div>` : ""}
        <p>O robô do servidor acha o orçamento desta obra no Mais Controle, <b>guarda uma cópia do que está lá</b> e coloca no lugar o desta planilha (com as etapas e os índices daqui). Se a obra ainda não tiver orçamento, ele cria. Os contratos vão cada um pela guia dele.</p>`;
    } else {
      const k = (s.contratos || []).find(x => "ct:" + x.id === item); if (!k) return;
      const casas = new Set(k.linhas.map(l => l.casa)).size;
      corpo = `<div class="om-l"><span>Contrato</span><b>${escH(k.id)} · ${escH(k.nome)}</b></div>
        <div class="om-l"><span>Modelo no MC</span><b>${escH(k.modelo || "")}</b></div>
        <div class="om-l"><span>Total</span><b>${moeda(totalContrato(k))} · ${casas} casa(s) · ${k.linhas.length} linhas</b></div>
        <p>O robô do servidor procura este contrato da obra no Mais Controle; se já existir, <b>guarda uma cópia</b> e acerta pelo desta guia; se não existir, cria pelo modelo ${escH(k.modelo || "")}, uma etapa por casa ligada à etapa ${escH(k.etapa)} do orçamento.</p>`;
    }
    janela(`<h3>📤 Enviar ${escH(rotuloItem(s, item))} ao Mais Controle</h3>
      <div class="om-l"><span>Obra</span><b>${escH(o.titulo || "")}</b></div>
      <div class="om-l"><span>Versão salva</span><b>${escH(s.versao)} — ${escH(s.salvoPor || "")}, ${escH(new Date(s.salvoEm).toLocaleString("pt-BR"))}</b></div>
      ${corpo}
      <p class="om-tr">🔒 Depois de enviar, o envio ${item === "orcamento" ? "do orçamento" : "deste contrato"} fica <b>travado</b>: só a senha da ${escH(s.desbloqueio || "Paula")} desbloqueia para enviar de novo. Os outros itens continuam livres.</p>
      <div class="om-b"><button class="bt ghost" onclick="OrcObra.fecharJanela()">Cancelar</button><button class="bt envmc" id="om-ok" onclick="OrcObra.enviarConfirmado('${item}')">📤 Enviar</button></div>`);
  }
  const ERR_ENVIO = { SALVE_ANTES: "Salve a planilha antes de enviar (a versão salva mudou).", JA_ENVIADO: "Esta obra já foi enviada — o envio está travado.", NAO_SALVO: "Salve a planilha antes de enviar.",
    FALTA_COLUNA_ENVIO: "Falta preparar o Supabase para o envio (coluna envio da orc_previas).", SEM_PERMISSAO: "Sem permissão para enviar.",
    SENHA_INCORRETA: "Senha incorreta.", BLOQUEADO: "Muitas tentativas erradas — espere alguns minutos e tente de novo.", INFORME_A_SENHA: "Digite a senha.",
    SEM_LOGIN_PAULA: "Não achei o login da Paula no portal (LOGINS).", MAIS_DE_UMA_PAULA: "Há mais de um login com Paula — falta dizer qual (Propriedade ORC_DESBLOQUEIO_LOGIN).", NAO_ENVIADO: "Este item não tem envio para desbloquear.", ITEM_INVALIDO: "Item inválido.", CONTRATO_NAO_SALVO: "Este contrato não está na versão salva — salve a planilha antes." };
  async function enviarConfirmado(o, item) {
    const s = ST[sT(o.id)]; if (!s) return;
    const b = document.getElementById("om-ok"); if (b) { b.disabled = true; b.textContent = "Enviando…"; }
    let r; try { r = await g.chamar({ action: "orcEnviarMC", obra_id: o.id, versao: s.versao, item: item }, 60000); } catch (e) { r = { ok: false, erro: "sem conexão" }; }
    if (r && (r.ok || r.erro === "JA_ENVIADO") && r.envio) s.envio = r.envio;
    fecharJanela();
    g.toast && g.toast(r && r.ok ? "Enviado para a fila do robô ✓ — o envio ficou travado" : "Não enviou: " + (ERR_ENVIO[r && r.erro] || (r && r.erro) || "erro"));
    g.OrcObra.repintar();
  }
  function pedirDesbloqueio(o, item) {
    const s = ST[sT(o.id)]; if (!s) return;
    const nome = s.desbloqueio || "Paula";
    janela(`<h3>🔓 Desbloquear o envio ${escH(rotuloItem(s, item).replace(/^o /, "do "))}</h3>
      <p>Só a <b>${escH(nome)}</b> desbloqueia. Peça para ela digitar a senha dela do portal.</p>
      <input type="password" id="om-senha" autocomplete="off" placeholder="Senha da ${escH(nome.split(" ")[0])}" onkeydown="if(event.key==='Enter')OrcObra.desbloquearConfirmado('${item}')">
      <div class="om-er" id="om-er"></div>
      <div class="om-b"><button class="bt ghost" onclick="OrcObra.fecharJanela()">Cancelar</button><button class="bt" id="om-ok" onclick="OrcObra.desbloquearConfirmado('${item}')">Desbloquear</button></div>`);
    setTimeout(() => { const i = document.getElementById("om-senha"); if (i) i.focus(); }, 30);
  }
  async function desbloquearConfirmado(o, item) {
    const s = ST[sT(o.id)]; if (!s) return;
    const i = document.getElementById("om-senha"), er = document.getElementById("om-er"), b = document.getElementById("om-ok");
    const senha = i ? i.value : ""; if (!senha) { if (er) er.textContent = "Digite a senha."; return; }
    if (b) { b.disabled = true; b.textContent = "Conferindo…"; }
    let r; try { r = await g.chamar({ action: "orcEnvioDesbloquear", obra_id: o.id, senha: senha, item: item }, 60000); } catch (e) { r = { ok: false, erro: "sem conexão" }; }
    if (i) i.value = "";
    if (r && r.ok) { s.envio = r.envio; fecharJanela(); g.toast && g.toast("Envio desbloqueado ✓"); g.OrcObra.repintar(); return; }
    if (b) { b.disabled = false; b.textContent = "Desbloquear"; }
    if (er) er.textContent = (ERR_ENVIO[r && r.erro] || (r && r.erro) || "erro") + (r && r.restantes != null ? " Restam " + r.restantes + " tentativa(s)." : "") + (r && r.nomes && r.nomes.length ? " (" + r.nomes.join(", ") + ")" : "");
  }
  async function envioAtualizar(o) {
    const s = ST[sT(o.id)]; if (!s) return;
    let p = null; try { p = await g.chamar({ action: "orcPreviaLer", obra_id: o.id }, 30000, true); } catch (e) {}
    if (p && p.ok && p.previa) { s.envio = p.previa.envio || null; if (p.desbloqueio) s.desbloqueio = p.desbloqueio; g.OrcObra.repintar(); }
    else g.toast && g.toast("Não consegui ler a situação agora");
  }

  function html(o, ctx) {
    const s = ST[sT(o.id)];
    const dados = ctx.dados || { lista: [], faltas: [] };
    let h = "";
    /* dados da obra que o orçamento usa: uma faixa só, o que falta em laranja */
    h += `<div class="orc-dados">${dados.lista.map(x => `<div class="od ${x.falta ? "falta" : ""}" title="${escH(x.orig + (x.obs ? " · " + x.obs : ""))}"><span>${escH(x.rot)}</span><b>${x.falta ? "falta" : escH(x.val)}</b></div>`).join("")}</div>`;
    if (!s || (s.carregando && !s.linhas.length)) {
      return h + `<div class="orc-vazio"><span class="load"></span> ${escH(s && s.msg || "Preparando a planilha do orçamento…")}</div>`;
    }
    if (s.erro) return h + `<div class="orc-vazio">⚠ ${escH(s.erro)}</div>`;
    if (!s.contratos) s.contratos = gerarContratos(s);
    const tot = total(s), CF = conferir(s, o), nAlto = CF.filter(x => x.nivel === "alto").length, sub = s.sub || "orc";
    /* 17/11: guias — o orçamento da obra, a conferência e um contrato por guia */
    h += `<div class="orc-guias">
      <button class="og-g ${sub === "orc" ? "on" : ""}" onclick="OrcObra.guia('orc')"><b>Orçamento da obra${travado(s, "orcamento") ? " 🔒" : ""}</b><span>${moeda(tot)} · ${s.linhas.length} linhas</span></button>
      <button class="og-g ${sub === "conf" ? "on" : ""} ${nAlto ? "rd" : ""}" onclick="OrcObra.guia('conf')"><b>Conferência ${CF.length ? "⚠ " + CF.length : "✓"}</b><span>${nAlto ? nAlto + " possíveis erros" : CF.length ? "pontos para olhar" : "nada estranho"}</span></button>
      ${s.contratos.map((k, ki) => `<button class="og-g ct ${sub === "ct" + ki ? "on" : ""}" onclick="OrcObra.guia('ct${ki}')"><b>Contrato ${escH(k.id)} · ${escH(k.nome.split(" — ")[0])}${travado(s, "ct:" + k.id) ? " 🔒" : ""}</b><span>${moeda(totalContrato(k))}</span></button>`).join("")}
    </div>`;
    h += `<div class="orc-kpis">
      <div class="kp"><b>${moeda(tot)}</b><span>total previsto</span></div>
      <div class="kp st"><span>${s.salvoEm ? "Salva por <b>" + escH(s.salvoPor || "") + "</b> em " + escH(new Date(s.salvoEm).toLocaleString("pt-BR")) + (s.versao ? " · versão " + s.versao : "") : "Ainda não salva"}${s.sujo ? ` <i class="sujo">• alterações não salvas</i>` : ""}</span>
        <span>${CAT_LIDO ? "Catálogo do MC lido em " + escH(new Date(CAT_LIDO).toLocaleString("pt-BR")) : CAT_ERRO ? "⚠ catálogo do MC indisponível (" + escH(CAT_ERRO) + ") — sem custos" : ""}${s.revitEm ? " · Revit publicado em " + escH(new Date(s.revitEm).toLocaleString("pt-BR")) : ""}</span></div>
      <button class="bt ghost" onclick="OrcObra.regerar()" title="Monta a planilha de novo pelo modelo, pelos quantitativos do Revit e pelos dados da obra (descarta as edições não salvas)">↻ Gerar de novo</button>
      <button class="bt ghost" onclick="OrcObra.baixar()" title="Baixa a planilha em CSV (abre no Excel)">⬇ Baixar planilha</button>
      <button class="bt" ${s.salvando || s.podeSalvar === false ? "disabled" : ""} onclick="OrcObra.salvar()">${s.salvando ? "Salvando…" : "💾 Salvar"}</button>
    </div>`;
    if (sub === "conf") return h + conferenciaHtml(s, CF);
    if (/^ct\d+$/.test(sub)) { const k = s.contratos[Number(sub.slice(2))]; return h + (k ? envioBloco(s, "ct:" + k.id) : "") + contratoHtml(s, Number(sub.slice(2))); }
    h += envioBloco(s, "orcamento");
    const marca = {}; CF.forEach(x => { if (x.id) (marca[x.id] = marca[x.id] || []).push(x); });
    h += `<div class="orc-bar">
      <input class="busca" placeholder="Buscar na planilha (nome ou código)…" value="${escH(s.filtro || "")}" oninput="OrcObra.filtrar(this.value)">
      <label class="sw ${s.soAvisos ? "on" : ""}"><input type="checkbox" ${s.soAvisos ? "checked" : ""} onchange="OrcObra.soAvisos(this.checked)" style="display:none">⚠ só o que conferir</label>
      <span class="mults" title="Multiplicador das quantidades do Revit por disciplina (o HID costuma ser modelado com 1 casa)">${Object.keys(s.mult || {}).map(d => `${d} × <input type="number" min="0" step="1" value="${escH(s.mult[d])}" onchange="OrcObra.mult('${d}',this.value)">`).join("")}</span>
      <span class="sp"></span>
      <button class="bt ghost" onclick="OrcObra.renumerar()" title="Deixa os itens de todas as etapas em sequência (1, 2, 3…) na ordem em que estão">1·2·3 Renumerar tudo</button>
      <button class="bt az" onclick="OrcObra.acrescentar(null)" title="Acrescenta uma linha buscando a composição ou o insumo no catálogo do Mais Controle (bases Própria e Condomínio)">+ Nova linha</button>
    </div>`;
    const alx = (s.alertas || []).concat(s.aviso ? [s.aviso] : []);
    if (alx.length) h += `<div class="orc-av">${alx.map(escH).join("<br>")}</div>`;
    h += `<div class="orc-tab"><table><colgroup><col style="width:84px"><col style="width:132px"><col><col style="width:54px"><col style="width:104px"><col style="width:104px"><col style="width:116px"><col style="width:58px"></colgroup>
      <thead><tr><th title="Mude o índice para mover a linha de lugar ou de etapa">Índice ✎</th><th>Código</th><th>Descrição · de onde veio</th><th>Un</th><th class="n">Qtd</th><th class="n">Custo un.</th><th class="n">Total</th><th></th></tr></thead>`;
    grupos(s).forEach(gp => {
      const fechado = s.aberto[gp.k] === false, st = gp.linhas.reduce((t, l) => t + (l.q || 0) * (l.custo || 0), 0), na = gp.linhas.filter(l => l.aviso || l.semCat || !l.cod || marca[l.id]).length;
      const novaEt = gp.k !== "_revit" && !(MODELO && MODELO.etapas.some(x => x.idx === gp.k));
      h += `<tbody class="g"><tr class="gh"><td colspan="6" onclick="OrcObra.alternar('${gp.k}')"><span class="car">${fechado ? "▸" : "▾"}</span> <b>${escH(gp.k === "_revit" ? "" : gp.k + " · ")}${escH(gp.nome)}</b> <span class="cnt">${gp.linhas.length} ${gp.linhas.length === 1 ? "linha" : "linhas"}${na ? ` · <i>⚠ ${na}</i>` : ""}</span>
        ${gp.k !== "_revit" ? `<button class="gh-b" title="Renumerar os itens desta etapa" onclick="event.stopPropagation();OrcObra.renumerar('${gp.k}')">1·2·3</button>` : ""}${novaEt || (s.nomesEtapa || {})[gp.k] ? `<button class="gh-b" title="Dar nome a esta etapa" onclick="event.stopPropagation();OrcObra.nomeEtapa('${gp.k}')">✎ nome</button>` : ""}</td>
        <td class="n"><b>${moeda(st)}</b></td><td></td></tr></tbody>`;
      if (fechado) return;
      h += `<tbody>` + gp.linhas.map(l => {
        const av = [l.aviso, l.semCat ? "código não está no catálogo do MC" : "", l.inativo ? "código INATIVO no MC" : "", !l.cod ? "sem código do MC" : ""].filter(Boolean);
        const cf = (marca[l.id] || []).filter(x => x.txt.indexOf("sem código") < 0 && x.txt.indexOf("catálogo do MC") < 0 && x.txt.indexOf("INATIVO") < 0);
        return `<tr class="${av.length || cf.length ? "av" : ""} ${cf.some(x => x.nivel === "alto") ? "erro" : ""} ${l.editado ? "ed" : ""}" data-id="${l.id}">
          <td><input class="ix" value="${escH(l.idx)}" placeholder="${escH(l.etapa && l.etapa !== "_revit" ? l.etapa + ".?" : "?")}" onchange="OrcObra.indice('${l.id}',this.value)" title="Índice — ex.: 8.12 leva a linha para a etapa 8, item 12"></td>
          <td><button class="cod" onclick="OrcObra.trocar('${l.id}')" title="Trocar a composição/insumo">${l.cod ? escH(l.cod) : "escolher…"}</button></td>
          <td><div class="nm">${escH(l.nome)}</div><div class="og">${escH(l.origem || "")}${av.length ? ` <span class="w">⚠ ${escH(av.join(" · "))}</span>` : ""}${cf.length ? ` <span class="w cf">🔎 ${escH(cf.map(x => x.txt.replace(/^[^:]*: /, "")).join(" · "))}</span>` : ""}</div></td>
          <td class="mu">${escH(l.un)}</td>
          <td class="n"><input type="number" step="any" min="0" value="${escH(l.q)}" onchange="OrcObra.qtd('${l.id}',this.value)"></td>
          <td class="n mu">${l.custo ? moeda(l.custo) : "—"}</td>
          <td class="n"><b>${l.custo ? moeda((l.q || 0) * l.custo) : "—"}</b></td>
          <td class="ac"><button title="Apagar a linha" onclick="OrcObra.apagar('${l.id}')">✕</button></td></tr>`;
      }).join("") + `<tr class="add"><td></td><td colspan="7"><button onclick="OrcObra.acrescentar('${gp.k}')">+ acrescentar item nesta etapa</button></td></tr></tbody>`;
    });
    h += `<tfoot><tr><td colspan="6"><b>TOTAL PREVISTO</b></td><td class="n"><b>${moeda(tot)}</b></td><td></td></tr></tfoot></table></div>`;
    h += `<div class="ajuda" style="margin:8px 0 0">Modelo: orçamento REF 127 (casa de rua). Quantidades do Revit seguem o que foi publicado no 3D; o resto sai das regras por casa/lote, do formulário de obra e dos dados da obra. Custo: catálogo do Mais Controle. Para criar uma etapa nova, ponha na linha um índice com outro número de etapa (ex.: 19.1).</div>`;
    return h;
  }
  function conferenciaHtml(s, CF) {
    const rot = { alto: "Possível erro", medio: "Conferir", baixo: "Detalhe" };
    let h = `<div class="cf-top"><b>Conferência dos quantitativos</b><span>Compara com o REF proporcional ao nº de casas, com a área construída, com o formulário de obra e com o próprio Revit. Não muda nada — só aponta. Clique para ir à linha.</span></div>`;
    if (!CF.length) return h + `<div class="ok-msg" style="padding:12px 0">✓ Nada estranho nos quantitativos.</div>`;
    ["alto", "medio", "baixo"].forEach(n => {
      const l = CF.filter(x => x.nivel === n); if (!l.length) return;
      h += `<div class="cf-g ${n}"><div class="cf-h">${rot[n]} <span class="cnt">${l.length}</span></div>${l.map(x => `<button class="cf-i" ${x.id ? `onclick="OrcObra.irLinha('${x.id}')"` : "disabled"}><span>${escH(x.txt)}</span>${x.id ? "<i>ir à linha →</i>" : ""}</button>`).join("")}</div>`;
    });
    return h;
  }

  /* busca no catálogo (trocar / acrescentar) */
  let BUSCA = null;
  function abrirBusca(alvo) {
    BUSCA = alvo;
    let d = document.getElementById("orc-busca");
    if (!d) { d = document.createElement("div"); d.id = "orc-busca"; document.body.appendChild(d); }
    d.innerHTML = `<div class="ob-cx"><div class="ob-t"><b>${alvo.linha ? "Trocar o item" : "Acrescentar item"}</b><span class="sp"></span><button onclick="OrcObra.fecharBusca()">✕</button></div>
      ${alvo.linha ? "" : `<label class="ob-et">Etapa do orçamento <select id="ob-et">${(MODELO ? MODELO.etapas.filter(e => e.idx.indexOf(".") < 0) : []).map(e => `<option value="${e.idx}"${e.idx === alvo.etapa ? " selected" : ""}>${escH(e.idx + " · " + e.nome)}</option>`).join("")}</select></label>`}
      <input id="ob-q" class="busca" placeholder="Código (ex.: MAI-SIN-105087 ou 27) ou parte do nome…" oninput="OrcObra.buscar(this.value)" value="${escH(alvo.q || "")}">
      <div id="ob-r" class="ob-r"></div></div>`;
    d.classList.add("on");
    setTimeout(() => { const i = document.getElementById("ob-q"); if (i) { i.focus(); buscar(i.value); } }, 0);
  }
  function buscar(q) {
    const box = document.getElementById("ob-r"); if (!box) return;
    if (!CAT) { box.innerHTML = `<div class="ajuda">${CAT_ERRO ? "⚠ catálogo indisponível: " + escH(CAT_ERRO) : "carregando o catálogo…"}</div>`; return; }
    const t = NN(q).trim();
    if (t.length < 2) { box.innerHTML = `<div class="ajuda">Digite ao menos 2 letras. Só aparecem as bases Própria e Condomínio.</div>`; return; }
    const pal = t.split(" ").filter(Boolean);
    const res = CAT.filter(x => { const c = NN(x[1]); if (c === t || c.indexOf(t) === 0) return true; const n = NN(x[2]); return pal.every(p => n.indexOf(p) >= 0); })
      .sort((a, b) => (b[7] - a[7]) || (NN(a[1]) === t ? -1 : 0) || String(a[2]).localeCompare(String(b[2]), "pt-BR")).slice(0, 60);
    box.innerHTML = res.length ? res.map(x => `<button class="ob-i ${x[7] ? "" : "ina"}" onclick="OrcObra.escolher('${escH(String(x[1]).replace(/'/g, ""))}')">
      <span class="c">${escH(x[1])}</span><span class="n">${escH(x[2])}<small>${x[0] === "C" ? "Composição" : "Insumo"} · ${escH(x[5])}${x[7] ? "" : " · INATIVO"}</small></span><span class="u">${escH(x[3])}</span><span class="p">${moeda(x[4])}</span></button>`).join("")
      : `<div class="ajuda">Nada encontrado.</div>`;
  }
  function escolher(cod) {
    const o = g.OBRA_OBJ && g.OBRA_OBJ(); const s = o && ST[sT(o.id)]; const c = catDe(cod);
    if (!s || !c || !BUSCA) return fecharBusca();
    if (BUSCA.linha) {
      const l = s.linhas.find(x => x.id === BUSCA.linha);
      if (l) Object.assign(l, { cod: c[1], cat: c[0], nome: c[2] + (l.nome.indexOf(" — CASA ") > 0 ? l.nome.slice(l.nome.indexOf(" — CASA ")) : ""), un: c[3], custo: Number(c[4]) || 0, editado: true, aviso: "", semCat: false, inativo: !c[7], origem: (l.origem || "") + " · trocado na mão" });
    } else {
      const sel = document.getElementById("ob-et"), k = (sel && sel.value) || BUSCA.etapa || "_revit";
      /* índice novo: o próximo número dentro da etapa (8 → 8.12) */
      const nums = s.linhas.filter(x => x.idx && paiDe(x.idx) === k).map(x => parseFloat(String(x.idx).split(".").pop()) || 0);
      const nova = { id: "m" + Date.now(), etapa: k, idx: k === "_revit" ? "" : k + "." + ((nums.length ? Math.max.apply(null, nums) : 0) + 1), cod: c[1], cat: c[0], nome: c[2], un: c[3], q: 1, custo: Number(c[4]) || 0, origem: "acrescentado na mão", manual: true, editado: true, inativo: !c[7] };
      s.linhas.push(nova); ordenar(s.linhas);
    }
    s.sujo = true; fecharBusca(); g.OrcObra.repintar();
  }
  function fecharBusca() { BUSCA = null; const d = document.getElementById("orc-busca"); if (d) d.classList.remove("on"); }

  /* API para a obras.html */
  function atual() { const o = g.OBRA_OBJ && g.OBRA_OBJ(); return o ? { o: o, s: ST[sT(o.id)] } : {}; }
  /* 17/11: o 3D mostra a planilha da obra mesmo antes de salvar — o rascunho fica neste navegador */
  function guardarRascunho(s) {
    if (!s || !s.linhas || !s.linhas.length) return;
    try { localStorage.setItem("orc_rascunho_" + s.id, JSON.stringify({ em: Date.now(), salvoEm: s.salvoEm || null, sujo: !!s.sujo,
      linhas: s.linhas.map(l => ({ idx: l.idx, etapa: l.etapa, cod: l.cod, nome: l.nome, un: l.un, q: l.q, custo: l.custo, refs: l.refs })), nomesEtapa: s.nomesEtapa || {} })); } catch (e) {}
  }
  function recalcSomas(L) { L.forEach(x => { if (x.somaIds && !x.editado) x.q = Math.round(L.filter(y => x.somaIds.indexOf(y.id) >= 0).reduce((t, y) => t + (Number(y.q) || 0), 0) * 100) / 100; }); }
  /* Visualizador 3D: a planilha da obra para virar tabela — rascunho deste navegador, a salva, ou gerada agora */
  async function paraVisualizador(obraId, j, previa) {
    const id = sT(obraId);
    let r = null; try { r = JSON.parse(localStorage.getItem("orc_rascunho_" + id) || "null"); } catch (e) {}
    const salvoEm = previa && previa.salvo_em ? Date.parse(previa.salvo_em) : 0;
    if (r && r.linhas && r.linhas.length && (!salvoEm || r.em > salvoEm) && (r.sujo || !salvoEm)) return { linhas: r.linhas, nomes: r.nomesEtapa, rotulo: "rascunho deste navegador, não salvo" };
    if (previa && previa.dados && Array.isArray(previa.dados.linhas)) return { linhas: previa.dados.linhas, nomes: previa.dados.nomes_etapa, rotulo: "salvo em " + new Date(previa.salvo_em).toLocaleDateString("pt-BR") };
    try {
      await carregarModelo(); await carregarCatalogo();
      const d = await g.lerEstatico("obras.json", "orc_vis_obras");
      const o = (d && d.obras || []).find(x => sT(x.id) === id);
      if (!o) return null;
      const gx = gerar(o, { form: {} }, { linhas: lerTabelas(j), areas: lerAreas(j) });
      const tmp = { linhas: gx.linhas }; precificar(tmp);
      return { linhas: tmp.linhas, rotulo: "gerado agora pelo modelo — abra a obra para conferir e salvar" };
    } catch (e) { return null; }
  }
  g.OrcObra = {
    html: html, abrir: abrir, gerar: gerar, _st: ST, linhasRevit: j => lerTabelas(j), refKey: x => x.disc + "|" + x.tabela + "|" + x.k + "|" + (x.arrimo ? 1 : 0),
    repintar: () => { if (typeof g.repintarOrcamento === "function") g.repintarOrcamento(); const a = atual(); if (a.s && !a.s.carregando) guardarRascunho(a.s); },
    paraVisualizador: paraVisualizador, etapasModelo: () => MODELO ? MODELO.etapas : null,
    guia: v => { const a = atual(); if (!a.s) return; a.s.sub = v; g.OrcObra.repintar(); },
    indice: (id, v) => { const a = atual(); if (!a.s) return; const l = a.s.linhas.find(x => x.id === id); if (!l) return;
      v = String(v || "").trim().replace(/,/g, ".").replace(/\.+$/, "");
      if (!/^\d+(\.\d+)+$/.test(v)) { g.toast && g.toast("Índice inválido — use etapa.item, ex.: 8.12"); g.OrcObra.repintar(); return; }
      if (a.s.linhas.some(x => x !== l && x.idx === v)) {     /* índice já usado: a nova entra ali e as de baixo descem uma posição */
        const pai = paiDe(v), n = parseFloat(v.split(".").pop());
        a.s.linhas.filter(x => x !== l && x.idx && paiDe(x.idx) === pai && parseFloat(x.idx.split(".").pop()) >= n)
          .forEach(x => { x.idx = pai + "." + (parseFloat(x.idx.split(".").pop()) + 1); });
      }
      l.idx = v; l.etapa = paiDe(v); l.editado = true; a.s.sujo = true; ordenar(a.s.linhas); g.OrcObra.repintar(); },
    renumerar: k => { const a = atual(); if (!a.s) return; ordenar(a.s.linhas); renumerar(a.s.linhas, k == null, k == null ? null : k); a.s.sujo = true; g.OrcObra.repintar(); },
    nomeEtapa: k => { const a = atual(); if (!a.s) return; const atualN = (a.s.nomesEtapa || {})[k] || ""; const n = prompt("Nome da etapa " + k + ":", atualN); if (n == null) return;
      a.s.nomesEtapa = a.s.nomesEtapa || {}; if (n.trim()) a.s.nomesEtapa[k] = n.trim(); else delete a.s.nomesEtapa[k]; a.s.sujo = true; g.OrcObra.repintar(); },
    irLinha: id => { const a = atual(); if (!a.s) return; const l = a.s.linhas.find(x => x.id === id); a.s.sub = "orc"; a.s.filtro = ""; a.s.soAvisos = false;
      if (l) a.s.aberto[String(l.etapa || l.idx).split(".")[0]] = true; g.OrcObra.repintar();
      setTimeout(() => { const tr = document.querySelector('.orc-tab tr[data-id="' + id + '"]'); if (tr) { tr.scrollIntoView({ behavior: "smooth", block: "center" }); tr.classList.add("pisca"); setTimeout(() => tr.classList.remove("pisca"), 2200); } }, 50); },
    resumo: o => { const s = ST[sT(o.id)]; return s && s.linhas.length ? { total: total(s), linhas: s.linhas.length, avisos: avisos(s).length, salvo: !!s.salvoEm, sujo: !!s.sujo } : null; },
    totalContrato: totalContrato,
    salvar: () => { const a = atual(); return a.o ? salvar(a.o) : null; },
    enviarMC: item => { const a = atual(); if (a.o) confirmarEnvio(a.o, item || "orcamento"); },
    enviarConfirmado: item => { const a = atual(); if (a.o) enviarConfirmado(a.o, item || "orcamento"); },
    desbloquear: item => { const a = atual(); if (a.o) pedirDesbloqueio(a.o, item || "orcamento"); },
    desbloquearConfirmado: item => { const a = atual(); if (a.o) desbloquearConfirmado(a.o, item || "orcamento"); },
    envioAtualizar: () => { const a = atual(); if (a.o) envioAtualizar(a.o); },
    fecharJanela: fecharJanela,
    baixar: () => { const a = atual(); if (a.o) baixar(a.o); },
    regerar: () => { const a = atual(); if (!a.o) return; if (a.s && (a.s.sujo || a.s.salvoEm) && !confirm("Gerar a planilha de novo pelo modelo e pelo Revit? As edições feitas aqui somem (a versão salva só muda se você salvar depois).")) return; abrir(a.o, g.ctxOrcamento ? g.ctxOrcamento(a.o) : {}, { regerar: true }); },
    filtrar: v => { const a = atual(); if (!a.s) return; a.s.filtro = v; g.OrcObra.repintar(); setTimeout(() => { const i = document.querySelector(".orc-bar .busca"); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } }, 0); },
    soAvisos: v => { const a = atual(); if (!a.s) return; a.s.soAvisos = !!v; g.OrcObra.repintar(); },
    alternar: k => { const a = atual(); if (!a.s) return; a.s.aberto[k] = a.s.aberto[k] === false; g.OrcObra.repintar(); },
    qtd: (id, v) => { const a = atual(); if (!a.s) return; const l = a.s.linhas.find(x => x.id === id); if (!l) return; l.q = Math.max(0, Number(String(v).replace(",", ".")) || 0); l.editado = true; a.s.sujo = true;
      recalcSomas(a.s.linhas);
      g.OrcObra.repintar(); },
    mult: (d, v) => { const a = atual(); if (!a.s) return; const m = Math.max(0, Number(v) || 0); a.s.mult[d] = m; a.s.sujo = true;
      a.s.linhas.forEach(l => { if (l.revit && l.revit.disc === d && !l.editado) { l.q = arred(l.revit.base * m * (l.revit.fator || 1), l.revit.arred); l.origem = "Revit " + d + ": " + numBr(l.revit.base) + (m !== 1 ? " × " + m : "") + ((l.revit.fator || 1) !== 1 ? " × " + l.revit.fator : ""); } });
      g.OrcObra.repintar(); },
    apagar: id => { const a = atual(); if (!a.s) return; a.s.linhas = a.s.linhas.filter(x => x.id !== id); recalcSomas(a.s.linhas); a.s.sujo = true; g.OrcObra.repintar(); },
    trocar: id => { const a = atual(); if (!a.s) return; const l = a.s.linhas.find(x => x.id === id); abrirBusca({ linha: id, q: l ? (l.cod ? "" : l.nome.split(" ").slice(0, 3).join(" ")) : "" }); },
    acrescentar: k => abrirBusca({ etapa: k }),
    buscar: buscar, escolher: escolher, fecharBusca: fecharBusca, chave: chave,
    ctEditar: (ki, i, campo, v) => { const a = atual(); if (!a.s || !a.s.contratos) return; const l = a.s.contratos[ki].linhas[i]; if (!l) return; l[campo] = Math.max(0, Number(String(v).replace(",", ".")) || 0); a.s.sujo = true; g.OrcObra.repintar(); },
    refazerContratos: id => { const a = atual(); if (!a.s) return; const novos = gerarContratos(a.s);
      a.s.contratos = id ? (a.s.contratos || novos).map(k => k.id === id ? (novos.find(n => n.id === id) || k) : k) : novos; a.s.sujo = true; g.OrcObra.repintar(); }
  };
})(window);
