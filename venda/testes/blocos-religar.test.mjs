/* 06/11/2026: a janela do termo nas Propostas reaproveita o mesmo elemento para outro conjunto de blocos. Os ouvintes
 * têm de ser do conjunto atual — antes o primeiro ficava ligado, o novo não, e "Salvar valor"/"Salvar conta" não
 * faziam nada. Confere no código (criarBlocosVenda não sai do navegador). */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const src = fs.readFileSync(new URL("../../venda-dossie.js", import.meta.url), "utf8");
const anexar = src.slice(src.indexOf("eu.anexar = function (el) {"), src.indexOf("eu.anexar = function (el) {") + 4000);

test("cada conjunto de blocos liga os próprios ouvintes no elemento e os do anterior ficam mudos", () => {
  assert.match(anexar, /if \(el\.__vbLigado !== eu\) \{\s*(\/\*[\s\S]*?\*\/\s*)?el\.__vbLigado = eu;/);
  assert.doesNotMatch(anexar, /el\.__vbLigado = true/);
  assert.match(anexar, /addEventListener\("click", function \(ev\) \{ if \(raiz === el && el\.__vbLigado === eu\) aoClicar\(ev\); \}\)/);
  for (const ev of ["input", "focusout", "change"]) {
    const i = anexar.indexOf('addEventListener("' + ev + '"');
    assert.ok(i > 0, ev);
    assert.match(anexar.slice(i, i + 300), /raiz !== el \|\| el\.__vbLigado !== eu/, ev);
  }
});
