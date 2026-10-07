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
   - Body.replaceText(regex, substituto): substituto literal salvo `\x` e `$n` (um `$` solto lança);
   - Paragraph.removeFromParent() lança no último parágrafo do corpo;
   - o PDF exportado é o conteúdo SALVO (saveAndClose), não o que ainda está aberto;
   - `Drive` (serviço avançado) só existe com avancado: true; Drive.Files.remove apaga de vez (opções guardadas em estado.opcoesRemocao). */
export function driveFalso({ modelos = {}, avancado = true, falhaAbrir = null, cabecalhos = {} } = {}) {
  const docs = {};
  const estado = { copias: [], removidas: [], lixeira: [], exportados: [], abertos: [], opcoesRemocao: [], salvos: {} };
  let seq = 0;
  const par = (t) => ({ texto: t });
  for (const [id, linhas] of Object.entries(modelos)) docs[id] = { pars: linhas.map(par), salvo: linhas.slice(), aberto: false, cab: cabecalhos[id] || {} };
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
  /* cabeçalho/rodapé: null quando o documento não tem (como no Apps Script) */
  const secao = (d, k) => {
    if (!d.aberto) throw new Error("Document is closed");
    if (typeof d.cab[k] !== "string") return null;
    return { getText: () => d.cab[k], replaceText: (padrao, rep) => { d.cab[k] = d.cab[k].replace(new RegExp(padrao, "g"), (...a) => substituto(rep, a)); } };
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
      getHeader: () => secao(d, "header"),
      getFooter: () => secao(d, "footer"),
      saveAndClose: () => { d.salvo = d.pars.map((p) => p.texto); d.aberto = false; estado.salvos[id] = { pars: d.salvo.slice(), cab: JSON.parse(JSON.stringify(d.cab)) }; },
    };
  }
  const arquivo = (id) => {
    if (!docs[id]) throw new Error("File not found: " + id);
    return {
      getId: () => id,
      makeCopy: (nome, pasta) => {
        if (!pasta || !pasta.getId) throw new Error("makeCopy precisa de (nome, pasta)");
        const novo = "copia-" + (++seq);
        docs[novo] = { pars: docs[id].salvo.map(par), salvo: docs[id].salvo.slice(), aberto: false, cab: JSON.parse(JSON.stringify(docs[id].cab || {})) };
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
  if (avancado) extras.Drive = { Files: { remove: (id, opc) => { if (!docs[id]) throw new Error("File not found: " + id); delete docs[id]; estado.removidas.push(id); estado.opcoesRemocao.push(opc); } } };
  return { extras, estado, docs };
}
