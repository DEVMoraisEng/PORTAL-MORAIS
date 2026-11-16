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
    if (!forcar) { try { const c = JSON.parse(sessionStorage.getItem("orc_catalogo") || "null"); if (c && c.itens && Date.now() - c.ts < 30 * 60e3) { CAT = c.itens; CAT_LIDO = c.lido_em; indexar(); return CAT; } } catch (e) {} }
    let r; try { r = await g.chamar({ action: "orcCatalogo", forcar: !!forcar }, 60000, true); } catch (e) { r = { ok: false, erro: "sem conexão" }; }
    if (!r || !r.ok) { CAT_ERRO = (r && r.erro) || "erro"; return null; }
    CAT = r.itens || []; CAT_LIDO = r.lido_em || null; CAT_ERRO = ""; indexar();
    try { sessionStorage.setItem("orc_catalogo", JSON.stringify({ ts: Date.now(), itens: CAT, lido_em: CAT_LIDO })); } catch (e) {}
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
    const nova = (it, extra) => Object.assign({ id: "l" + (++seq), etapa: paiDe(it.idx), idx: it.idx, cod: it.cod, cat: it.cat, nome: it.nome, un: it.un, q: 0, origem: "", aviso: "" }, extra);
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
            Object.assign(ln, { q: arred(base * m * fa, r.arred), revit: { base: base, disc: r.disc, fator: fa, arred: r.arred }, refs: refsDe(rows),
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
        q: arred(x.q * m, /^M$|^M2|^M²/i.test(x.un) ? "teto" : "nenhum"), revit: { base: x.q, disc: x.disc, fator: 1, arred: "teto" }, refs: refsDe([x]),
        origem: "Revit " + x.disc + " (" + x.tabela + "): " + numBr(x.q) + (m !== 1 ? " × " + m : ""), extra: true,
        aviso: c ? "veio do Revit e não está no modelo — conferir" : "veio do Revit e não achei no catálogo do MC: escolha o código" });
    });
    if (!temRevit) alertas.push(revit && revit.erro ? "Quantitativos do Revit: " + revit.erro + " — as linhas do Revit saíram pela proporção do REF." : "Sem quantitativos do Revit — as linhas do Revit saíram pela proporção do REF.");
    return { linhas: L, mult: mult, alertas: alertas };
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
          const l = s.linhas.find(x => x.idx === idx); if (!l || !/m/i.test(l.un || "")) return;
          const q = Math.round((Number(l.q) || 0) / nC * 100) / 100; if (!q) return;
          k.linhas.push({ casa: n, item: nome, un: "m²", q: q, preco: c.precos[tp], tipo: tp, de: idx });
        });
      }
      out.push(k);
    });
    return out;
  }
  const totalContrato = k => k.linhas.reduce((t, l) => t + (Number(l.q) || 0) * (Number(l.preco) || 0), 0);
  function contratosHtml(s) {
    if (!s.contratos) s.contratos = gerarContratos(s);
    const nomeEt = idx => { const e = MODELO && MODELO.etapas.find(x => x.idx === idx); return e ? e.idx + " · " + e.nome : idx; };
    let h = `<div class="ct-top"><div><b>Contratos de empreiteiros</b><span>um contrato por empreiteiro, uma etapa por casa — como a medição do Mais Controle. Quantidades da cerâmica saem da planilha acima (dividida pelas casas); preços editáveis.</span></div>
      <button class="bt ghost" onclick="OrcObra.refazerContratos()" title="Monta os contratos de novo pela planilha atual e pelos preços padrão">↻ Refazer pelos números do orçamento</button></div><div class="cts">`;
    s.contratos.forEach((k, ki) => {
      const tot = totalContrato(k), casas = [...new Set(k.linhas.map(l => l.casa))];
      h += `<div class="ct"><div class="ct-h"><span class="ct-n">${escH(k.id)}</span><div class="ct-t"><b>${escH(k.nome)}</b><span>modelo ${escH(k.modelo)} · vínculo: etapa ${escH(nomeEt(k.etapa))}</span></div><b class="ct-v">${moeda(tot)}</b></div>
        <table class="ct-tb"><colgroup><col><col style="width:38px"><col style="width:70px"><col style="width:78px"><col style="width:96px"></colgroup>
        <thead><tr><th>Item</th><th>Un</th><th class="n">Qtd</th><th class="n">Preço un.</th><th class="n">Total</th></tr></thead><tbody>${casas.map(c => {
          const ls = k.linhas.map((l, i) => [l, i]).filter(([l]) => l.casa === c), sub = ls.reduce((t, [l]) => t + (l.q || 0) * (l.preco || 0), 0);
          return `<tr class="cs"><td colspan="4"><b>CASA ${c}</b></td><td class="n"><b>${moeda(sub)}</b></td></tr>` + ls.map(([l, i]) => `<tr><td>${escH(l.item)}${l.de ? `<small class="mu"> · linha ${escH(l.de)}</small>` : ""}</td><td class="mu">${escH(l.un)}</td>
            <td class="n"><input type="number" step="any" min="0" value="${escH(l.q)}" onchange="OrcObra.ctEditar(${ki},${i},'q',this.value)"></td>
            <td class="n"><input type="number" step="any" min="0" value="${escH(l.preco)}" onchange="OrcObra.ctEditar(${ki},${i},'preco',this.value)"></td>
            <td class="n">${moeda((l.q || 0) * (l.preco || 0))}</td></tr>`).join("");
        }).join("") || `<tr><td colspan="5" class="mu">Sem linhas — a planilha não tem os itens desta etapa.</td></tr>`}</tbody></table></div>`;
    });
    return h + `</div>`;
  }

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
      if (p && p.ok && p.previa && p.previa.dados && Array.isArray(p.previa.dados.linhas)) {
        const d = p.previa.dados;
        Object.assign(s, { linhas: d.linhas, mult: d.mult || {}, alertas: d.alertas || [], contratos: d.contratos || null, nCasas: d.n_casas || Number(o.n_casas) || 1, versao: p.previa.versao, salvoPor: p.previa.salvo_por,
          salvoEm: p.previa.salvo_em, revitEm: d.revit_em || "", sujo: false, carregando: false, msg: "", origemTxt: "salva" });
        precificar(s); g.OrcObra.repintar(); return s;
      }
      if (p && p.aviso) s.aviso = p.aviso;
    }
    s.msg = "Lendo os quantitativos do Revit…"; g.OrcObra.repintar();
    let rv; try { rv = await carregarRevit(o.id); } catch (e) { rv = { erro: String(e.message || e) }; }
    const gx = gerar(o, ctx, rv && !rv.erro ? rv : { erro: rv && rv.erro });
    Object.assign(s, { linhas: gx.linhas, mult: gx.mult, alertas: gx.alertas, revitEm: rv && rv.em || "", sujo: true, carregando: false, msg: "", origemTxt: "gerada", nCasas: Number(o.n_casas) || 1 });
    s.contratos = gerarContratos(s);
    precificar(s); g.OrcObra.repintar(); return s;
  }
  async function salvar(o) {
    const s = ST[sT(o.id)]; if (!s) return;
    s.salvando = true; g.OrcObra.repintar();
    const dados = { modelo: MODELO && MODELO.versao, linhas: s.linhas.map(l => { const c = Object.assign({}, l); delete c.semCat; delete c.inativo; return c; }),
      mult: s.mult, alertas: s.alertas, revit_em: s.revitEm || "", total: total(s), gerado_em: new Date().toISOString(),
      n_casas: s.nCasas || null, contratos: s.contratos || null };
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
    const nomeEt = idx => { const e = et.find(x => x.idx === idx); return e ? e.nome : (idx === "_revit" ? "Do Revit, sem lugar no modelo" : "Outros"); };
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
    const tot = total(s), av = avisos(s), nRevit = s.linhas.filter(l => l.revit).length;
    h += `<div class="orc-kpis">
      <div class="kp"><b>${moeda(tot)}</b><span>total previsto</span></div>
      <div class="kp"><b>${s.linhas.length}</b><span>linhas</span></div>
      <div class="kp"><b>${nRevit}</b><span>do Revit</span></div>
      <div class="kp ${av.length ? "rd" : ""}"><b>${av.length}</b><span>para conferir</span></div>
      <div class="kp st"><span>${s.salvoEm ? "Salva por <b>" + escH(s.salvoPor || "") + "</b> em " + escH(new Date(s.salvoEm).toLocaleString("pt-BR")) + (s.versao ? " · versão " + s.versao : "") : "Ainda não salva"}${s.sujo ? ` <i class="sujo">• alterações não salvas</i>` : ""}</span>
        <span>${CAT_LIDO ? "Catálogo do MC lido em " + escH(new Date(CAT_LIDO).toLocaleString("pt-BR")) : CAT_ERRO ? "⚠ catálogo do MC indisponível (" + escH(CAT_ERRO) + ") — sem custos" : ""}${s.revitEm ? " · Revit publicado em " + escH(new Date(s.revitEm).toLocaleString("pt-BR")) : ""}</span></div>
    </div>`;
    h += `<div class="orc-bar">
      <input class="busca" placeholder="Buscar na planilha (nome ou código)…" value="${escH(s.filtro || "")}" oninput="OrcObra.filtrar(this.value)">
      <label class="sw ${s.soAvisos ? "on" : ""}"><input type="checkbox" ${s.soAvisos ? "checked" : ""} onchange="OrcObra.soAvisos(this.checked)" style="display:none">⚠ só o que conferir</label>
      <span class="mults" title="Multiplicador das quantidades do Revit por disciplina (o HID costuma ser modelado com 1 casa)">${Object.keys(s.mult || {}).map(d => `${d} × <input type="number" min="0" step="1" value="${escH(s.mult[d])}" onchange="OrcObra.mult('${d}',this.value)">`).join("")}</span>
      <span class="sp"></span>
      <button class="bt az" onclick="OrcObra.acrescentar(null)" title="Acrescenta uma linha buscando a composição ou o insumo no catálogo do Mais Controle (bases Própria e Condomínio)">+ Nova linha</button>
      <button class="bt ghost" onclick="OrcObra.regerar()" title="Monta a planilha de novo pelo modelo, pelos quantitativos do Revit e pelos dados da obra (descarta as edições não salvas)">↻ Gerar de novo</button>
      <button class="bt ghost" onclick="OrcObra.baixar()" title="Baixa a planilha em CSV (abre no Excel)">⬇ Baixar planilha</button>
      <button class="bt" ${s.salvando || s.podeSalvar === false ? "disabled" : ""} onclick="OrcObra.salvar()">${s.salvando ? "Salvando…" : "💾 Salvar"}</button>
    </div>`;
    const alx = (s.alertas || []).concat(s.aviso ? [s.aviso] : []);
    if (alx.length) h += `<div class="orc-av">${alx.map(escH).join("<br>")}</div>`;
    h += `<div class="orc-tab"><table><colgroup><col style="width:64px"><col style="width:132px"><col><col style="width:54px"><col style="width:104px"><col style="width:104px"><col style="width:116px"><col style="width:58px"></colgroup>
      <thead><tr><th>Índice</th><th>Código</th><th>Descrição · de onde veio</th><th>Un</th><th class="n">Qtd</th><th class="n">Custo un.</th><th class="n">Total</th><th></th></tr></thead>`;
    grupos(s).forEach(gp => {
      const fechado = s.aberto[gp.k] === false, st = gp.linhas.reduce((t, l) => t + (l.q || 0) * (l.custo || 0), 0), na = gp.linhas.filter(l => l.aviso || l.semCat || !l.cod).length;
      h += `<tbody class="g"><tr class="gh" onclick="OrcObra.alternar('${gp.k}')"><td colspan="6"><span class="car">${fechado ? "▸" : "▾"}</span> <b>${escH(gp.k === "_revit" ? "" : gp.k + " · ")}${escH(gp.nome)}</b> <span class="cnt">${gp.linhas.length} ${gp.linhas.length === 1 ? "linha" : "linhas"}${na ? ` · <i>⚠ ${na}</i>` : ""}</span></td><td class="n"><b>${moeda(st)}</b></td><td></td></tr></tbody>`;
      if (fechado) return;
      h += `<tbody>` + gp.linhas.map(l => {
        const av = [l.aviso, l.semCat ? "código não está no catálogo do MC" : "", l.inativo ? "código INATIVO no MC" : "", !l.cod ? "sem código do MC" : ""].filter(Boolean);
        return `<tr class="${av.length ? "av" : ""} ${l.editado ? "ed" : ""}" data-id="${l.id}">
          <td class="mu">${escH(l.idx)}</td>
          <td><button class="cod" onclick="OrcObra.trocar('${l.id}')" title="Trocar a composição/insumo">${l.cod ? escH(l.cod) : "escolher…"}</button></td>
          <td><div class="nm">${escH(l.nome)}</div><div class="og">${escH(l.origem || "")}${av.length ? ` <span class="w">⚠ ${escH(av.join(" · "))}</span>` : ""}</div></td>
          <td class="mu">${escH(l.un)}</td>
          <td class="n"><input type="number" step="any" min="0" value="${escH(l.q)}" onchange="OrcObra.qtd('${l.id}',this.value)"></td>
          <td class="n mu">${l.custo ? moeda(l.custo) : "—"}</td>
          <td class="n"><b>${l.custo ? moeda((l.q || 0) * l.custo) : "—"}</b></td>
          <td class="ac"><button title="Apagar a linha" onclick="OrcObra.apagar('${l.id}')">✕</button></td></tr>`;
      }).join("") + `<tr class="add"><td></td><td colspan="7"><button onclick="OrcObra.acrescentar('${gp.k}')">+ acrescentar item nesta etapa</button></td></tr></tbody>`;
    });
    h += `<tfoot><tr><td colspan="6"><b>TOTAL PREVISTO</b></td><td class="n"><b>${moeda(tot)}</b></td><td></td></tr></tfoot></table></div>`;
    h += contratosHtml(s);
    h += `<div class="ajuda" style="margin:8px 0 0">O modelo é o orçamento REF 127 (casa de rua). Quantidades do Revit seguem o que foi publicado no 3D; o resto sai das regras por casa/lote, do formulário de obra e dos dados da obra. O custo é o do catálogo do Mais Controle. Enviar ao MC fica para a próxima etapa.</div>`;
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
      const sel = document.getElementById("ob-et"), k = (sel && sel.value) || BUSCA.etapa || "_revit", n = s.linhas.filter(x => String(x.etapa).split(".")[0] === k).length;
      const pos = s.linhas.map((x, i) => String(x.etapa).split(".")[0] === k || (k === "_revit" && x.etapa === "_revit") ? i : -1).filter(i => i >= 0).pop();
      const nova = { id: "m" + Date.now(), etapa: k, idx: k === "_revit" ? "" : k + "." + (n + 1) + "*", cod: c[1], cat: c[0], nome: c[2], un: c[3], q: 1, custo: Number(c[4]) || 0, origem: "acrescentado na mão", manual: true, editado: true, inativo: !c[7] };
      s.linhas.splice(pos == null ? s.linhas.length : pos + 1, 0, nova);
    }
    s.sujo = true; fecharBusca(); g.OrcObra.repintar();
  }
  function fecharBusca() { BUSCA = null; const d = document.getElementById("orc-busca"); if (d) d.classList.remove("on"); }

  /* API para a obras.html */
  function atual() { const o = g.OBRA_OBJ && g.OBRA_OBJ(); return o ? { o: o, s: ST[sT(o.id)] } : {}; }
  g.OrcObra = {
    html: html, abrir: abrir, gerar: gerar, _st: ST, linhasRevit: j => lerTabelas(j), refKey: x => x.disc + "|" + x.tabela + "|" + x.k + "|" + (x.arrimo ? 1 : 0),
    repintar: () => { if (typeof g.repintarOrcamento === "function") g.repintarOrcamento(); },
    resumo: o => { const s = ST[sT(o.id)]; return s && s.linhas.length ? { total: total(s), linhas: s.linhas.length, avisos: avisos(s).length, salvo: !!s.salvoEm, sujo: !!s.sujo } : null; },
    totalContrato: totalContrato,
    salvar: () => { const a = atual(); return a.o ? salvar(a.o) : null; },
    baixar: () => { const a = atual(); if (a.o) baixar(a.o); },
    regerar: () => { const a = atual(); if (!a.o) return; if (a.s && (a.s.sujo || a.s.salvoEm) && !confirm("Gerar a planilha de novo pelo modelo e pelo Revit? As edições feitas aqui somem (a versão salva só muda se você salvar depois).")) return; abrir(a.o, g.ctxOrcamento ? g.ctxOrcamento(a.o) : {}, { regerar: true }); },
    filtrar: v => { const a = atual(); if (!a.s) return; a.s.filtro = v; g.OrcObra.repintar(); setTimeout(() => { const i = document.querySelector(".orc-bar .busca"); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } }, 0); },
    soAvisos: v => { const a = atual(); if (!a.s) return; a.s.soAvisos = !!v; g.OrcObra.repintar(); },
    alternar: k => { const a = atual(); if (!a.s) return; a.s.aberto[k] = a.s.aberto[k] === false; g.OrcObra.repintar(); },
    qtd: (id, v) => { const a = atual(); if (!a.s) return; const l = a.s.linhas.find(x => x.id === id); if (!l) return; l.q = Math.max(0, Number(String(v).replace(",", ".")) || 0); l.editado = true; a.s.sujo = true;
      a.s.linhas.forEach(x => { if (x.soma && x.soma.indexOf(l.idx) >= 0 && !x.editado) x.q = Math.round(a.s.linhas.filter(y => x.soma.indexOf(y.idx) >= 0).reduce((t, y) => t + (Number(y.q) || 0), 0) * 100) / 100; });
      g.OrcObra.repintar(); },
    mult: (d, v) => { const a = atual(); if (!a.s) return; const m = Math.max(0, Number(v) || 0); a.s.mult[d] = m; a.s.sujo = true;
      a.s.linhas.forEach(l => { if (l.revit && l.revit.disc === d && !l.editado) { l.q = arred(l.revit.base * m * (l.revit.fator || 1), l.revit.arred); l.origem = "Revit " + d + ": " + numBr(l.revit.base) + (m !== 1 ? " × " + m : "") + ((l.revit.fator || 1) !== 1 ? " × " + l.revit.fator : ""); } });
      g.OrcObra.repintar(); },
    apagar: id => { const a = atual(); if (!a.s) return; a.s.linhas = a.s.linhas.filter(x => x.id !== id); a.s.sujo = true; g.OrcObra.repintar(); },
    trocar: id => { const a = atual(); if (!a.s) return; const l = a.s.linhas.find(x => x.id === id); abrirBusca({ linha: id, q: l ? (l.cod ? "" : l.nome.split(" ").slice(0, 3).join(" ")) : "" }); },
    acrescentar: k => abrirBusca({ etapa: k }),
    buscar: buscar, escolher: escolher, fecharBusca: fecharBusca, chave: chave,
    ctEditar: (ki, i, campo, v) => { const a = atual(); if (!a.s || !a.s.contratos) return; const l = a.s.contratos[ki].linhas[i]; if (!l) return; l[campo] = Math.max(0, Number(String(v).replace(",", ".")) || 0); a.s.sujo = true; g.OrcObra.repintar(); },
    refazerContratos: () => { const a = atual(); if (!a.s) return; a.s.contratos = gerarContratos(a.s); a.s.sujo = true; g.OrcObra.repintar(); }
  };
})(window);
