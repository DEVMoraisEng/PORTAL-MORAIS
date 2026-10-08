/* Apps Script falso (vm) e Notion falso em memória para testar o PortalVenda.gs
 * sem rede. Só dados inventados — o repositório é público. */
import vm from "node:vm";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VENDA = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SEGREDO = "segredo-de-teste";

const comSinal = (buf) => [...buf].map((b) => (b > 127 ? b - 256 : b));
const paraBuf = (x) => (typeof x === "string" ? Buffer.from(x, "utf8") : Buffer.from(x.map((b) => b & 255)));
const b64ws = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_");

export function assinar(payload, segredo = SEGREDO) {
  const p = b64ws(Buffer.from(JSON.stringify(payload), "utf8"));
  return p + "." + b64ws(crypto.createHmac("sha256", segredo).update(p).digest());
}

function blob(buf, mime, nome) {
  const b = { getBytes: () => comSinal(buf), getDataAsString: () => buf.toString("utf8"),
              getContentType: () => mime, getName: () => b._nome, _buf: buf, _nome: nome };
  b.setName = (n) => { b._nome = String(n); return b; };   // como Blob.setName: devolve o próprio blob
  return b;
}

export function criarGas({ props, rotas, extras = {} }) {
  const cache = new Map(), chamadas = [], logs = [];
  const ctx = {
    console: { log: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push(a.join(" ")) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (n) => (n in props ? props[n] : null),
                                                       setProperty: (n, v) => { props[n] = String(v); },
                                                       deleteProperty: (n) => { delete props[n]; } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (cache.has(k) ? cache.get(k) : null),
                                             put: (k, v) => { if (String(v).length > 100000) throw new Error("Argument too large: value"); cache.set(k, v); },
                                             remove: (k) => cache.delete(k) }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (t) => ({ setMimeType: () => ({ texto: t }) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Utilities: {
      base64EncodeWebSafe: (x) => b64ws(paraBuf(x)),
      base64DecodeWebSafe: (s) => comSinal(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64")),
      base64Encode: (x) => paraBuf(x).toString("base64"),
      base64Decode: (s) => comSinal(Buffer.from(s, "base64")),
      computeHmacSha256Signature: (valor, chave) => comSinal(crypto.createHmac("sha256", chave).update(valor).digest()),
      DigestAlgorithm: { SHA_256: "SHA_256" },
      Charset: { UTF_8: "UTF_8" },
      computeDigest: (alg, valor, charset) => {
        if (alg !== "SHA_256" || charset !== "UTF_8") throw new Error("computeDigest: algoritmo/charset não previsto");
        return comSinal(crypto.createHash("sha256").update(String(valor), "utf8").digest());
      },
      sleep: () => {},
      newBlob: (x, mime, nome) => blob(paraBuf(x), mime, nome),
      formatDate: (d, tz, fmt) => {
        const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
          .formatToParts(d).map((x) => [x.type, x.value]));
        return fmt.replace("yyyy", p.year).replace("MM", p.month).replace("dd", p.day);
      },
    },
    UrlFetchApp: {
      fetch: (url, opt = {}) => {
        chamadas.push({ url, opt });
        const r = rotas(url, opt);
        if (!r) throw new Error("rota não prevista no teste: " + url);
        if (r.lancar) throw new Error(r.lancar);
        const buf = r.buf || Buffer.from(r.texto !== undefined ? r.texto : JSON.stringify(r.json || {}), "utf8");
        return { getResponseCode: () => r.status || 200, getContentText: () => buf.toString("utf8"),
                 getBlob: () => blob(buf, r.mime || "application/octet-stream", "arquivo") };
      },
    },
  };
  Object.assign(ctx, extras);
  vm.createContext(ctx);
  for (const f of ["RegrasVenda.js", "ClaudeLeitor.js", "OpenAILeitor.js", "ContratoVenda.js", "ClicksignVenda.js",
                   "PortalVenda.gs", "GerarContrato.gs", "AssinaturaVenda.gs", "MaisControleVenda.gs",
                   "CondominioVenda.js", "GerarVendaCondominio.gs"])
    vm.runInContext(fs.readFileSync(path.join(VENDA, f), "utf8"), ctx, { filename: f });
  const chamar = (payload) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(payload) } }).texto);
  return { ctx, chamar, chamadas, logs, cache };
}

/* Colunas como estão no Notion (CLIENTES e CPF com o espaço do fim, como na base real). */
export const COLUNAS_REAIS = {
  "ENDEREÇO": "title", "CLIENTES ": "rich_text", "CPF ": "rich_text", "VALOR DO FGTS": "number",
  "TIPO DE CASA": { tipo: "select", opcoes: ["CASA DE RUA", "CASA DE CONDOMÍNIO"] },
  "COMPRADOR 1 - IDENTIDADE": "files", "COMPRADOR 1 - COMPROVANTE DE ENDEREÇO": "files",
  "COMPRADOR 2 - IDENTIDADE": "files", "COMPRADOR 2 - COMPROVANTE DE ENDEREÇO": "files",
  "APROVAÇÃO DA CAIXA": "files",
  "COMPRADOR 1 - DOCUMENTO": "rich_text", "COMPRADOR 1 - NACIONALIDADE": "rich_text",
  "COMPRADOR 1 - ESTADO CIVIL": "rich_text", "COMPRADOR 1 - PROFISSÃO": "rich_text", "COMPRADOR 1 - ENDEREÇO": "rich_text",
  "COMPRADOR 2 - NOME": "rich_text", "COMPRADOR 2 - CPF": "rich_text", "COMPRADOR 2 - DOCUMENTO": "rich_text",
  "COMPRADOR 2 - NACIONALIDADE": "rich_text", "COMPRADOR 2 - ESTADO CIVIL": "rich_text",
  "COMPRADOR 2 - PROFISSÃO": "rich_text", "COMPRADOR 2 - ENDEREÇO": "rich_text",
  "COMPRADOR 2 - E-MAIL": "email", "COMPRADOR 2 - TELEFONE": "phone_number",
  "VALOR FINANCIADO": "number", "VALOR DO SUBSÍDIO": "number",
  "DOSSIÊ": { tipo: "select", opcoes: ["FALTA DOCUMENTO", "LIDO PELA IA – CONFERIR", "CONFERIDO", "DEVOLVIDO"] },
  "DOSSIÊ - OBSERVAÇÃO DO COMPRADOR": "rich_text",
};

export const texto = (s) => ({ rich_text: [{ type: "text", plain_text: s, text: { content: s } }] });
/* propriedades "cruas" (só {title:[…]}, {select:…}) ganham o `type` que o Notion sempre manda */
const tipar = (props) => Object.fromEntries(Object.entries(props).map(([n, v]) => [n, v.type ? v : Object.assign({ type: Object.keys(v)[0] }, v)]));
const vazioDe = (t) => ({ [t]: t === "files" || t === "rich_text" || t === "title" ? [] : null });

/* Página id no formato que PortalVenda.gs exige (32 hex, sem hífen) e o
   database_id "de fábrica" que a página falsa diz ter como parent. */
export const PAGE_ID_PADRAO = "0123456789abcdef0123456789abcdef";
export const DB_ID_PADRAO = "db-falso";

/* Notion falso: uma base (as colunas acima, ou `colunas`) e uma página
   (PAGE_ID_PADRAO por padrão, ou `pageId`), com `parent.database_id` = `dbId`. */
export function notionFalso({ valores = {}, s3 = {}, colunas = COLUNAS_REAIS, pageId = PAGE_ID_PADRAO, dbId = DB_ID_PADRAO,
                              paginasExtras = {}, paginasDb = {}, bases = {} } = {}) {
  const db = { properties: {} };
  for (const [nome, t] of Object.entries(colunas)) {
    const tipo = typeof t === "string" ? t : t.tipo;
    db.properties[nome] = { type: tipo, [tipo]: tipo === "select" ? { options: t.opcoes.map((n) => ({ name: n })) } : {} };
  }
  const pagina = { id: pageId, parent: { database_id: dbId }, properties: {} };
  for (const [nome, p] of Object.entries(db.properties)) pagina.properties[nome] = Object.assign({ type: p.type }, vazioDe(p.type));
  for (const [nome, v] of Object.entries(valores)) Object.assign(pagina.properties[nome], v);
  const uploads = {}, patches = [];
  let seq = 0;

  function aplicar(props) {
    for (const [nome, v] of Object.entries(props)) {
      if (!db.properties[nome]) return { status: 400, json: { message: "Could not find property " + nome } };
    }
    for (const [nome, v] of Object.entries(props)) {
      const novo = JSON.parse(JSON.stringify(v));
      if (novo.files) novo.files = novo.files.map((f) => (f.file_upload
        ? { name: f.name, type: "file", file: { url: "https://s3.falso/" + f.file_upload.id } } : f));
      if (novo.rich_text) novo.rich_text = novo.rich_text.map((t) => Object.assign({ plain_text: t.text.content }, t));
      pagina.properties[nome] = Object.assign({ type: pagina.properties[nome].type }, novo);
    }
    return { json: pagina };
  }

  function rota(url, opt) {
    const m = String(opt.method || "get").toUpperCase();
    const corpo = typeof opt.payload === "string" ? JSON.parse(opt.payload) : null;
    if (url.startsWith("https://api.notion.com/v1")) {
      const u = url.slice("https://api.notion.com/v1".length);
      if (m === "GET" && u.startsWith("/databases/")) return { json: db };
      if (m === "GET" && u === "/pages/" + pageId) return { json: pagina };
      /* páginas extras (ex.: a obra) e linhas de bases de cadastro, em ordem de declaração */
      if (m === "GET" && u.startsWith("/pages/") && paginasExtras[u.slice(7)])
        return { json: { id: u.slice(7), parent: { database_id: paginasDb[u.slice(7)] || "db-extra" }, properties: tipar(paginasExtras[u.slice(7)]) } };
      const q = /^\/databases\/([^/]+)\/query$/.exec(u);
      if (m === "POST" && q && bases[q[1]]) {
        let linhas = bases[q[1]].map((p) => tipar(p));
        const fl = corpo && corpo.filter;
        if (fl) { /* como o Notion: a propriedade do filtro tem de existir e ser de título */
          if (!fl.title || !linhas.every((l) => l[fl.property] && l[fl.property].type === "title"))
            return { status: 400, json: { message: "filtro inválido" } };
          const tx = (l) => l[fl.property].title.map((t) => t.plain_text).join("");
          linhas = linhas.filter((l) => tx(l) === fl.title.equals);
        }
        return { json: { results: linhas.map((p, i) => ({ id: "linha-" + i, properties: p })), has_more: false } };
      }
      if (m === "PATCH" && u === "/pages/" + pageId) { patches.push(corpo.properties); return aplicar(corpo.properties); }
      if (m === "POST" && u === "/file_uploads") {
        const id = "fu-" + (++seq);
        uploads[id] = { nome: corpo.filename, mime: corpo.content_type };
        return { json: { id, upload_url: "https://upload.notion.falso/" + id } };
      }
      return { status: 404, json: { message: "rota falsa inexistente" } };
    }
    if (url.startsWith("https://upload.notion.falso/")) {
      const id = url.split("/").pop();
      uploads[id].buf = opt.payload.file._buf;
      return { json: { status: "uploaded" } };
    }
    if (url.startsWith("https://s3.falso/")) {
      const id = url.split("/").pop(), a = uploads[id] || s3[id];
      return a ? { buf: a.buf, mime: a.mime } : { status: 404, texto: "" };
    }
    return null;
  }
  return { rota, pagina, uploads, patches, db };
}

/* Clicksign falsa (API v3, JSON:API), no formato dos exemplos da documentação
 * (venda/CLICKSIGN-API.md). Guarda cada chamada (método, caminho, corpo,
 * cabeçalhos). `falhar(metodo, caminho, corpo)` pode devolver uma resposta
 * {status, json} para simular erro num passo. Rota que não existe responde 404
 * JSON:API — nunca um sucesso por omissão.
 * `estado.status` é o status do envelope (draft → running na ativação);
 * `eventos` e `arquivos` (links.files do documento) são o que o GET devolve. */
export const PDF_ASSINADO = "%PDF-1.4 contrato assinado de teste";
export function clicksignFalso({ base = "https://sandbox.clicksign.com", falhar = () => null, eventos = [], arquivos, status } = {}) {
  const raiz = base + "/api/v3";
  const chamadas = [], estado = { status: status || "draft", signers: [], baixados: 0, apagado: false };
  let seq = 0;
  const ok = (status, data) => ({ status, json: { data } });
  const erro = (status, title) => ({ status, json: { errors: [{ title, detail: "", code: String(status), status: String(status) }] } });
  function rota(url, opt) {
    if (url === "https://s3.clicksign.falso/assinado.pdf") { estado.baixados++; return { buf: Buffer.from(PDF_ASSINADO, "utf8"), mime: "application/pdf" }; }
    if (!url.startsWith(raiz + "/")) return null;
    const metodo = String(opt.method || "get").toUpperCase(), caminho = url.slice(raiz.length);
    const corpo = typeof opt.payload === "string" ? JSON.parse(opt.payload) : null;
    chamadas.push({ metodo, caminho, corpo, headers: Object.assign({}, opt.headers), contentType: opt.contentType });
    const f = falhar(metodo, caminho, corpo);
    if (f) return f;
    if (metodo === "GET" && caminho.startsWith("/envelopes?")) return ok(200, []);
    const env = /^\/envelopes\/([^/]+)/.exec(caminho);
    if (metodo === "POST" && caminho === "/envelopes") {
      Object.assign(estado, { status: "draft", apagado: false, signers: [] });
      return ok(201, { id: "env-1", type: "envelopes", attributes: { status: "draft", name: corpo.data.attributes.name } });
    }
    if (!env || env[1] !== "env-1" || estado.apagado) return erro(404, "Registro não encontrado");
    /* só rascunho pode ser apagado; a resposta é 204 sem corpo */
    if (metodo === "DELETE" && caminho === env[0]) {
      if (estado.status !== "draft") return erro(422, "Somente envelopes em rascunho podem ser excluídos");
      estado.apagado = true;
      return { status: 204, texto: "" };
    }
    const resto = caminho.slice(env[0].length);
    if (metodo === "POST" && resto === "/documents") return ok(201, { id: "doc-1", type: "documents", attributes: { status: "draft", filename: corpo.data.attributes.filename } });
    if (metodo === "POST" && resto === "/signers") {
      const s = { id: "sig-" + (++seq), type: "signers", attributes: Object.assign({}, corpo.data.attributes) };
      estado.signers.push(s);
      return ok(201, s);
    }
    if (metodo === "POST" && resto === "/requirements") return ok(201, { id: "req-" + (++seq), type: "requirements", attributes: corpo.data.attributes });
    if (metodo === "PATCH" && resto === "") { estado.status = corpo.data.attributes.status; return ok(200, { id: "env-1", type: "envelopes", attributes: { status: estado.status } }); }
    if (metodo === "POST" && resto === "/notifications") return ok(201, { id: "not-1", type: "notifications", attributes: { summary: [] } });
    if (metodo === "GET" && resto === "") return ok(200, { id: "env-1", type: "envelopes", attributes: { status: estado.status } });
    if (metodo === "GET" && resto === "/documents")
      return ok(200, [{ id: "doc-1", type: "documents", links: { files: arquivos || { original: "https://s3.clicksign.falso/original.pdf" } }, attributes: { status: estado.status } }]);
    if (metodo === "GET" && resto === "/documents/doc-1/events") return ok(200, eventos);
    if (metodo === "GET" && resto === "/signers") return ok(200, estado.signers);
    return erro(404, "rota falsa inexistente");
  }
  return { rota, chamadas, estado };
}

/* DocumentApp / DriveApp / Drive falsos, no mesmo rigor do Apps Script real:
   - Body.replaceText(regex, substituto): substituto LITERAL (como o Docs real: "R$" sai "R$", barra sai barra);
   - Paragraph.removeFromParent() lança no último parágrafo do corpo;
   - o PDF exportado é o conteúdo SALVO (saveAndClose), não o que ainda está aberto;
   - `Drive` (serviço avançado) só existe com avancado: true; Drive.Files.remove apaga de vez (opções guardadas em estado.opcoesRemocao);
   - findText(padrao, desde?) no corpo/cabeçalho/rodapé devolve RangeElement (getElement().asText(), getStartOffset,
     getEndOffsetInclusive); Text.insertText/deleteText/setBackgroundColor(ini, fim, cor|null) mexem no fundo por caractere,
     e o texto inserido herda o fundo do caractere vizinho (como o Docs). saveAndClose guarda os grifos em salvos[id].grifos;
   - Folder.createFile(blob) cria o arquivo (estado.naPasta) com getUrl(). */
export function driveFalso({ modelos = {}, avancado = true, falhaAbrir = null, cabecalhos = {}, realce = false } = {}) {
  const docs = {}, soltos = {};
  const estado = { copias: [], removidas: [], lixeira: [], exportados: [], abertos: [], opcoesRemocao: [], salvos: {}, naPasta: [] };
  let seq = 0;
  /* parágrafo = { texto, fundo }: fundo é a cor de fundo de CADA caractere (null = nenhuma).
     realce: true imita o modelo antigo, com os marcadores {{X}} realçados em amarelo. */
  const REALCE = "#FFFF00";
  const par = (t) => {
    const p = { texto: String(t), fundo: Array(String(t).length).fill(null) };
    if (realce) for (const m of p.texto.matchAll(/\{\{[^{}]*\}\}/g)) p.fundo.fill(REALCE, m.index, m.index + m[0].length);
    return p;
  };
  const clonar = (p) => ({ texto: p.texto, fundo: p.fundo.slice() });
  for (const [id, linhas] of Object.entries(modelos)) {
    const cab = {};
    for (const [k, v] of Object.entries(cabecalhos[id] || {})) if (typeof v === "string") cab[k] = par(v);
    docs[id] = { pars: linhas.map(par), aberto: false, cab };
    docs[id].salvoP = docs[id].pars.map(clonar);
    docs[id].salvo = linhas.slice();
  }
  /* Body/Paragraph/Section.replaceText: substituto LITERAL; o trecho novo herda o fundo do 1º caractere casado */
  const trocar = (p, padrao, rep) => {
    let out = "", f = [], ult = 0;
    for (const m of p.texto.matchAll(new RegExp(padrao, "g"))) {
      out += p.texto.slice(ult, m.index); f.push(...p.fundo.slice(ult, m.index));
      out += rep; f.push(...Array(rep.length).fill(m[0].length ? p.fundo[m.index] : null));
      ult = m.index + m[0].length;
    }
    p.texto = out + p.texto.slice(ult); p.fundo = f.concat(p.fundo.slice(ult));
  };
  /* Text (editAsText / RangeElement.getElement().asText()) sobre um parágrafo */
  const faixa = (p, ini, fim) => { if (!(ini >= 0 && fim < p.texto.length && fim >= ini)) throw new Error("Invalid range " + ini + "-" + fim); };
  const Texto = (p, vivo) => {
    const t = {
      asText: () => t, getText: () => p.texto,
      insertText: (off, s) => {
        vivo(); s = String(s);
        if (!(off >= 0 && off <= p.texto.length)) throw new Error("Invalid offset " + off);
        const cor = off > 0 ? p.fundo[off - 1] : (p.fundo.length ? p.fundo[0] : null);   // herda o fundo vizinho, como o Docs
        p.texto = p.texto.slice(0, off) + s + p.texto.slice(off);
        p.fundo.splice(off, 0, ...Array(s.length).fill(cor));
        return t;
      },
      deleteText: (ini, fim) => { vivo(); faixa(p, ini, fim); p.texto = p.texto.slice(0, ini) + p.texto.slice(fim + 1); p.fundo.splice(ini, fim - ini + 1); return t; },
      setBackgroundColor: (ini, fim, cor) => { vivo(); faixa(p, ini, fim); p.fundo.fill(cor === undefined ? null : cor, ini, fim + 1); return t; },
      setBold: (ini, fim, b) => { vivo(); faixa(p, ini, fim); (p.negrito = p.negrito || []).push([ini, fim, b]); return t; },
    };
    return t;
  };
  /* findText(padrao, desde?) numa lista de parágrafos: RangeElement do 1º trecho depois de `desde` */
  const achar = (lista, vivo, padrao, desde) => {
    vivo();
    let i0 = 0, pos = 0;
    if (desde) { i0 = lista().indexOf(desde._p); pos = desde.getEndOffsetInclusive() + 1; if (i0 < 0) i0 = 0; }
    const ps = lista();
    for (let i = i0; i < ps.length; i++) {
      const re = new RegExp(padrao, "g"); re.lastIndex = i === i0 ? pos : 0;
      const m = re.exec(ps[i].texto);
      if (m && m[0].length) {
        const p = ps[i], ini = m.index, fim = m.index + m[0].length - 1;
        return { _p: p, getElement: () => Texto(p, vivo), getStartOffset: () => ini, getEndOffsetInclusive: () => fim, isPartial: () => true };
      }
    }
    return null;
  };
  /* trechos com fundo (cor não nula) de um parágrafo: [{ trecho, cor }] */
  const trechos = (p) => {
    const r = [];
    for (let i = 0; i < p.texto.length; i++) {
      const c = p.fundo[i];
      if (!c) continue;
      const u = r[r.length - 1];
      if (u && u.cor === c && u.fim === i - 1) { u.trecho += p.texto[i]; u.fim = i; } else r.push({ trecho: p.texto[i], cor: c, fim: i });
    }
    return r.map(({ trecho, cor }) => ({ trecho, cor }));
  };
  /* cabeçalho/rodapé: null quando o documento não tem (como no Apps Script) */
  const secao = (d, k) => {
    if (!d.aberto) throw new Error("Document is closed");
    if (!d.cab[k]) return null;
    const vivo = () => { if (!d.aberto) throw new Error("Document is closed"); };
    return { getText: () => d.cab[k].texto, replaceText: (padrao, rep) => { vivo(); trocar(d.cab[k], padrao, rep); },
             findText: (padrao, desde) => achar(() => [d.cab[k]], vivo, padrao, desde) };
  };
  function docAberto(id) {
    const d = docs[id];
    const vivo = () => { if (!d.aberto) throw new Error("Document is closed"); };
    const noCorpo = (p) => { vivo(); return d.pars.indexOf(p); };
    /* cópia solta (Paragraph.copy): fora do documento até insertParagraph */
    const Solto = (p) => ({ _solto: p, copy: () => Solto(clonar(p)), getText: () => p.texto });
    /* o "pai" (Body ou TableCell): aqui o corpo é uma lista plana de parágrafos */
    const pai = {
      getChildIndex: (par) => { const i = noCorpo(par._p); if (i < 0) throw new Error("Element not in body"); return i; },
      insertParagraph: (i, solto) => {
        vivo();
        if (!solto || !solto._solto) throw new Error("insertParagraph precisa de um parágrafo solto (copy())");
        const novo = clonar(solto._solto);
        d.pars.splice(i, 0, novo);
        return pp(novo);
      },
    };
    const Par = (p) => ({
      _p: p,
      getText: () => p.texto, setText: (t) => { noCorpo(p); p.texto = String(t); p.fundo = Array(p.texto.length).fill(null); },
      getParent: () => { noCorpo(p); return pai; },
      copy: () => Solto(clonar(p)),
      replaceText: (padrao, rep) => { noCorpo(p); trocar(p, padrao, rep); },
      editAsText: () => { noCorpo(p); return Texto(p, () => { if (noCorpo(p) < 0) throw new Error("Element not in body"); }); },
      removeFromParent: () => {
        const i = noCorpo(p);
        if (i < 0) throw new Error("Element not in body");
        if (i === d.pars.length - 1) throw new Error("Can't remove the last paragraph in a document section");
        d.pars.splice(i, 1);
      },
    });
    const cache = new Map();
    const pp = (p) => { if (!cache.has(p)) cache.set(p, Par(p)); return cache.get(p); };
    return {
      getBody: () => {
        vivo();
        return {
          getParagraphs: () => d.pars.map(pp),
          getText: () => d.pars.map((p) => p.texto).join("\n"),
          replaceText: (padrao, rep) => { vivo(); d.pars.forEach((p) => trocar(p, padrao, rep)); },
          findText: (padrao, desde) => achar(() => d.pars, vivo, padrao, desde),
        };
      },
      getHeader: () => secao(d, "header"),
      getFooter: () => secao(d, "footer"),
      saveAndClose: () => {
        d.salvo = d.pars.map((p) => p.texto); d.salvoP = d.pars.map(clonar); d.aberto = false;
        const cab = {}, grifos = [];
        d.pars.forEach((p, i) => trechos(p).forEach((x) => grifos.push(Object.assign({ onde: "corpo", par: i }, x))));
        for (const [k, p] of Object.entries(d.cab)) { cab[k] = p.texto; trechos(p).forEach((x) => grifos.push(Object.assign({ onde: k, par: 0 }, x))); }
        estado.salvos[id] = { pars: d.salvo.slice(), cab,
          /* trechos em negrito (editAsText().setBold) por parágrafo: [{ texto, negrito: [[ini, fim, b]] }] */
          negritos: d.pars.filter((p) => p.negrito).map((p) => ({ texto: p.texto, negrito: p.negrito.slice() })),
          /* trechos com fundo colorido, na ordem do documento: [{ onde, par, trecho, cor }] */
          grifos };
      },
    };
  }
  const arquivo = (id) => {
    if (soltos[id]) return { getId: () => id, getName: () => soltos[id].nome, getUrl: () => soltos[id].url,
                             getSize: () => (soltos[id].buf || Buffer.alloc(0)).length,
                             getBlob: () => blob(soltos[id].buf || Buffer.alloc(0), "application/pdf", soltos[id].nome),
                             setTrashed: (b) => { if (b) estado.lixeira.push(id); } };
    if (!docs[id]) throw new Error("File not found: " + id);
    return {
      getId: () => id,
      makeCopy: (nome, pasta) => {
        if (!pasta || !pasta.getId) throw new Error("makeCopy precisa de (nome, pasta)");
        const novo = "copia-" + (++seq);
        const cab = {};
        for (const [k, p] of Object.entries(docs[id].cab || {})) cab[k] = clonar(p);
        docs[novo] = { pars: docs[id].salvoP.map(clonar), salvo: docs[id].salvo.slice(), salvoP: docs[id].salvoP.map(clonar), aberto: false, cab };
        estado.copias.push({ id: novo, nome, pasta: pasta.getId() });
        return arquivo(novo);
      },
      getAs: (mime) => {
        if (mime !== "application/pdf") throw new Error("mime não previsto: " + mime);
        estado.exportados.push(id);
        return blob(Buffer.from(docs[id].salvo.join("\n"), "utf8"), "application/pdf", "contrato.pdf");
      },
      setTrashed: (b) => { if (b) estado.lixeira.push(id); },
    };
  };
  /* Folder.createFile(blob): o arquivo ganha o nome do blob; fica em estado.naPasta */
  const pasta = (pid) => ({
    getId: () => pid,
    createFile: (b) => {
      if (!b || !b.getBytes) throw new Error("createFile precisa de um blob");
      const id = "arq-" + (++seq), url = "https://drive.falso/file/d/" + id;
      soltos[id] = { nome: b.getName(), url, pasta: pid, buf: b._buf };
      estado.naPasta.push({ id, nome: b.getName(), pasta: pid, url });
      return arquivo(id);
    },
  });
  const extras = {
    DocumentApp: { openById: (id) => {
      if (falhaAbrir) throw new Error(falhaAbrir);
      if (!docs[id]) throw new Error("Document not found");
      docs[id].aberto = true; estado.abertos.push(id);
      return docAberto(id);
    } },
    DriveApp: { getFileById: arquivo, getFolderById: pasta },
  };
  if (avancado) extras.Drive = { Files: { remove: (id, opc) => {
    if (soltos[id]) delete soltos[id];
    else if (docs[id]) delete docs[id];
    else throw new Error("File not found: " + id);
    estado.removidas.push(id); estado.opcoesRemocao.push(opc);
  } } };
  /* zera os registros (não os documentos): usado entre o pré-contrato e a aprovação nos testes antigos */
  const zerar = () => { for (const k of ["copias", "removidas", "lixeira", "exportados", "abertos", "opcoesRemocao", "naPasta"]) estado[k].length = 0; };
  return { extras, estado, docs, soltos, zerar };
}
