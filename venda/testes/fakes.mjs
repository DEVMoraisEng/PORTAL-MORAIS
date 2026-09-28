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

export function criarGas({ props, rotas }) {
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
  vm.createContext(ctx);
  for (const f of ["RegrasVenda.js", "ClaudeLeitor.js", "OpenAILeitor.js", "PortalVenda.gs"])
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
const vazioDe = (t) => ({ [t]: t === "files" || t === "rich_text" || t === "title" ? [] : null });

/* Página id no formato que PortalVenda.gs exige (32 hex, sem hífen) e o
   database_id "de fábrica" que a página falsa diz ter como parent. */
export const PAGE_ID_PADRAO = "0123456789abcdef0123456789abcdef";
export const DB_ID_PADRAO = "db-falso";

/* Notion falso: uma base (as colunas acima, ou `colunas`) e uma página
   (PAGE_ID_PADRAO por padrão, ou `pageId`), com `parent.database_id` = `dbId`. */
export function notionFalso({ valores = {}, s3 = {}, colunas = COLUNAS_REAIS, pageId = PAGE_ID_PADRAO, dbId = DB_ID_PADRAO } = {}) {
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
