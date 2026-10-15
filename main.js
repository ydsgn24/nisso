(() => {
  "use strict";

  // a reload always starts from the first screen
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  window.scrollTo(0, 0);

  // in-page links glide to their section (no jump, no #hash left in the address);
  // links without a target yet ("#") simply do nothing
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    e.preventDefault();
    const id = a.getAttribute("href").slice(1);
    const el = id && document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  const body = document.body;
  const hero = document.querySelector("[data-hero]");
  const canvas = document.querySelector("[data-hero-canvas]");
  const frameEl = document.querySelector("[data-frame]");
  const loaderEl = document.querySelector(".loader");
  const counterEl = document.querySelector("[data-counter]");

  /* ------------------------------------------------------------------
   * Text splitting
   * ------------------------------------------------------------------ */
  const title = document.querySelector("[data-split-letters]");
  {
    const text = title.textContent.trim();
    title.setAttribute("aria-label", text);
    title.textContent = "";
    // letters grouped per word, so the title wraps only between words on mobile
    let i = 0;
    text.split(" ").forEach((word, wi) => {
      if (wi) title.appendChild(document.createTextNode(" "));
      const w = document.createElement("span");
      w.className = "word";
      w.setAttribute("aria-hidden", "true");
      [...word].forEach((c) => {
        const s = document.createElement("span");
        s.className = "ch";
        s.style.setProperty("--i", i++);
        s.textContent = c;
        w.appendChild(s);
      });
      title.appendChild(w);
    });
  }

  function splitWords(el) {
    const words = el.textContent.trim().split(/\s+/);
    el.textContent = "";
    return words.map((w, i) => {
      const s = document.createElement("span");
      s.className = "w";
      s.textContent = w;
      el.appendChild(s);
      if (i < words.length - 1) el.appendChild(document.createTextNode(" "));
      return s;
    });
  }
  // Lights words one by one; the first `lead` words are always fully on
  function paintWords(words, lead, from, p) {
    const n = words.length - lead;
    for (let i = lead; i < words.length; i++) {
      const a = from + (1 - from) * clamp(p * (n + 4) - (i - lead), 0, 1);
      words[i].style.setProperty("--a", a.toFixed(3));
    }
  }

  const fillEl = document.querySelector("[data-fill-text]");
  const fillWords = splitWords(fillEl);
  // "Я дитяча" is already white in the design
  fillWords.slice(0, 2).forEach((w) => w.style.setProperty("--a", 1));

  // Clinics intro: fills while the block rises and finishes as it pins
  const clinicFill = document.querySelector("[data-fill-clinic]");
  const clinicWords = splitWords(clinicFill);

  // Dark leads: the first `data-lead` words are already black in the design
  const leads = [...document.querySelectorAll("[data-fill-dark]")].map((el) => {
    const lead = Number(el.dataset.lead) || 1;
    const words = splitWords(el);
    words.slice(0, lead).forEach((w) => w.style.setProperty("--a", 1));
    return { el, words, lead };
  });

  /* ------------------------------------------------------------------
   * Hero geometry (design frame 1440 × 1280)
   * ------------------------------------------------------------------ */
  const geo = { W: 0, H: 0, s: 1, fw: 0, fh: 0, cx: 0, cy: 0 };
  const cur = { x: 0, y: 0 };
  const target = { x: 0, y: 0 };
  let holeP = 0; // 0 → closed, 1 → open window
  let followEnabled = false;
  let dirty = true;

  const isMobile = () => window.innerWidth < 768;

  // Photo box in hero px, as cropped in the design (1440 or 375 frame)
  function photoBox(img) {
    const s = geo.s;
    if (geo.mobile) return { x: -76 * s, y: -79 * s, w: 501 * s, h: 1239 * s };
    const w = 1458 * s;
    const h = w * (img ? img.naturalHeight / img.naturalWidth : 2400 / 1808);
    return { x: geo.W / 2 - 720 * s, y: -422 * s, w, h };
  }

  function measureHero() {
    geo.W = hero.clientWidth;
    geo.H = hero.clientHeight;
    geo.mobile = isMobile();
    if (geo.mobile) {
      // 375 design frame: window 201×250 centred at (188.5, 311)
      geo.s = geo.W / 375;
      geo.fw = 201.07 * geo.s;
      geo.fh = 250 * geo.s;
      geo.cx = geo.W / 2 + 1.04 * geo.s;
      geo.cy = 311 * geo.s;
    } else {
      geo.s = Math.max(geo.W / 1440, geo.H / 1280);
      geo.fw = 337 * geo.s;
      geo.fh = 419 * geo.s;
      geo.cx = geo.W / 2 + 0.5 * geo.s;
      geo.cy = 337.5 * geo.s;
    }
    hero.style.setProperty("--frame-w", `${geo.fw}px`);
    hero.style.setProperty("--frame-h", `${geo.fh}px`);
    hero.style.setProperty("--frame-bottom", `${geo.cy + geo.fh / 2}px`);
    hero.style.setProperty("--hero-top", `${Math.min(0, window.innerHeight - geo.H)}px`);
    // fallback <img> crop, mirrors composePhoto()
    const pb = photoBox(heroImg);
    hero.style.setProperty("--photo-w", `${pb.w}px`);
    hero.style.setProperty("--photo-h", `${pb.h}px`);
    hero.style.setProperty("--photo-x", `${pb.x}px`);
    hero.style.setProperty("--photo-y", `${pb.y}px`);
    if (!followEnabled) {
      cur.x = target.x = geo.cx;
      cur.y = target.y = geo.cy;
    }
    dirty = true;
  }

  /* ------------------------------------------------------------------
   * WebGL: Figma "Pattern refraction" effect (Circular, strength 25,
   * smoothness 100%, frost 71%, dispersion 0) over a backdrop-blurred
   * photo, with a clear window cut out of it.
   * ------------------------------------------------------------------ */
  const FX = {
    size: 20 + (8.16 / 100) * 980, // 99.97 design px
    amount: 25 * 10, // 250 design px
    frost: (71 / 100) * 0.1,
    angle: (-45 * Math.PI) / 180,
    blur: 10, // Figma background blur 20 → σ ≈ 10 px
  };
  // mobile frame uses strength 17, frost 23%
  const FX_MOBILE = { ...FX, amount: 17 * 10, frost: (23 / 100) * 0.1 };
  const fx = () => (geo.mobile ? FX_MOBILE : FX);

  const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

  // Separable gaussian, 13 taps, step = σ/2
  const BLUR_FRAG = `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec2 uDir;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 c = vec4(0.0);
  float tw = 0.0;
  for (int i = -6; i <= 6; i++) {
    float f = float(i);
    float w = exp(-0.125 * f * f);
    c += texture2D(uTex, uv + uDir * f) * w;
    tw += w;
  }
  gl_FragColor = c / tw;
}`;

  // Shared pattern code — ported from the Figma shader (WGSL → GLSL)
  const PATTERN = `
const float PI = 3.14159265358979323846;
uniform vec2 uCenter;   // design px
uniform float uAngle;
uniform float uSize;
uniform float uFrost;

float hash3(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1.0, 0.0, 0.0)), u.x),
        mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
    mix(mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), u.x),
        mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), u.x), u.y),
    u.z);
}
float patternHeight(vec2 p, mat2 rot) {
  vec2 pos = rot * (p - uCenter) / uSize;
  vec2 g = fract(pos) * 2.0 - 1.0;
  float h = clamp(1.0 - dot(g, g), 0.0, 1.0); // circular
  h *= h;                                     // smoothness 100%
  h += (vnoise(vec3(p * 0.5, 1.0)) - 0.5) * uFrost;
  return h;
}
vec3 patternNormal(vec2 p, mat2 rot) {
  float h = patternHeight(p, rot);
  float h1 = patternHeight(p + vec2(0.125, 0.0), rot);
  float v1 = patternHeight(p + vec2(0.0, 0.125), rot);
  return normalize(vec3(h - vec2(h1, v1), 0.0125));
}`;

  // One-off pass: refracted blurred colour + average displacement.
  // uMode 0 → colour, 1 → displacement packed into RGBA8
  const BAKE_FRAG = `
precision highp float;
uniform sampler2D uBlur;
uniform vec2 uRes;      // device px
uniform float uScale;   // device px per design px
uniform float uAmount;
uniform int uMode;
${PATTERN}
void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 local = px / uScale;
  mat2 rot = mat2(cos(uAngle), sin(uAngle), -sin(uAngle), cos(uAngle));
  vec3 ray = vec3(0.0, 0.0, -1.0);
  vec4 acc = vec4(0.0);
  vec2 dsum = vec2(0.0);
  const int N = 4;
  for (int i = 0; i < N; i++) {
    for (int j = 0; j < N; j++) {
      vec2 o = vec2(float(i), float(j)) / float(N) - (float(N) - 1.0) / float(N) * 0.5;
      vec3 nor = patternNormal(local + o / uScale, rot);
      vec3 r = refract(ray, nor, 1.333);
      vec2 d = r.xy * uAmount;
      dsum += d;
      vec2 uv = clamp((local + d) * uScale / uRes, vec2(0.0), vec2(1.0));
      acc += texture2D(uBlur, uv);
    }
  }
  float tot = float(N * N);
  if (uMode == 0) {
    vec4 c = acc / tot;
    gl_FragColor = vec4(mix(c.rgb, vec3(1.0), 0.02), 1.0); // layer fill: white 2%
  } else {
    vec2 v = clamp(dsum / tot / 800.0 + 0.5, 0.0, 1.0);
    vec2 hi = floor(v * 255.0) / 255.0;
    vec2 lo = fract(v * 255.0);
    gl_FragColor = vec4(hi.x, lo.x, hi.y, lo.y);
  }
}`;

  const MAIN_FRAG = `
precision highp float;
uniform sampler2D uSharp;
uniform sampler2D uRefr;
uniform sampler2D uDisp;
uniform sampler2D uBlur;     // plain blurred photo, no glass pattern
uniform vec2 uRes;
uniform float uScale;
uniform vec2 uGlass;         // glass ends at y (device px), fading over this many px
uniform vec4 uHole; // minX, minY, maxX, maxY (device px, top-left origin)
float inside(vec2 p) {
  vec2 a = smoothstep(uHole.xy - 0.75, uHole.xy + 0.75, p);
  vec2 b = 1.0 - smoothstep(uHole.zw - 0.75, uHole.zw + 0.75, p);
  return a.x * a.y * b.x * b.y;
}
void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 uv = px / uRes;
  // baked targets are written bottom-up (gl_FragCoord), so read them flipped
  vec2 fuv = vec2(uv.x, 1.0 - uv.y);
  vec4 e = texture2D(uDisp, fuv);
  vec2 d = (vec2(e.x + e.y / 255.0, e.z + e.w / 255.0) - 0.5) * 800.0 * uScale;
  vec3 sharp = texture2D(uSharp, uv).rgb;
  vec3 refr = texture2D(uRefr, fuv).rgb;
  vec3 plain = mix(texture2D(uBlur, uv).rgb, vec3(1.0), 0.02);
  // mobile: the glass stops above the title, below it only the blurred photo
  float glass = 1.0 - smoothstep(uGlass.x - uGlass.y, uGlass.x, px.y);
  vec3 back = mix(plain, refr, glass);
  // clear where the window is, and where the lens pulls the window in
  float m = max(inside(px), inside(px + d * glass));
  gl_FragColor = vec4(mix(back, sharp, m), 1.0);
}`;

  let gl = null;
  const G = {};

  function initGL() {
    try {
      gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    } catch (e) { gl = null; }
    if (!gl) return false;

    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    };
    const program = (frag) => {
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag));
      gl.bindAttribLocation(p, 0, "aPos");
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(p, i);
        u[info.name] = gl.getUniformLocation(p, info.name);
      }
      return { p, u };
    };
    try {
      G.blur = program(BLUR_FRAG);
      G.bake = program(BAKE_FRAG);
      G.main = program(MAIN_FRAG);
    } catch (e) {
      console.warn("[hero] shader error, falling back", e);
      gl = null;
      return false;
    }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    return true;
  }

  function makeTex(w, h, filter, source) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  }
  function makeTarget(w, h, filter) {
    const tex = makeTex(w, h, filter, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fb, w, h };
  }
  function freeTargets() {
    ["sharp"].forEach((k) => G[k] && gl.deleteTexture(G[k]));
    ["blurA", "blurB", "refr", "disp"].forEach((k) => {
      if (G[k]) { gl.deleteTexture(G[k].tex); gl.deleteFramebuffer(G[k].fb); }
    });
  }

  // Photo + bottom gradient, drawn the way the design crops it
  function composePhoto(img, w, h, dpr) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    const s = geo.s * dpr;
    const pb = photoBox(img);
    ctx.fillStyle = "#0b0b0b";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, pb.x * dpr, pb.y * dpr, pb.w * dpr, pb.h * dpr);
    // design gradients: desktop 597→1086 to 40%, mobile 41%→52% of the photo to 60%
    const g = geo.mobile
      ? ctx.createLinearGradient(0, (pb.y + 0.41 * pb.h) * dpr, 0, (pb.y + 0.519 * pb.h) * dpr)
      : ctx.createLinearGradient(0, 597 * s, 0, 1086 * s);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, geo.mobile ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.4)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    return c;
  }

  let heroImg = null;
  let dpr = 1;

  function bake() {
    if (!gl || !heroImg) return;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(1, Math.round(geo.W * dpr));
    const h = Math.max(1, Math.round(geo.H * dpr));
    canvas.width = w;
    canvas.height = h;
    freeTargets();

    const scale = geo.s * dpr; // device px per design px
    G.scale = scale;
    G.sharp = makeTex(0, 0, gl.LINEAR, composePhoto(heroImg, w, h, dpr));

    // blur at half resolution
    const bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
    G.blurA = makeTarget(bw, bh, gl.LINEAR);
    G.blurB = makeTarget(bw, bh, gl.LINEAR);
    const sigma = (FX.blur * scale) / 2; // half-res px
    const step = sigma / 2;
    gl.useProgram(G.blur.p);
    gl.uniform1i(G.blur.u.uTex, 0);
    gl.uniform2f(G.blur.u.uRes, bw, bh);
    gl.viewport(0, 0, bw, bh);
    gl.activeTexture(gl.TEXTURE0);
    // horizontal: sharp → A
    gl.bindFramebuffer(gl.FRAMEBUFFER, G.blurA.fb);
    gl.bindTexture(gl.TEXTURE_2D, G.sharp);
    gl.uniform2f(G.blur.u.uDir, step / bw, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    // vertical: A → B
    gl.bindFramebuffer(gl.FRAMEBUFFER, G.blurB.fb);
    gl.bindTexture(gl.TEXTURE_2D, G.blurA.tex);
    gl.uniform2f(G.blur.u.uDir, 0, step / bh);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // refraction bake
    G.refr = makeTarget(w, h, gl.LINEAR);
    G.disp = makeTarget(w, h, gl.NEAREST);
    gl.useProgram(G.bake.p);
    const u = G.bake.u;
    gl.uniform1i(u.uBlur, 0);
    gl.uniform2f(u.uRes, w, h);
    gl.uniform1f(u.uScale, scale);
    gl.uniform1f(u.uAmount, fx().amount);
    gl.uniform2f(u.uCenter, (w / scale) * 0.5, (h / scale) * 0.5);
    gl.uniform1f(u.uAngle, FX.angle);
    gl.uniform1f(u.uSize, FX.size);
    gl.uniform1f(u.uFrost, fx().frost);
    gl.viewport(0, 0, w, h);
    gl.bindTexture(gl.TEXTURE_2D, G.blurB.tex);
    gl.bindFramebuffer(gl.FRAMEBUFFER, G.refr.fb);
    gl.uniform1i(u.uMode, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, G.disp.fb);
    gl.uniform1i(u.uMode, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // first blur pass no longer needed; the result (blurB) is kept for the no-glass zone
    gl.deleteTexture(G.blurA.tex);
    gl.deleteFramebuffer(G.blurA.fb);
    G.blurA = null;
    G.ready = true;
    dirty = true;
  }

  function holeRect() {
    const k = easeInOut(clamp(holeP, 0, 1));
    const hw = (geo.fw / 2) * k;
    const hh = (geo.fh / 2) * k;
    return [cur.x - hw, cur.y - hh, cur.x + hw, cur.y + hh];
  }

  function drawHero() {
    const [x0, y0, x1, y1] = holeRect();
    const k = easeInOut(clamp(holeP, 0, 1));

    frameEl.style.opacity = k;
    frameEl.style.transform =
      `translate3d(${cur.x - geo.fw / 2}px, ${cur.y - geo.fh / 2}px, 0) scale(${Math.max(k, 0.001)})`;

    if (!gl) {
      // inset() is relative to the <img> box, which is offset/cropped like composePhoto
      const pb = photoBox(heroImg);
      hero.style.setProperty("--hole-clip",
        `inset(${y0 - pb.y}px ${pb.x + pb.w - x1}px ${pb.y + pb.h - y1}px ${x0 - pb.x}px)`);
      return;
    }
    if (!G.ready) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(G.main.p);
    const u = G.main.u;
    gl.uniform2f(u.uRes, canvas.width, canvas.height);
    gl.uniform1f(u.uScale, G.scale);
    if (x1 - x0 < 0.5) gl.uniform4f(u.uHole, -10, -10, -10, -10);
    else gl.uniform4f(u.uHole, x0 * dpr, y0 * dpr, x1 * dpr, y1 * dpr);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, G.sharp);
    gl.uniform1i(u.uSharp, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, G.refr.tex);
    gl.uniform1i(u.uRefr, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, G.disp.tex);
    gl.uniform1i(u.uDisp, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, G.blurB.tex);
    gl.uniform1i(u.uBlur, 3);
    if (geo.mobile) gl.uniform2f(u.uGlass, title.offsetTop * dpr, 60 * dpr);
    else gl.uniform2f(u.uGlass, 1e6, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /* ------------------------------------------------------------------
   * Loading: counter in the bottom-left corner
   * ------------------------------------------------------------------ */
  const loadImage = (src) =>
    new Promise((res) => {
      const i = new Image();
      i.decoding = "async";
      i.onload = () => res(i);
      i.onerror = () => res(null);
      i.src = src;
    });

  let loaded = 0;
  const tasks = [
    loadImage(isMobile() ? "assets/hero-mobile.jpg" : "assets/hero.jpg").then((i) => { heroImg = i; }),
    loadImage("assets/emboss.jpg"),
    loadImage("assets/portrait.jpg"),
    loadImage("assets/clinic.jpg"),
    document.fonts ? document.fonts.load('400 100px "Averta Demo PE"').catch(() => {}) : Promise.resolve(),
  ];
  tasks.forEach((t) => t.then(() => { loaded++; }));

  let allLoaded = false;
  Promise.all(tasks).then(() => {
    measureHero();
    if (!initGL()) document.documentElement.classList.add("no-webgl");
    else {
      try { bake(); } catch (e) {
        console.warn("[hero] bake failed", e);
        gl = null;
        document.documentElement.classList.add("no-webgl");
      }
    }
    canvas.style.opacity = 1;
    allLoaded = true;
  });

  const MIN_LOADER = reduceMotion ? 0 : 2200; // ms
  const t0 = performance.now();
  let shown = 0;
  let introStarted = false;

  function tickLoader(now) {
    const timeCap = MIN_LOADER ? 100 * easeOut(clamp((now - t0) / MIN_LOADER, 0, 1)) : 100;
    const goal = Math.min(timeCap, allLoaded ? 100 : (loaded / tasks.length) * 92);
    shown = lerp(shown, goal, 0.12);
    if (goal - shown < 0.6) shown = goal;
    counterEl.textContent = String(Math.floor(shown));
    if (allLoaded && shown >= 100 && !introStarted) startIntro();
  }

  function startIntro() {
    introStarted = true;
    counterEl.textContent = "100";
    const delay = reduceMotion ? 0 : 250;
    setTimeout(() => loaderEl.classList.add("is-done"), delay);
    setTimeout(() => {
      introStart = performance.now();
      body.classList.add("is-ready");
    }, delay + (reduceMotion ? 0 : 450));
  }

  let introStart = 0;
  const HOLE_DUR = reduceMotion ? 1 : 1300;

  /* ------------------------------------------------------------------
   * Pointer
   * ------------------------------------------------------------------ */
  let pointer = null;
  window.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return; // touch: dragging doesn't move the window
    pointer = { x: e.clientX, y: e.clientY, type: e.pointerType };
  }, { passive: true });
  document.documentElement.addEventListener("pointerleave", () => { pointer = null; });

  // Touch: a tap (not a drag) on the hero sends the window there
  let tapAnchor = null; // hero px
  let tapStart = null;
  hero.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse") tapStart = { x: e.clientX, y: e.clientY, t: performance.now() };
  }, { passive: true });
  hero.addEventListener("pointerup", (e) => {
    if (!tapStart || e.pointerType === "mouse") return;
    const moved = Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y);
    if (moved < 10 && performance.now() - tapStart.t < 500) {
      const r = hero.getBoundingClientRect();
      tapAnchor = { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    tapStart = null;
  }, { passive: true });

  function updateHeroTarget(now) {
    if (!followEnabled) return;
    if (pointer && pointer.type === "mouse") {
      const r = hero.getBoundingClientRect();
      target.x = pointer.x - r.left;
      target.y = pointer.y - r.top;
    } else if (!finePointer) {
      // touch: rest on the last tap (or the centre) and drift ever so slightly
      const a = tapAnchor || { x: geo.cx, y: geo.cy };
      const t = now / 1000;
      target.x = a.x + Math.sin(t * 0.35) * 9 * geo.s;
      target.y = a.y + Math.cos(t * 0.27) * 7 * geo.s;
    } else {
      target.x = geo.cx;
      target.y = geo.cy;
    }
    target.x = clamp(target.x, geo.fw / 2, geo.W - geo.fw / 2);
    target.y = clamp(target.y, geo.fh / 2, geo.H - geo.fh / 2);
  }

  /* ------------------------------------------------------------------
   * Scroll-driven bits
   * ------------------------------------------------------------------ */
  function updateFill() {
    // fills while the hero scrolls up and stays pinned; done right as "About" enters
    const vh = window.innerHeight;
    const aboutTop = about.getBoundingClientRect().top;
    const p = clamp(window.scrollY / Math.max(1, window.scrollY + aboutTop - vh), 0, 1);
    paintWords(fillWords, 2, 0.6, p);

    const cr = clinicFill.closest("[data-clinics]").getBoundingClientRect();
    if (cr.top < vh && cr.bottom > 0) paintWords(clinicWords, 0, 0.5, clamp((vh - cr.top) / vh, 0, 1));

    // Dark leads: fill while travelling from the bottom to ~upper third
    const start = vh * 0.9;
    const end = vh * 0.3;
    leads.forEach(({ el, words, lead }) => {
      const r = el.getBoundingClientRect();
      if (r.top > vh || r.bottom < 0) return;
      // data-fill-end: share of the screen height where the fill completes
      const pl = el.dataset.fillEnd
        ? clamp((start - r.top) / (start - vh * Number(el.dataset.fillEnd)), 0, 1)
        : clamp((start - r.top) / (start - end + r.height * 0.5), 0, 1);
      paintWords(words, lead, 0.5, pl);
    });
  }

  // About: embossed logo — 10% everywhere, 90% under a soft spotlight
  const about = document.querySelector("[data-about]");
  const emboss = document.querySelector("[data-emboss]");
  const lit = document.querySelector("[data-emboss-lit]");
  const spot = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, a: 0, ta: 0 };

  function updateSpotTarget(now) {
    const er = emboss.getBoundingClientRect();
    const ar = about.getBoundingClientRect();
    if (pointer && pointer.type === "mouse") {
      const inAbout = pointer.x >= ar.left && pointer.x <= ar.right && pointer.y >= ar.top && pointer.y <= ar.bottom;
      spot.ta = inAbout ? 0.9 : 0;
      if (inAbout) {
        spot.tx = (pointer.x - er.left) / er.width;
        spot.ty = (pointer.y - er.top) / er.height;
      }
    } else if (!finePointer) {
      // touch (no cursor): the emboss is uncovered left to right as you scroll
      emboss.classList.add("is-sweep");
      const vh = window.innerHeight;
      const p = clamp((vh * 0.95 - er.top) / (vh * 0.55), 0, 1);
      lit.style.setProperty("--sweep", p.toFixed(3));
    }
  }

  // About: portrait swaps every second
  {
    const imgs = [...document.querySelectorAll("[data-portraits] img")];
    let idx = 0;
    if (!reduceMotion && imgs.length > 1) {
      setInterval(() => {
        if (document.hidden) return;
        imgs.forEach((im) => im.classList.remove("is-prev"));
        imgs[idx].classList.replace("is-active", "is-prev");
        idx = (idx + 1) % imgs.length;
        imgs[idx].classList.add("is-active");
      }, 1000);
    }
  }

  // Clinics: vertical scroll → horizontal shift
  const clinics = document.querySelector("[data-clinics]");
  const track = document.querySelector("[data-clinics-track]");
  const slides = [...track.querySelectorAll(".clinic")];
  const years = track.querySelector("[data-clinics-years]");
  const medias = slides.map((s) => s.querySelector(".clinic__media"));
  let trackX = 0;

  function updateClinics(dt) {
    const r = clinics.getBoundingClientRect();
    const dist = r.height - window.innerHeight;
    const p = clamp(-r.top / Math.max(1, dist), 0, 1);
    const W = window.innerWidth;
    const goal = -p * (slides.length - 1) * W;
    trackX = reduceMotion ? goal : lerp(trackX, goal, 1 - Math.exp(-dt * 10));
    if (Math.abs(goal - trackX) < 0.1) trackX = goal;
    track.style.setProperty("--tx", `${trackX.toFixed(2)}px`);
    medias.forEach((m, i) => {
      const rel = -trackX / W - i; // -1..1 around the slide
      m.style.setProperty("--px", `${(rel * W * 0.08).toFixed(2)}px`);
    });
    // seam between clinics 1 and 2 sits at 2W in the track; the years run ahead of
    // it (foreground parallax): centred on the seam mid-screen, gone at either slide
    const seam = 2 * W + trackX - W / 2; // 0 when the seam is mid-screen
    years.style.setProperty("--yx", `${(seam * 0.8).toFixed(2)}px`);
  }

  // Mentor photo: falls out from under the row's line with a tilt, then the
  // paperclip drops on and the motto writes itself
  const more = document.querySelector(".programs__more");
  const mentor = document.querySelector("[data-mentor]");
  const mentorPhoto = mentor.querySelector(".mentor__photo");

  // Folders: measure each panel's content (sticky offsets depend on it) and
  // how far the dark block after the stack must overlap the frozen dark panel
  const folders = [...document.querySelectorAll(".folder")];
  let bizFrozenBottom = 0; // viewport y of the dark panel's content end while frozen

  function cssPx(el, expr) {
    const probe = document.createElement("div");
    probe.style.cssText = `position:absolute;visibility:hidden;height:0;width:${expr}`;
    el.appendChild(probe);
    const v = probe.getBoundingClientRect().width;
    probe.remove();
    return v;
  }

  function measureFolders() {
    const vh = window.innerHeight;
    folders.forEach((f) => {
      const panel = f.querySelector(".folder__panel");
      const cs = getComputedStyle(panel);
      let h = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      [...panel.children].forEach((c) => { h += c.offsetHeight; });
      f.style.setProperty("--content", `${h}px`);
      f._content = h;
    });
    const biz = folders[folders.length - 1];
    const tabY = cssPx(biz, "var(--tab-y)");
    const tabH = cssPx(biz, "var(--tab-h)");
    bizFrozenBottom = Math.min(tabY + tabH + biz._content, vh);
    more.style.setProperty("--overlap", `${Math.max(0, vh - bizFrozenBottom - 1)}px`);
  }

  function updateMentor() {
    const vh = window.innerHeight;
    const r = more.getBoundingClientRect();
    if (r.top > vh || r.bottom < 0) return;
    // starts once the block sits right under the line (folders released)
    const line = bizFrozenBottom + 2;
    const p = reduceMotion ? 1 : clamp((line - r.top) / (vh * 0.45), 0, 1);
    const e = easeOut(p);
    // + extra so the tilted corners stay hidden above the line too
    const dist = mentor.offsetTop + mentor.offsetHeight + mentor.offsetWidth * 0.15;
    mentorPhoto.style.visibility = p > 0 ? "visible" : "hidden";
    mentorPhoto.style.setProperty("--fall-y", `${(-(1 - e) * dist).toFixed(1)}px`);
    mentorPhoto.style.setProperty("--fall-r", `${(-(1 - e) * 7).toFixed(2)}deg`);
    if (p >= 0.97) mentor.classList.add("is-landed");
  }

  // Footer mark: white runs around the ring, then fills the letters row by row
  const footer = document.querySelector(".footer");
  const ring = document.querySelector("[data-mark-ring]");
  const wipes = [...document.querySelectorAll("[data-mark-wipe]")];
  const ROW_W = [57, 46]; // row widths in mark units (+ a little slack)

  function updateMark() {
    const vh = window.innerHeight;
    const r = footer.getBoundingClientRect();
    if (r.top > vh) return;
    // 0 when the footer peeks in, 1 at the very bottom of the page
    const start = vh * 0.9;
    const end = Math.min(start - 1, vh - r.height);
    const p = reduceMotion ? 1 : clamp((start - r.top) / (start - end), 0, 1);
    const ringP = easeInOut(clamp(p / 0.45, 0, 1));
    ring.style.setProperty("--ring", (1 - ringP).toFixed(4));
    wipes.forEach((w, i) => {
      const k = clamp((p - 0.45 - i * 0.27) / 0.27, 0, 1);
      w.setAttribute("width", (ROW_W[i] * k).toFixed(2));
    });
  }

  // Blog: the row slides left as the block passes through the screen
  const blog = document.querySelector("[data-blog]");
  const blogRow = document.querySelector("[data-blog-row]");

  function updateBlog() {
    if (isMobile()) { blogRow.style.removeProperty("--bx"); return; } // swiped natively
    const vh = window.innerHeight;
    const r = blog.getBoundingClientRect();
    if (r.top > vh || r.bottom < 0) return;
    const p = clamp((vh - r.top) / (vh + r.height * 0.5), 0, 1);
    const extra = Math.max(0, blogRow.scrollWidth - blog.clientWidth);
    blogRow.style.setProperty("--bx", `${(-p * extra).toFixed(1)}px`);
  }

  // FAQ: one answer open at a time, height animated in CSS
  {
    const items = [...document.querySelectorAll("[data-faq] .faq__item")];
    const DUR = reduceMotion ? 0 : 500;
    const close = (d) => {
      d.classList.remove("is-open");
      clearTimeout(d._t);
      d._t = setTimeout(() => { if (!d.classList.contains("is-open")) d.open = false; }, DUR);
    };
    const open = (d) => {
      clearTimeout(d._t);
      d.open = true;
      requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add("is-open")));
    };
    items.forEach((d) => {
      d.querySelector("summary").addEventListener("click", (e) => {
        e.preventDefault();
        if (d.classList.contains("is-open")) { close(d); return; }
        items.forEach((o) => o !== d && o.classList.contains("is-open") && close(o));
        open(d);
      });
    });
  }

  // Reveal on enter
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) {
        en.target.classList.add("is-in");
        io.unobserve(en.target);
      }
    });
  }, { threshold: 0.2, rootMargin: "0px 0px -8% 0px" });
  document.querySelectorAll("[data-reveal]").forEach((el, i) => {
    el.style.setProperty("--d", `${(i % 4) * 0.12}s`);
    io.observe(el);
  });
  // programs: rows of a folder come in one after another
  document.querySelectorAll(".folder__panel").forEach((panel) => {
    panel.querySelectorAll(".prog").forEach((row, i) => row.style.setProperty("--d", `${i * 0.18}s`));
  });
  document.querySelectorAll("[data-faq] .faq__item").forEach((item, i) => item.style.setProperty("--d", `${i * 0.12}s`));
  const ioClinics = new IntersectionObserver(([en]) => {
    if (en && en.isIntersecting) { clinics.classList.add("is-in"); ioClinics.disconnect(); }
  }, { threshold: 0, rootMargin: "0px 0px 10% 0px" });
  ioClinics.observe(clinics);

  /* ------------------------------------------------------------------
   * Main loop
   * ------------------------------------------------------------------ */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (!introStarted) tickLoader(now);

    if (introStart) {
      const p = clamp((now - introStart) / HOLE_DUR, 0, 1);
      if (p !== holeP) { holeP = p; dirty = true; }
      if (p >= 1 && !followEnabled) {
        followEnabled = true;
        body.classList.remove("is-loading");
      }
    }

    updateHeroTarget(now);
    const k = 1 - Math.exp(-dt * 7);
    const nx = lerp(cur.x, target.x, k);
    const ny = lerp(cur.y, target.y, k);
    if (Math.abs(nx - cur.x) > 0.02 || Math.abs(ny - cur.y) > 0.02) {
      cur.x = nx;
      cur.y = ny;
      dirty = true;
    }

    const heroVisible = window.scrollY < geo.H + window.innerHeight;
    if (dirty && heroVisible) {
      drawHero();
      dirty = false;
    }

    updateFill();

    updateSpotTarget(now);
    const ks = 1 - Math.exp(-dt * 6);
    spot.x = lerp(spot.x, spot.tx, ks);
    spot.y = lerp(spot.y, spot.ty, ks);
    spot.a = lerp(spot.a, spot.ta, 1 - Math.exp(-dt * 4));
    lit.style.setProperty("--mx", `${(spot.x * 100).toFixed(2)}%`);
    lit.style.setProperty("--my", `${(spot.y * 100).toFixed(2)}%`);
    lit.style.setProperty("--spot", spot.a.toFixed(3));

    updateClinics(dt);
    updateMentor();
    updateMark();
    updateBlog();

    requestAnimationFrame(frame);
  }

  measureHero();
  measureFolders();
  if (document.fonts) document.fonts.ready.then(measureFolders);
  window.addEventListener("load", measureFolders);
  requestAnimationFrame(frame);

  let resizeT = 0;
  let lastW = window.innerWidth;
  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      // ignore mobile URL-bar height jitter
      if (window.innerWidth === lastW && geo.W < 768) {
        hero.style.setProperty("--hero-top", `${Math.min(0, window.innerHeight - geo.H)}px`);
        return;
      }
      const wasMobile = geo.mobile;
      lastW = window.innerWidth;
      measureHero();
      measureFolders();
      if (wasMobile !== geo.mobile) {
        // crossed the breakpoint: swap to the other hero photo
        loadImage(geo.mobile ? "assets/hero-mobile.jpg" : "assets/hero.jpg").then((i) => {
          if (!i) return;
          heroImg = i;
          measureHero();
          if (gl) bake();
        });
      } else if (gl && heroImg) bake();
    }, 150);
  });
})();
