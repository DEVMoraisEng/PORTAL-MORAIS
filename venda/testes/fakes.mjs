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
  return { getBytes: () => comSinal(buf), getDataAsString: () => buf.toString("utf8"),
           getContentType: () => mime, getName: () => nome, _buf: buf };
}

export function criarGas({ props, rotas, extras = {} }) {
  const cache = new Map(), chamadas = [], logs = [];
  const ctx = {
    console: { log: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push(a.join(" ")) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (n) => (n in props ? props[n] : null) }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (cache.has(k) ? cache.get(k) : null),
                                             put: (k, v) => { if (String(v).length > 100000) throw new Error("Argument too large: value"); cache.set(k, v); },
                                             remove: (k) => cache.delete(k) }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (t) => ({ setMimeType: () => ({ texto: t }) }) },
    Utilities: {
      base64EncodeWebSafe: (x) => b64ws(paraBuf(x)),
      base64DecodeWebSafe: (s) => comSinal(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64")),
      base64Encode: (x) => paraBuf(x).toString("base64"),
      base64Decode: (s) => comSinal(Buffer.from(s, "base64")),
      computeHmacSha256Signature: (valor, chave) => comSinal(crypto.createHmac("sha256", chave).update(valor).digest()),
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
  for (const f of ["RegrasVenda.js", "ClaudeLeitor.js", "OpenAILeitor.js", "ContratoVenda.js", "PortalVenda.gs", "GerarContrato.gs"])
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
                              paginasExtras = {}, bases = {} } = {}) {
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
        return { json: { id: u.slice(7), parent: { database_id: "db-extra" }, properties: tipar(paginasExtras[u.slice(7)]) } };
      const q = /^\/databases\/([^/]+)\/query$/.exec(u);
      if (m === "POST" && q && bases[q[1]]) return { json: { results: bases[q[1]].map((p, i) => ({ id: "linha-" + i, properties: tipar(p) })), has_more: false } };
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

/* DocumentApp / DriveApp / Drive falsos, no mesmo rigor do Apps Script real:
   - Body.replaceText(regex, substituto): substituto literal salvo `\x` e `$n` (um `$` solto lança);
   - Paragraph.removeFromParent() lança no último parágrafo do corpo;
   - o PDF exportado é o conteúdo SALVO (saveAndClose), não o que ainda está aberto;
   - `Drive` (serviço avançado) só existe com avancado: true; Drive.Files.remove apaga de vez. */
export function driveFalso({ modelos = {}, avancado = true, falhaAbrir = null } = {}) {
  const docs = {};
  const estado = { copias: [], removidas: [], lixeira: [], exportados: [], abertos: [] };
  let seq = 0;
  const par = (t) => ({ texto: t });
  for (const [id, linhas] of Object.entries(modelos)) docs[id] = { pars: linhas.map(par), salvo: linhas.slice(), aberto: false };
  const substituto = (rep, m) => {
    let s = "";
    for (let i = 0; i < rep.length; i++) {
      const c = rep[i];
      if (c === "\\") { i++; if (i >= rep.length) throw new Error("Character to be escaped is missing"); s += rep[i]; }
      else if (c === "$") {
        i++;
        if (!/\d/.test(rep[i] || "")) throw new Error("Illegal group reference");
        const g = m[Number(rep[i])];
        if (g === undefined) throw new Error("No group " + rep[i]);
        s += g;
      } else s += c;
    }
    return s;
  };
  function docAberto(id) {
    const d = docs[id];
    const noCorpo = (p) => { if (!d.aberto) throw new Error("Document is closed"); return d.pars.indexOf(p); };
    const Par = (p) => ({
      getText: () => p.texto, setText: (t) => { noCorpo(p); p.texto = String(t); },
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
        if (!d.aberto) throw new Error("Document is closed");
        return {
          getParagraphs: () => d.pars.map(pp),
          getText: () => d.pars.map((p) => p.texto).join("\n"),
          replaceText: (padrao, rep) => {
            const re = new RegExp(padrao, "g");
            d.pars.forEach((p) => { p.texto = p.texto.replace(re, (...a) => substituto(rep, a)); });
          },
        };
      },
      saveAndClose: () => { d.salvo = d.pars.map((p) => p.texto); d.aberto = false; },
    };
  }
  const arquivo = (id) => {
    if (!docs[id]) throw new Error("File not found: " + id);
    return {
      getId: () => id,
      makeCopy: (nome, pasta) => {
        if (!pasta || !pasta.getId) throw new Error("makeCopy precisa de (nome, pasta)");
        const novo = "copia-" + (++seq);
        docs[novo] = { pars: docs[id].salvo.map(par), salvo: docs[id].salvo.slice(), aberto: false };
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
  const extras = {
    DocumentApp: { openById: (id) => {
      if (falhaAbrir) throw new Error(falhaAbrir);
      if (!docs[id]) throw new Error("Document not found");
      docs[id].aberto = true; estado.abertos.push(id);
      return docAberto(id);
    } },
    DriveApp: { getFileById: arquivo, getFolderById: (id) => ({ getId: () => id }) },
  };
  if (avancado) extras.Drive = { Files: { remove: (id) => { if (!docs[id]) throw new Error("File not found: " + id); delete docs[id]; estado.removidas.push(id); } } };
  return { extras, estado, docs };
}
