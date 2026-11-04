/* escritorio-3d.js · PORTAL-MORAIS — 03/11/2026
 * A sala 3D do Escritório de Robôs (escritorio-robos.html). Three.js r128 (global THREE) + OrbitControls.
 *
 *   Escritorio3D.iniciar(caixa)          monta a sala dentro de <div id="sala3d"> (false se não houver WebGL)
 *   Escritorio3D.atualizar(robos, op)    robôs vindos do montarRobos() da página; op = { podeRodar(r), rodar(r),
 *                                        abrir(chave), causa(r) }
 *
 * Cada robô tem a sua mesa com PC. Estados (r.st) e o que acontece na mesa:
 *   ok       olhos verdes, respira e olha em volta de vez em quando
 *   trab     digita (braços), tela com linhas correndo, engrenagem girando em cima, antena azul piscando
 *   erro     sirene vermelha girando na cabeça, "!" pulando, balança a cabeça, tela vermelha piscando,
 *            e um BALÃO na tela com a causa e os botões Ver relatório / Rodar de novo
 *   off      cabeça baixa, olhos apagados, "Zzz" subindo
 *   pedido   pediram "Rodar de novo": antena amarela, tela "na fila"
 * Arte toda original (caixas, cilindros e esferas) — nada de personagem conhecido.
 */
(function () {
  "use strict";
  const T = window.THREE;
  const COR_ST = { ok: "#2ecc71", erro: "#ff4d3d", trab: "#46a6ff", off: "#5d6d78", sem: "#9fb4c0", pedido: "#f5c542" };
  const TELA_FUNDO = { ok: ["#123826", "#0b2419"], erro: ["#5a1611", "#2e0c09"], trab: ["#10314a", "#0a1f30"],
                       off: ["#10171c", "#0b1013"], sem: ["#1a2731", "#121c23"], pedido: ["#3d3210", "#241d08"] };
  const ROTULO_TELA = { ok: "OK", erro: "ERRO", trab: "RODANDO", off: "DESLIGADO", sem: "—", pedido: "NA FILA" };

  let R = null;            // estado da sala

  /* ------------------------------------------------------------ utilidades */
  function escuro() { return document.documentElement.dataset.tema === "escuro"; }
  function mat(cor, extra) { return new T.MeshStandardMaterial(Object.assign({ color: cor, roughness: 0.78, metalness: 0.05 }, extra || {})); }
  function caixa(w, h, d, m) { const x = new T.Mesh(new T.BoxGeometry(w, h, d), m); x.castShadow = true; x.receiveShadow = true; return x; }
  function cil(rt, rb, h, m, seg) { const x = new T.Mesh(new T.CylinderGeometry(rt, rb, h, seg || 20), m); x.castShadow = true; x.receiveShadow = true; return x; }
  function esf(r, m) { const x = new T.Mesh(new T.SphereGeometry(r, 18, 14), m); x.castShadow = true; return x; }
  function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function retRed(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function textura(c) { const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 4; return t; }
  function corta(g, txt, max) { txt = String(txt || ""); if (g.measureText(txt).width <= max) return txt; while (txt.length > 1 && g.measureText(txt + "…").width > max) txt = txt.slice(0, -1); return txt + "…"; }
  const FONTE = "Inter, 'Segoe UI', Roboto, Arial, sans-serif";

  /* ------------------------------------------------------------ texturas desenhadas */
  function texPiso() {
    const c = canvas(512, 512), g = c.getContext("2d");
    const base = escuro() ? ["#3b2c22", "#33261d", "#402f24"] : ["#c9a27a", "#bf9670", "#d0aa83"];
    for (let i = 0; i < 8; i++) {
      g.fillStyle = base[i % 3]; g.fillRect(0, i * 64, 512, 64);
      g.fillStyle = "rgba(0,0,0,.12)"; g.fillRect(0, i * 64, 512, 2);
      const off = (i * 173) % 512; g.fillRect(off, i * 64, 2, 64); g.fillRect((off + 256) % 512, i * 64, 2, 64);
    }
    const t = textura(c); t.wrapS = t.wrapT = T.RepeatWrapping; return t;
  }
  function texQuadro(titulo, sub) {
    const c = canvas(1024, 256), g = c.getContext("2d");
    const gr = g.createLinearGradient(0, 0, 1024, 0); gr.addColorStop(0, "#1e3f58"); gr.addColorStop(1, "#295778");
    g.fillStyle = gr; retRed(g, 0, 0, 1024, 256, 26); g.fill();
    g.fillStyle = "#4cd964"; g.fillRect(40, 196, 944, 8); g.fillStyle = "#8FDCD2"; g.fillRect(500, 196, 484, 8);
    g.fillStyle = "#fff"; g.font = "800 86px " + FONTE; g.textBaseline = "middle"; g.fillText(titulo, 48, 92);
    g.fillStyle = "#8FDCD2"; g.font = "700 34px " + FONTE; g.fillText(sub, 52, 156);
    return textura(c);
  }
  function desenharRelogio(c) {
    const g = c.getContext("2d"), d = new Date(), W = c.width;
    g.clearRect(0, 0, W, W);
    g.fillStyle = "#fff"; g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 6, 0, 7); g.fill();
    g.lineWidth = 12; g.strokeStyle = "#24313b"; g.stroke();
    g.fillStyle = "#24313b";
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.fillRect(W / 2 + Math.sin(a) * (W / 2 - 30) - 4, W / 2 - Math.cos(a) * (W / 2 - 30) - 4, 8, 8); }
    const ponteiro = (a, l, w) => { g.save(); g.translate(W / 2, W / 2); g.rotate(a); g.fillRect(-w / 2, -l, w, l); g.restore(); };
    ponteiro((d.getHours() % 12 + d.getMinutes() / 60) / 12 * Math.PI * 2, W * 0.24, 12);
    ponteiro(d.getMinutes() / 60 * Math.PI * 2, W * 0.36, 8);
    g.fillStyle = "#d64534"; g.beginPath(); g.arc(W / 2, W / 2, 10, 0, 7); g.fill();
  }
  function desenharLousa(c, linhas) {
    const g = c.getContext("2d");
    g.fillStyle = "#f7fbfc"; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#1e3f58"; g.font = "800 44px " + FONTE; g.fillText("HOJE NO ESCRITÓRIO", 30, 64);
    g.font = "600 36px " + FONTE;
    (linhas || []).forEach((l, i) => { g.fillStyle = l.cor || "#33536a"; g.fillText(l.t, 34, 130 + i * 54); });
  }
  function desenharTela(c, st, ico, hora, fase) {
    const g = c.getContext("2d"), W = c.width, H = c.height;
    const [a, b] = TELA_FUNDO[st] || TELA_FUNDO.sem;
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, a); gr.addColorStop(1, b);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    if (st === "trab") {                                   // linhas de código correndo
      g.fillStyle = "rgba(143,220,210,.75)";
      for (let i = 0; i < 9; i++) {
        const y = ((i * 22 - fase * 40) % (H + 22) + H + 22) % (H + 22) - 10;
        g.fillRect(18 + (i % 3) * 14, y, 80 + ((i * 53) % 150), 7);
      }
      g.fillStyle = "rgba(10,31,48,.85)"; retRed(g, W / 2 - 110, H / 2 - 30, 220, 60, 10); g.fill();
    }
    if (st === "erro" && Math.floor(fase * 2) % 2) { g.strokeStyle = "#ff4d3d"; g.lineWidth = 14; g.strokeRect(7, 7, W - 14, H - 14); }
    g.textAlign = "center"; g.textBaseline = "middle";
    if (st !== "trab") { g.font = "64px " + FONTE; g.fillText(ico || "🤖", W / 2, H * 0.32); }
    g.fillStyle = st === "off" ? "#8aa0ad" : "#fff"; g.font = "800 46px " + FONTE;
    g.fillText(ROTULO_TELA[st] || "—", W / 2, st === "trab" ? H / 2 : H * 0.64);
    if (hora && st !== "trab") { g.fillStyle = "rgba(255,255,255,.72)"; g.font = "600 26px " + FONTE; g.fillText(hora, W / 2, H * 0.84); }
  }
  function desenharPlaca(c, nome, stTexto, st) {
    const g = c.getContext("2d"), W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = escuro() ? "rgba(21,34,44,.94)" : "rgba(255,255,255,.95)"; retRed(g, 4, 4, W - 8, H - 8, 30); g.fill();
    g.lineWidth = 4; g.strokeStyle = COR_ST[st] || "#9fb4c0"; g.stroke();
    g.fillStyle = COR_ST[st] || "#9fb4c0"; g.beginPath(); g.arc(44, H / 2, 14, 0, 7); g.fill();
    g.textBaseline = "middle"; g.fillStyle = escuro() ? "#e7eff5" : "#1a3347"; g.font = "800 40px " + FONTE;
    g.fillText(corta(g, nome, W - 90), 72, H * 0.36);
    g.fillStyle = escuro() ? "#9db4c4" : "#5a8099"; g.font = "600 30px " + FONTE;
    g.fillText(corta(g, stTexto, W - 90), 72, H * 0.72);
  }
  function spriteTexto(txt, cor, tam) {
    const c = canvas(128, 128), g = c.getContext("2d");
    g.font = "800 " + (tam || 96) + "px " + FONTE; g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = 10; g.strokeStyle = "rgba(0,0,0,.35)"; g.strokeText(txt, 64, 68); g.fillStyle = cor; g.fillText(txt, 64, 68);
    const s = new T.Sprite(new T.SpriteMaterial({ map: textura(c), transparent: true, depthWrite: false }));
    return s;
  }

  /* ------------------------------------------------------------ peças da sala */
  function planta(esc) {
    const g = new T.Group();
    const vaso = cil(0.28, 0.22, 0.5, mat("#b7653f")); vaso.position.y = 0.25; g.add(vaso);
    const folha = mat("#3f9a5c", { flatShading: true });
    [[0, 0.85, 0, 0.42], [0.18, 1.15, 0.05, 0.3], [-0.16, 1.1, -0.06, 0.28], [0.02, 1.4, 0, 0.22]].forEach(([x, y, z, r]) => {
      const f = new T.Mesh(new T.IcosahedronGeometry(r, 0), folha); f.position.set(x, y, z); f.castShadow = true; g.add(f);
    });
    g.scale.setScalar(esc || 1); return g;
  }
  function bebedouro() {
    const g = new T.Group();
    const corpo = caixa(0.55, 1.1, 0.55, mat("#e8eef1")); corpo.position.y = 0.55; g.add(corpo);
    const galao = cil(0.24, 0.24, 0.6, mat("#7fc4ff", { transparent: true, opacity: 0.7, roughness: 0.2 })); galao.position.y = 1.42; g.add(galao);
    return g;
  }

  function roboMesh(cor) {
    const g = new T.Group();
    const mCor = mat(cor, { roughness: 0.55, metalness: 0.15 }), mEsc = mat("#0d1a22", { roughness: 0.4 });
    const corpo = cil(0.34, 0.4, 0.78, mCor); corpo.position.y = 0.39; g.add(corpo);
    const peito = caixa(0.3, 0.16, 0.05, mat("#ffffff", { transparent: true, opacity: 0.35 })); peito.position.set(0, 0.5, 0.36); g.add(peito);
    const cabeca = new T.Group(); cabeca.position.y = 1.05; g.add(cabeca);
    const cranio = caixa(0.86, 0.6, 0.6, mCor); cabeca.add(cranio);
    const visor = caixa(0.7, 0.34, 0.04, mEsc); visor.position.set(0, 0, 0.31); cabeca.add(visor);
    const mOlho = new T.MeshStandardMaterial({ color: "#2ecc71", emissive: "#2ecc71", emissiveIntensity: 1.2 });
    const olhoE = esf(0.075, mOlho), olhoD = esf(0.075, mOlho);
    olhoE.position.set(-0.17, 0, 0.34); olhoD.position.set(0.17, 0, 0.34); cabeca.add(olhoE, olhoD);
    [-0.47, 0.47].forEach(x => { const o = cil(0.08, 0.08, 0.1, mCor); o.rotation.z = Math.PI / 2; o.position.x = x; cabeca.add(o); });
    const haste = cil(0.025, 0.025, 0.3, mat("#2b3a44")); haste.position.y = 0.45; cabeca.add(haste);
    const mAntena = new T.MeshStandardMaterial({ color: "#2ecc71", emissive: "#2ecc71", emissiveIntensity: 1.4 });
    const antena = esf(0.07, mAntena); antena.position.y = 0.63; cabeca.add(antena);
    /* sirene (só aparece no erro) */
    const sirene = new T.Group(); sirene.position.y = 0.38; sirene.visible = false; cabeca.add(sirene);
    const cupula = cil(0.12, 0.16, 0.18, new T.MeshStandardMaterial({ color: "#ff3b2f", emissive: "#ff3b2f", emissiveIntensity: 1.6, transparent: true, opacity: 0.92 }));
    sirene.add(cupula);
    const facho = new T.Mesh(new T.ConeGeometry(0.5, 1.6, 16, 1, true), new T.MeshBasicMaterial({ color: "#ff3b2f", transparent: true, opacity: 0.16, depthWrite: false, side: T.DoubleSide }));
    facho.rotation.z = Math.PI / 2; facho.position.x = 0.8; sirene.add(facho);
    /* braços: pivô no ombro, mãos no teclado */
    const bracos = [-1, 1].map(lado => {
      const piv = new T.Group(); piv.position.set(lado * 0.42, 0.66, 0.05); g.add(piv);
      const b = caixa(0.14, 0.14, 0.62, mCor); b.position.set(0, -0.02, 0.3); piv.add(b);
      const mao = esf(0.09, mat("#2b3a44")); mao.position.set(0, -0.02, 0.62); piv.add(mao);
      piv.rotation.x = 0.35; return piv;
    });
    g.userData = { cabeca, olhos: mOlho, antena: mAntena, sirene, bracos, corpo };
    return g;
  }

  function mesaMesh(r, ehBalcao) {
    const g = new T.Group();
    const madeira = mat(escuro() ? "#8a6544" : "#c99a6b", { roughness: 0.65 });
    const pe = mat("#5b4632");
    const tampo = caixa(2.7, 0.12, 1.35, madeira); tampo.position.y = 1.0; g.add(tampo);
    if (ehBalcao) {
      const frente = caixa(2.7, 0.94, 0.08, mat(escuro() ? "#1e3f58" : "#295778")); frente.position.set(0, 0.5, 0.64); g.add(frente);
      const faixa = caixa(2.7, 0.06, 0.09, mat("#4cd964", { emissive: "#4cd964", emissiveIntensity: 0.4 })); faixa.position.set(0, 0.8, 0.65); g.add(faixa);
    } else {
      [[-1.25, -0.58], [1.25, -0.58], [-1.25, 0.58], [1.25, 0.58]].forEach(([x, z]) => { const l = caixa(0.09, 0.94, 0.09, pe); l.position.set(x, 0.47, z); g.add(l); });
    }
    /* monitor virado para a frente (o robô olha de lado) */
    const mon = new T.Group(); mon.position.set(-0.55, 1.06, 0.05); mon.rotation.y = 0.32; g.add(mon);
    const base = caixa(0.42, 0.04, 0.3, mat("#24313b")); mon.add(base);
    const haste = caixa(0.08, 0.34, 0.06, mat("#24313b")); haste.position.set(0, 0.19, -0.04); mon.add(haste);
    const moldura = caixa(1.34, 0.82, 0.07, mat("#1a242c", { roughness: 0.4 })); moldura.position.set(0, 0.74, 0); mon.add(moldura);
    const cTela = canvas(384, 224);
    const tTela = textura(cTela);
    const tela = new T.Mesh(new T.PlaneGeometry(1.22, 0.7), new T.MeshBasicMaterial({ map: tTela, toneMapped: false }));
    tela.position.set(0, 0.74, 0.037); mon.add(tela);
    const luz = new T.PointLight("#2ecc71", 0.35, 2.2); luz.position.set(0, 0.74, 0.5); mon.add(luz);
    const teclado = caixa(0.7, 0.04, 0.22, mat("#24313b")); teclado.position.set(0.35, 1.08, 0.3); g.add(teclado);
    const caneca = cil(0.07, 0.07, 0.16, mat(r.cat.cor)); caneca.position.set(1.05, 1.14, 0.25); g.add(caneca);
    /* cadeira + robô atrás da mesa */
    const cadeira = new T.Group(); cadeira.position.set(0.35, 0, -1.0); g.add(cadeira);
    const mCad = mat("#2c3e50");
    const assento = caixa(0.8, 0.1, 0.75, mCad); assento.position.y = 0.55; cadeira.add(assento);
    const encosto = caixa(0.8, 0.85, 0.1, mCad); encosto.position.set(0, 1.0, -0.36); cadeira.add(encosto);
    const coluna = cil(0.05, 0.05, 0.45, mat("#7f8c8d")); coluna.position.y = 0.28; cadeira.add(coluna);
    const robo = roboMesh(r.cat.cor); robo.position.set(0.35, 0.6, -0.78); robo.rotation.y = -0.25; g.add(robo);
    /* placa com nome e situação, em cima */
    const cPlaca = canvas(560, 150), tPlaca = textura(cPlaca);
    const placa = new T.Sprite(new T.SpriteMaterial({ map: tPlaca, transparent: true, depthWrite: false }));
    placa.scale.set(2.5, 0.67, 1); placa.position.set(0.1, 3.05, -0.4); placa.renderOrder = 5; g.add(placa);
    /* ícones flutuantes */
    const exc = spriteTexto("!", "#ff4d3d"); exc.scale.set(0.7, 0.7, 1); exc.position.set(0.35, 2.45, -0.78); exc.visible = false; g.add(exc);
    const zzz = spriteTexto("z", "#8aacbb", 80); zzz.scale.set(0.5, 0.5, 1); zzz.visible = false; g.add(zzz);
    const engr = spriteTexto("⚙", "#46a6ff", 104); engr.scale.set(0.62, 0.62, 1); engr.position.set(0.35, 2.4, -0.78); engr.visible = false; g.add(engr);
    const sireneLuz = new T.PointLight("#ff3b2f", 0, 5); sireneLuz.position.set(0.35, 2.1, -0.6); g.add(sireneLuz);
    /* tudo que é clicável aponta para a chave */
    g.traverse(o => { if (o.isMesh) o.userData.chave = r.chave; });
    g.userData = { chave: r.chave, robo, tela: { c: cTela, t: tTela }, placa: { c: cPlaca, t: tPlaca, obj: placa }, luz, exc, zzz, engr,
                   sireneLuz, tampo, fase: Math.random() * 10, st: null, ultTela: "" };
    return g;
  }

  /* ------------------------------------------------------------ montar a sala */
  function montarSala(robos) {
    const cena = R.cena;
    if (R.sala) { cena.remove(R.sala); R.sala.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { const ms = [].concat(o.material); ms.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } }); }
    const sala = new T.Group(); R.sala = sala; cena.add(sala);
    R.mesas = new Map();
    const rec = robos.filter(r => r.cat.recepcao), sal = robos.filter(r => !r.cat.recepcao);
    const cols = Math.max(2, Math.min(4, Math.ceil(Math.sqrt(Math.max(1, sal.length)) + 0.3)));
    const linhas = Math.max(1, Math.ceil(sal.length / cols));
    const DX = 4.3, DZ = 4.3;
    const W = Math.max(cols * DX + 4, 13), D = linhas * DZ + 7.5;
    R.tamanho = { W, D };
    /* piso, paredes, rodapé */
    const tp = texPiso(); tp.repeat.set(W / 4, D / 4);
    const piso = new T.Mesh(new T.PlaneGeometry(W, D), new T.MeshStandardMaterial({ map: tp, roughness: 0.85 }));
    piso.rotation.x = -Math.PI / 2; piso.receiveShadow = true; sala.add(piso);
    const corParede = escuro() ? "#1d2f3b" : "#e6eff2";
    const paredeF = caixa(W, 4.2, 0.2, mat(corParede)); paredeF.position.set(0, 2.1, -D / 2 - 0.1); paredeF.castShadow = false; sala.add(paredeF);
    const paredeE = caixa(0.2, 4.2, D, mat(corParede)); paredeE.position.set(-W / 2 - 0.1, 2.1, 0); paredeE.castShadow = false; sala.add(paredeE);
    const rodape = mat(escuro() ? "#0f1a22" : "#295778");
    const rf = caixa(W, 0.22, 0.24, rodape); rf.position.set(0, 0.11, -D / 2); sala.add(rf);
    const re = caixa(0.24, 0.22, D, rodape); re.position.set(-W / 2, 0.11, 0); sala.add(re);
    /* janelas na parede da esquerda */
    const nJan = Math.max(2, Math.floor(D / 4.5));
    for (let i = 0; i < nJan; i++) {
      const z = -D / 2 + (i + 0.5) * (D / nJan);
      const vidro = new T.Mesh(new T.PlaneGeometry(2.2, 1.9), new T.MeshBasicMaterial({ color: escuro() ? "#2b4e6a" : "#bfe6ff", toneMapped: false }));
      vidro.rotation.y = Math.PI / 2; vidro.position.set(-W / 2 + 0.01, 2.3, z); sala.add(vidro);
      const mold = mat("#f4f7f8");
      [[0.98, 0.08, 2.3], [-0.98, 0.08, 2.3], [0, 1.96, 0.06]].forEach(([dy, h, larg]) => {   // em cima, embaixo e o meio
        const p = caixa(0.06, h, larg, mold); p.position.set(-W / 2 + 0.04, 2.3 + dy, z); p.castShadow = false; sala.add(p);
      });
    }
    /* quadro com o nome, relógio e lousa na parede do fundo */
    const quadro = new T.Mesh(new T.PlaneGeometry(5.2, 1.3), new T.MeshBasicMaterial({ map: texQuadro("ESCRITÓRIO DE ROBÔS", "MORAIS ENGENHARIA · SERVIDOR"), toneMapped: false }));
    quadro.position.set(-W / 2 + 3.4, 3.0, -D / 2 + 0.01); sala.add(quadro);
    const cRel = canvas(256, 256); desenharRelogio(cRel); R.relogio = { c: cRel, t: textura(cRel) };
    const relogio = new T.Mesh(new T.CircleGeometry(0.55, 40), new T.MeshBasicMaterial({ map: R.relogio.t, toneMapped: false }));
    relogio.position.set(-W / 2 + 6.8, 3.15, -D / 2 + 0.02); sala.add(relogio);
    const cLousa = canvas(768, 420); R.lousa = { c: cLousa, t: textura(cLousa) }; desenharLousa(cLousa, []);
    const lousa = new T.Mesh(new T.PlaneGeometry(3.2, 1.75), new T.MeshBasicMaterial({ map: R.lousa.t, toneMapped: false }));
    lousa.position.set(Math.min(W / 2 - 2.2, -W / 2 + 10), 2.35, -D / 2 + 0.02); sala.add(lousa);
    const moldLousa = caixa(3.35, 1.9, 0.05, mat("#9aa9b2")); moldLousa.position.set(lousa.position.x, 2.35, -D / 2 - 0.005); moldLousa.castShadow = false; sala.add(moldLousa);
    /* plantas e bebedouro */
    const p1 = planta(1.2); p1.position.set(-W / 2 + 0.7, 0, -D / 2 + 0.7); sala.add(p1);
    const p2 = planta(1); p2.position.set(W / 2 - 0.7, 0, -D / 2 + 0.7); sala.add(p2);
    const p3 = planta(0.9); p3.position.set(-W / 2 + 0.7, 0, D / 2 - 0.8); sala.add(p3);
    const beb = bebedouro(); beb.position.set(-W / 2 + 0.6, 0, -D / 2 + 2.2); sala.add(beb);
    /* tapete da recepção */
    const tapete = new T.Mesh(new T.PlaneGeometry(Math.min(W - 2, 9.5), 3.2), mat(escuro() ? "#1f4150" : "#8fcfc6", { roughness: 1 }));
    tapete.rotation.x = -Math.PI / 2; tapete.position.set(W / 2 - Math.min(W - 2, 9.5) / 2 - 0.6, 0.012, D / 2 - 2.1); tapete.receiveShadow = true; sala.add(tapete);
    /* mesas do salão (grade) */
    sal.forEach((r, i) => {
      const c = i % cols, l = Math.floor(i / cols);
      const m = mesaMesh(r, false);
      m.position.set((c - (cols - 1) / 2) * DX, 0, -D / 2 + 3.0 + l * DZ);
      sala.add(m); R.mesas.set(r.chave, m);
    });
    /* recepção: balcões na frente, à direita */
    rec.forEach((r, i) => {
      const m = mesaMesh(r, true);
      m.position.set(W / 2 - 2.0 - i * 3.3, 0, D / 2 - 2.0);
      sala.add(m); R.mesas.set(r.chave, m);
    });
    /* câmera e luz do sol acompanham o tamanho da sala */
    const s = R.sol; s.position.set(-W * 0.6, 14, D * 0.25); s.target.position.set(0, 0, 0);
    const ext = Math.max(W, D) * 0.75; Object.assign(s.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext });
    s.shadow.camera.updateProjectionMatrix();
    encaixar();
    R.chaves = robos.map(r => r.chave).join("|") + "#" + (escuro() ? "e" : "c");
  }

  /* câmera que mostra a sala inteira (mais longe em tela estreita, como o celular em pé) */
  function encaixar() {
    if (!R.tamanho) return;
    const { W, D } = R.tamanho, asp = R.camera.aspect || 1.5;
    R.alvo = new T.Vector3(0, 0.8, D * 0.07);
    R.controles.target.copy(R.alvo);
    const dist = (Math.max(W, D) * 1.05 + 2) * (asp < 1.25 ? Math.pow(1.25 / Math.max(asp, 0.4), 0.8) : 1);
    R.camera.position.set(R.alvo.x + dist * 0.34, dist * 0.6, R.alvo.z + dist * 0.8);
    R.controles.maxDistance = dist * 1.8; R.controles.minDistance = 5;
    R.controles.update();
  }

  /* ------------------------------------------------------------ estado de cada mesa */
  function aplicarEstado(r) {
    const m = R.mesas.get(r.chave); if (!m) return;
    const u = m.userData, rb = u.robo.userData, st = r.st;
    u.r = r; u.st = st;
    const cor = new T.Color(COR_ST[st] || COR_ST.sem);
    rb.olhos.color.copy(cor); rb.olhos.emissive.copy(cor); rb.olhos.emissiveIntensity = st === "off" ? 0.15 : 1.2;
    rb.antena.color.copy(cor); rb.antena.emissive.copy(cor);
    rb.sirene.visible = st === "erro";
    u.luz.color.copy(cor); u.luz.intensity = st === "off" ? 0.05 : 0.35;
    u.exc.visible = st === "erro"; u.zzz.visible = st === "off"; u.engr.visible = st === "trab" || st === "pedido";
    if (st === "pedido") u.engr.material.color = new T.Color("#f5c542"); else u.engr.material.color = new T.Color("#ffffff");
    const chavePlaca = r.cat.nome + "|" + r.stTexto + "|" + st;
    if (u.ultPlaca !== chavePlaca) { desenharPlaca(u.placa.c, r.cat.nome, r.stTexto + (r.stHora ? " · " + r.stHora : ""), st); u.placa.t.needsUpdate = true; u.ultPlaca = chavePlaca; }
    u.ultTela = "";       // força redesenhar a tela
  }

  /* ------------------------------------------------------------ balões (HTML sobre a sala) */
  function baloesHtml(robos) {
    const op = R.op || {};
    R.baloes.innerHTML = "";
    R.balaoDe = new Map();
    robos.filter(r => r.st === "erro" || r.st === "pedido").forEach(r => {
      const b = document.createElement("div");
      b.className = "balao" + (r.st === "pedido" ? " pedido" : "");
      const causa = op.causa ? op.causa(r) : "";
      const pode = r.st === "erro" && op.podeRodar && op.podeRodar(r);
      b.innerHTML = r.st === "pedido"
        ? `<b>⏳ ${esc3(r.cat.nome)}</b><span>${esc3(/coordenador/.test(r.stTexto || "") ? "Na fila do Coordenador " + r.stTexto.replace(/^na fila do coordenador\s*/, "") + " — roda quando chegar a vez, sem passar por cima de ninguém." : "Pedido de rodar de novo na fila — o servidor pega em até 1 min.")}</span>`
        : `<b>⚠ ${esc3(r.cat.nome)}</b><span>${esc3(causa || "Deu errado na última rodada.")}</span>
           <div class="bb"><button type="button" data-a="ver">Ver relatório</button>${pode ? `<button type="button" data-a="rodar" class="rodar">▶ Rodar de novo</button>` : ""}</div>`;
      b.addEventListener("pointerdown", e => e.stopPropagation());
      b.addEventListener("click", e => {
        const a = e.target.closest("button") && e.target.closest("button").dataset.a;
        if (a === "ver" && op.abrir) op.abrir(r.chave);
        if (a === "rodar" && op.rodar) op.rodar(r, e.target.closest("button"));
        e.stopPropagation();
      });
      R.baloes.appendChild(b); R.balaoDe.set(r.chave, b);
    });
  }
  function esc3(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  const _v = null;
  function posicionarBaloes() {
    if (!R.balaoDe || !R.balaoDe.size) return;
    const w = R.caixa.clientWidth, h = R.caixa.clientHeight, v = new T.Vector3();
    R.balaoDe.forEach((b, ch) => {
      const m = R.mesas.get(ch); if (!m) return;
      v.set(0.35, 3.5, -0.6); m.localToWorld(v); v.project(R.camera);
      const fora = v.z > 1 || v.x < -1.15 || v.x > 1.15 || v.y < -1.15 || v.y > 1.6;
      b.style.display = fora ? "none" : "";
      if (fora) return;
      /* em cima do robô, mas sempre inteiro dentro da sala (no celular o robô pode estar na beirada) */
      const bw = b.offsetWidth, bh = b.offsetHeight;
      const x = Math.min(Math.max((v.x + 1) / 2 * w - bw / 2, 6), w - bw - 6);
      const y = Math.min(Math.max((1 - v.y) / 2 * h - bh - 10, 6), h - bh - 6);
      b.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    });
  }

  /* ------------------------------------------------------------ animação */
  function animar() {
    if (!R || R.parado) return;
    R.raf = requestAnimationFrame(animar);
    if (document.hidden || !R.visivel) return;
    const t = R.relo.getElapsedTime(), dt = Math.min(0.05, R.relo.getDelta ? 0.016 : 0.016);
    R.controles.update();
    R.mesas.forEach(m => {
      const u = m.userData, rb = u.robo.userData, st = u.st, f = t + u.fase;
      const cab = rb.cabeca;
      /* volta à pose neutra devagar e soma o movimento do estado */
      let cabRotX = 0, cabRotY = -0.35, cabY = 1.05, bra = 0.35;
      if (st === "ok" || st === "sem") {
        cabY += Math.sin(f * 1.6) * 0.025;
        cabRotY += Math.sin(f * 0.35) > 0.85 ? Math.sin(f * 2.5) * 0.5 : 0;
        bra += Math.sin(f * 1.6) * 0.03;
      } else if (st === "trab" || st === "pedido") {
        cabRotX = 0.08; cabRotY = -0.5 + Math.sin(f * 0.8) * 0.06; cabY += Math.abs(Math.sin(f * 9)) * 0.02;
        rb.bracos[0].rotation.x = 0.55 + Math.sin(f * 17) * 0.18;
        rb.bracos[1].rotation.x = 0.55 + Math.sin(f * 17 + Math.PI) * 0.18;
        rb.antena.emissiveIntensity = 0.6 + (Math.sin(f * 6) + 1) * 0.8;
        u.engr.material.rotation = -t * 2.2; u.engr.position.y = 2.4 + Math.sin(f * 2) * 0.06;
      } else if (st === "erro") {
        const balanca = (f % 5) < 1.6;
        cabRotY = balanca ? Math.sin(f * 9) * 0.45 : -0.15; cabRotX = balanca ? 0 : 0.18;
        rb.sirene.rotation.y = t * 5;
        const pulso = (Math.sin(t * 10) + 1) / 2;
        u.sireneLuz.intensity = 0.6 + pulso * 1.6;
        rb.olhos.emissiveIntensity = (Math.floor(t * 2.5) % 2) ? 1.4 : 0.35;
        u.exc.position.y = 2.45 + Math.abs(Math.sin(t * 4)) * 0.28;
        bra = 0.1;
      } else if (st === "off") {
        cabRotX = 0.42; cabY -= 0.05; bra = 0.05;
        const z = (f * 0.45) % 1;
        u.zzz.position.set(0.55 + z * 0.4, 2.0 + z * 0.9, -0.78); u.zzz.material.opacity = 1 - z; u.zzz.scale.setScalar(0.35 + z * 0.35);
      }
      if (st !== "erro") u.sireneLuz.intensity = 0;
      if (st !== "trab" && st !== "pedido") { rb.bracos.forEach(b => { b.rotation.x += (bra - b.rotation.x) * 0.1; }); rb.antena.emissiveIntensity = st === "off" ? 0.2 : 1.4; }
      cab.rotation.x += (cabRotX - cab.rotation.x) * 0.15;
      cab.rotation.y += (cabRotY - cab.rotation.y) * 0.15;
      cab.position.y += (cabY - cab.position.y) * 0.2;
      /* destaque do mouse */
      const alvo = R.sobre === u.chave ? 1.06 : 1; u.robo.scale.setScalar(u.robo.scale.x + (alvo - u.robo.scale.x) * 0.2);
      /* tela: redesenha só quando muda (rodando e erro mudam com o tempo) */
      const fase = st === "trab" || st === "pedido" ? Math.floor(t * 8) / 8 : st === "erro" ? Math.floor(t * 2) / 2 : 0;
      const chave = st + "|" + fase + "|" + ((u.r && u.r.stHora) || "");
      if (u.ultTela !== chave && u.r) { desenharTela(u.tela.c, st, u.r.cat.ico, u.r.stHora, fase); u.tela.t.needsUpdate = true; u.ultTela = chave; }
    });
    if (R.relogio && Math.floor(t) % 30 === 0 && R.ultRelogio !== Math.floor(t)) { R.ultRelogio = Math.floor(t); desenharRelogio(R.relogio.c); R.relogio.t.needsUpdate = true; }
    R.renderer.render(R.cena, R.camera);
    posicionarBaloes();
  }

  /* ------------------------------------------------------------ mouse / toque */
  function ligarPonteiro() {
    const ray = new T.Raycaster(), p = new T.Vector2(), el = R.renderer.domElement;
    let ini = null;
    const achar = e => {
      const rc = el.getBoundingClientRect();
      p.x = ((e.clientX - rc.left) / rc.width) * 2 - 1; p.y = -((e.clientY - rc.top) / rc.height) * 2 + 1;
      ray.setFromCamera(p, R.camera);
      const hit = ray.intersectObjects(R.sala ? R.sala.children : [], true).find(h => h.object.userData && h.object.userData.chave);
      return hit ? hit.object.userData.chave : null;
    };
    el.addEventListener("pointerdown", e => { ini = { x: e.clientX, y: e.clientY }; });
    el.addEventListener("pointermove", e => {
      if (e.pointerType !== "mouse") return;
      const ch = achar(e); R.sobre = ch; el.style.cursor = ch ? "pointer" : "grab";
      const dica = R.dica;
      if (ch && R.mesas.get(ch) && R.mesas.get(ch).userData.r) {
        const r = R.mesas.get(ch).userData.r; const rc = R.caixa.getBoundingClientRect();
        dica.textContent = r.cat.nome + " — clique para ver"; dica.style.display = "block";
        dica.style.left = (e.clientX - rc.left + 14) + "px"; dica.style.top = (e.clientY - rc.top + 14) + "px";
      } else dica.style.display = "none";
    });
    el.addEventListener("pointerleave", () => { R.sobre = null; R.dica.style.display = "none"; });
    el.addEventListener("pointerup", e => {
      if (!ini || Math.hypot(e.clientX - ini.x, e.clientY - ini.y) > 6) return;
      const ch = achar(e); if (ch && R.op && R.op.abrir) R.op.abrir(ch);
    });
  }

  /* ------------------------------------------------------------ API */
  function webglOk() {
    try { const c = document.createElement("canvas"); return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl"))); }
    catch (e) { return false; }
  }
  function iniciar(caixa) {
    if (R) return true;
    if (!T || !T.OrbitControls || !webglOk()) return false;
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    caixa.insertBefore(renderer.domElement, caixa.firstChild);
    const cena = new T.Scene();
    const camera = new T.PerspectiveCamera(38, 1, 0.1, 200);
    const controles = new T.OrbitControls(camera, renderer.domElement);
    Object.assign(controles, { enableDamping: true, dampingFactor: 0.08, minPolarAngle: 0.35, maxPolarAngle: 1.3,
                               minAzimuthAngle: -0.35, maxAzimuthAngle: 1.45, enablePan: true, screenSpacePanning: false, rotateSpeed: 0.6 });
    const hemi = new T.HemisphereLight("#dff1ff", "#8a6a4a", 0.75); cena.add(hemi);
    const amb = new T.AmbientLight("#ffffff", 0.18); cena.add(amb);
    const sol = new T.DirectionalLight("#fff3e0", 0.95); sol.castShadow = true; sol.shadow.mapSize.set(2048, 2048); sol.shadow.bias = -0.0006;
    cena.add(sol, sol.target);
    const baloes = document.createElement("div"); baloes.className = "baloes"; caixa.appendChild(baloes);
    const dica = document.createElement("div"); dica.className = "dica3d-mouse"; caixa.appendChild(dica);
    R = { caixa, renderer, cena, camera, controles, sol, hemi, baloes, dica, relo: new T.Clock(), mesas: new Map(), visivel: true };
    const redim = () => {
      const w = caixa.clientWidth, h = caixa.clientHeight; if (!w || !h) return;
      renderer.setSize(w, h, false); renderer.domElement.style.width = w + "px"; renderer.domElement.style.height = h + "px";
      const mudouForma = Math.abs((camera.aspect || 0) - w / h) > 0.15;
      camera.aspect = w / h; camera.updateProjectionMatrix();
      if (mudouForma && R && R.tamanho) encaixar();
    };
    new ResizeObserver(redim).observe(caixa); redim();
    if ("IntersectionObserver" in window) new IntersectionObserver(es => { R.visivel = es[0].isIntersecting; }).observe(caixa);
    ligarPonteiro();
    animar();
    return true;
  }
  function atualizar(robos, op) {
    if (!R) return;
    R.op = op || R.op;
    const fundo = escuro() ? "#0e1920" : "#eaf1f3";
    R.cena.background = new T.Color(fundo); R.cena.fog = new T.Fog(fundo, 40, 120);
    R.hemi.intensity = escuro() ? 0.45 : 0.75; R.sol.intensity = escuro() ? 0.55 : 0.95;
    const chaves = robos.map(r => r.chave).join("|") + "#" + (escuro() ? "e" : "c");
    if (chaves !== R.chaves) montarSala(robos);
    robos.forEach(aplicarEstado);
    /* lousa: o resumo de hoje */
    const n = s => robos.filter(r => r.st === s).length;
    desenharLousa(R.lousa.c, [
      { t: "✔ " + n("ok") + " em dia", cor: "#1a7f37" },
      { t: "✖ " + n("erro") + " com problema", cor: n("erro") ? "#cf222e" : "#57606a" },
      { t: "⚙ " + (n("trab") + n("pedido")) + " trabalhando", cor: "#1f6fb2" },
      { t: "☾ " + n("off") + " desligados", cor: "#57606a" }
    ]);
    R.lousa.t.needsUpdate = true;
    baloesHtml(robos);
  }
  function focar(chave) {
    const m = R && R.mesas.get(chave); if (!m) return;
    const alvo = new T.Vector3(); m.getWorldPosition(alvo); alvo.y = 1;
    R.controles.target.lerp(alvo, 0.6);
  }
  window.Escritorio3D = { iniciar, atualizar, focar, ativo: () => !!R };
})();
