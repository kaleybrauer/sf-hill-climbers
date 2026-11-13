// SF Hill Climbers: map rendering, the race, basin maps, controls and the
// matrix toy. The optimizers themselves live in core.js (window.SFCore).
(function () {
  "use strict";
  const C = window.SFCore;
  // The words on the page come from web/text.md (inlined by build.py).
  const TEXT = JSON.parse(document.getElementById("page-text").textContent);
  const tpl = (name, vals) => TEXT.templates[name].map((p) => `<p>${p.replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m))}</p>`).join("");
  const $ = (id) => document.getElementById(id);
  const FT = 3.28084;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- Data ----------
  const meta = JSON.parse($("terrain-data").textContent);
  const bin = atob(meta.elev_cm_b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const T = C.makeTerrain(meta, new Uint16Array(bytes.buffer));
  const HILLS = meta.hills;
  const RAMP_MAX_FT = 930;

  const lat0 = (meta.bbox.south + meta.bbox.north) / 2;
  const M_LAT = Math.PI * 6378137 / 180, M_LON = M_LAT * C.dcos(lat0 * Math.PI / 180); // dcos: same start point in every browser
  const toXY = (lat, lon) => ({ x: (lon - meta.bbox.west) * M_LON, y: (meta.bbox.north - lat) * M_LAT });

  const PLACES = {
    "16th St BART": [37.7650, -122.4197],
    "Glen Park BART": [37.7330, -122.4338],
    "Hayes Valley": [37.7765, -122.4242],
    "Ocean Beach at Judah": [37.7605, -122.5080],
    "Haight & Ashbury": [37.7699, -122.4469],
    "Dolores Park": [37.7596, -122.4269],
    "9th & Judah": [37.7623, -122.4665],
  };

  // ---------- State ----------
  const DEFAULT_LANES = ["sgd", "momentum", "adam", "muon"];
  // Menus and climber cards list the four default racers first, then the swap-ins.
  const CLIMBER_ORDER = [...DEFAULT_LANES, ...Object.keys(C.OPTIMIZERS).filter((k) => !DEFAULT_LANES.includes(k))];
  const SHAPES = ["circle", "square", "triangle", "diamond"];
  function defaults() {
    return {
      lanes: DEFAULT_LANES.map((k) => ({ opt: k, lr: C.OPTIMIZERS[k].lr[0] })),
      beta: 0.9, steps: 1000, noise: 0, rotationDeg: 0, cosine: false,
    };
  }
  let state = defaults();
  let start = placeStart("9th & Judah");

  function placeStart(name) {
    const [la, lo] = PLACES[name];
    return { ...toXY(la, lo), label: name };
  }
  const settingsFor = (lane) => ({
    lr: lane.lr, beta: state.beta, noise: state.noise, steps: state.steps,
    rotationDeg: state.rotationDeg, cosine: state.cosine,
  });

  // ---------- Theme colors (read from CSS tokens) ----------
  let col = {};
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    col = {
      sheet: v("--sheet"), ink: v("--ink"), ink2: v("--ink-2"), muted: v("--muted"), brown: v("--brown"),
      contour: v("--contour"), land: v("--land"), shadow: v("--relief-shadow"), light: v("--relief-light"),
      water: v("--water"), waterInk: v("--water-ink"), street: v("--street"),
      lanes: [1, 2, 3, 4].map((i) => v(`--lane-${i}`)),
      flat: v("--cat-flat"), stalled: v("--cat-stalled"), left: v("--cat-left"),
      ramp: [0, 1, 2, 3, 4, 5, 6].map((i) => rgb(v(`--ramp-${i}`))),
      dis: [1, 2, 3].map((i) => v(`--dis-${i}`)),
      fontDisplay: v("--font-display"), fontMono: v("--font-mono"), fontBody: v("--font-body"),
      dark: document.documentElement.dataset.theme === "dark" ||
        (document.documentElement.dataset.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches),
    };
  }
  function rgb(hex) {
    const h = hex.replace("#", "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rampColor(ft) {
    const t = Math.min(Math.max(ft / RAMP_MAX_FT, 0), 1) * 6;
    const i = Math.min(Math.floor(t), 5), f = t - i;
    const a = col.ramp[i], b = col.ramp[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }

  // ---------- Relief shading ----------
  const S = 2; // whole-city relief images at 2x the elevation grid (10 m pixels)
  let relief = null, shade = null, waterMask = null, landMask = null;
  const LIGHT = { z: 4, x: -0.5, y: -0.5, h: Math.SQRT1_2 }; // from the northwest, 45° up
  const SH = { s: 0, wet: 0 };

  // Shading at a point: SH.s < 0 in shadow, > 0 lit, 0 on flat ground; SH.wet = 1 in water.
  function shadeAt(x, y) {
    const el = C.heightAt(T, x, y);
    const [gx, gy] = C.slopeAt(T, x, y);
    const nx = -LIGHT.z * gx, ny = -LIGHT.z * gy, n = Math.hypot(nx, ny, 1);
    SH.s = (nx * LIGHT.x + ny * LIGHT.y + LIGHT.h) / n / LIGHT.h - 1;
    SH.wet = Math.min(Math.max(1 - (el - 0.2) / 0.6, 0), 1); // soft coastline
    return SH;
  }
  function reliefPixel(d, o, s, wet, pal) {
    const a = s < 0 ? Math.min(0.7, -s * 0.9) : Math.min(0.8, s * 1.6), t = s < 0 ? pal.D : pal.Li, L = pal.L, Wa = pal.Wa;
    const r = L[0] + (t[0] - L[0]) * a, g = L[1] + (t[1] - L[1]) * a, b = L[2] + (t[2] - L[2]) * a;
    d[o] = r + (Wa[0] - r) * wet; d[o + 1] = g + (Wa[1] - g) * wet; d[o + 2] = b + (Wa[2] - b) * wet; d[o + 3] = 255;
  }
  const palette = () => ({ L: rgb(col.land), D: rgb(col.shadow), Li: rgb(col.light), Wa: rgb(col.water) });

  function buildBaseLayers() {
    const w = T.W * S, h = T.H * S;
    const mk = () => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
    relief = mk(); shade = mk(); waterMask = mk(); landMask = mk();
    const ir = relief.getContext("2d").createImageData(w, h);
    const is = shade.getContext("2d").createImageData(w, h);
    const iw = waterMask.getContext("2d").createImageData(w, h);
    const il = landMask.getContext("2d").createImageData(w, h);
    const pal = palette();
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const { s, wet } = shadeAt((px + 0.5) / S * T.cell, (py + 0.5) / S * T.cell);
        const o = 4 * (py * w + px);
        reliefPixel(ir.data, o, s, wet, pal);
        // Shade-only overlay for the basin maps: dark or light, mostly transparent.
        is.data[o] = is.data[o + 1] = is.data[o + 2] = s < 0 ? 0 : 255;
        is.data[o + 3] = (s < 0 ? Math.min(0.5, -s * 0.55) : Math.min(0.35, s * 0.7)) * 255 * (1 - wet);
        iw.data[o] = pal.Wa[0]; iw.data[o + 1] = pal.Wa[1]; iw.data[o + 2] = pal.Wa[2]; iw.data[o + 3] = wet * 255;
        il.data[o] = pal.L[0]; il.data[o + 1] = pal.L[1]; il.data[o + 2] = pal.L[2]; il.data[o + 3] = (1 - wet) * 255;
      }
    }
    relief.getContext("2d").putImageData(ir, 0, 0);
    shade.getContext("2d").putImageData(is, 0, 0);
    waterMask.getContext("2d").putImageData(iw, 0, 0);
    landMask.getContext("2d").putImageData(il, 0, 0);
    viewRelief = null;
  }

  // Relief for a zoomed-in view, shaded at screen resolution.
  let viewRelief = null;
  function reliefForView(v, w, h, dpr) {
    const rw = Math.max(1, Math.round(w / dpr)), rh = Math.max(1, Math.round(h / dpr));
    const key = [v.x0, v.y0, v.x1, v.y1, rw, rh, col.land, col.water].join();
    if (viewRelief && viewRelief.key === key) return viewRelief.canvas;
    const cv = document.createElement("canvas"); cv.width = rw; cv.height = rh;
    const ctx = cv.getContext("2d"), img = ctx.createImageData(rw, rh), pal = palette();
    const sx = (v.x1 - v.x0) / rw, sy = (v.y1 - v.y0) / rh;
    for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) {
      const { s, wet } = shadeAt(v.x0 + (i + 0.5) * sx, v.y0 + (j + 0.5) * sy);
      reliefPixel(img.data, 4 * (j * rw + i), s, wet, pal);
    }
    ctx.putImageData(img, 0, 0);
    viewRelief = { key, canvas: cv };
    return cv;
  }

  // Contours (marching squares), in metres. Every 50 ft is built at load; the
  // in-between 25 ft levels only when someone zooms in.
  const CONTOURS = [];
  function addContours(levels) {
    const H = T.h, W = T.W, cell = T.cell;
    // Which cell edges (0 top, 1 right, 2 bottom, 3 left) each corner pattern connects.
    const P = [null, [3, 0], [0, 1], [3, 1], [1, 2], [3, 0, 1, 2], [0, 2], [3, 2],
               [2, 3], [0, 2], [0, 1, 2, 3], [1, 2], [1, 3], [0, 1], [0, 3]];
    const ex = new Float64Array(4), ey = new Float64Array(4);
    for (const ft of levels) {
      const lv = ft / FT, segs = [];
      for (let r = 0; r < T.H - 1; r++) {
        for (let c = 0; c < W - 1; c++) {
          const a = H[r * W + c], b = H[r * W + c + 1], cc = H[(r + 1) * W + c + 1], d = H[(r + 1) * W + c];
          const idx = (a > lv) | ((b > lv) << 1) | ((cc > lv) << 2) | ((d > lv) << 3);
          if (idx === 0 || idx === 15) continue;
          ex[0] = c + (lv - a) / (b - a); ey[0] = r;
          ex[1] = c + 1; ey[1] = r + (lv - b) / (cc - b);
          ex[2] = c + (lv - d) / (cc - d); ey[2] = r + 1;
          ex[3] = c; ey[3] = r + (lv - a) / (d - a);
          const pr = P[idx];
          for (let k = 0; k < pr.length; k += 2) {
            segs.push((ex[pr[k]] + 0.5) * cell, (ey[pr[k]] + 0.5) * cell, (ex[pr[k + 1]] + 0.5) * cell, (ey[pr[k + 1]] + 0.5) * cell);
          }
        }
      }
      CONTOURS.push({ ft, segs: new Float32Array(segs) });
    }
    CONTOURS.sort((a, b) => a.ft - b.ft);
  }
  addContours(Array.from({ length: 18 }, (_, i) => 50 * (i + 1)));
  let fineContours = false;

  // Streets in metres, with bounding boxes for culling.
  const STREET_NAMES = meta.street_names;
  const STREETS = meta.streets.map((s) => {
    let x = s[2], y = s[3];
    const pts = [(x / 10 + 0.5) * T.cell, (y / 10 + 0.5) * T.cell];
    for (let i = 4; i < s.length; i += 2) { x += s[i]; y += s[i + 1]; pts.push((x / 10 + 0.5) * T.cell, (y / 10 + 0.5) * T.cell); }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]); }
    return { rank: s[0], name: s[1], pts, x0, y0, x1, y1 };
  }).sort((a, b) => b.rank - a.rank);
  const ABBR = { Street: "St", Avenue: "Ave", Boulevard: "Blvd", Drive: "Dr", Road: "Rd", Place: "Pl", Terrace: "Ter", Court: "Ct", Lane: "Ln", Alley: "Aly", Highway: "Hwy", Plaza: "Plz", Circle: "Cir", Parkway: "Pkwy", Expressway: "Expy" };
  const shortName = (n) => n.replace(/\b(Street|Avenue|Boulevard|Drive|Road|Place|Terrace|Court|Lane|Alley|Highway|Plaza|Circle|Parkway|Expressway)$/, (m) => ABBR[m]);

  // ---------- Viewport ----------
  // Views are rectangles in metres with the map's aspect ratio.
  const FULL = { x0: 0, y0: 0, x1: T.widthM, y1: T.heightM };
  const ASPECT = T.widthM / T.heightM;
  const MIN_PX_M = 2.4; // zoomed views show at least ~2.4 m per screen pixel (1.2 km minimum)
  let view = { ...FULL }, raceFrame = { ...FULL }, wholeCity = false;
  const zoomOf = (v) => T.widthM / (v.x1 - v.x0);
  function project(v, w) {
    const k = w / (v.x1 - v.x0);
    return { v, k, X: (x) => (x - v.x0) * k, Y: (y) => (y - v.y0) * k };
  }
  const inView = (v, x0, y0, x1, y1) => !(x1 < v.x0 || x0 > v.x1 || y1 < v.y0 || y0 > v.y1);

  // Frame the start and every path, with room for labels; the whole city if that's most of it.
  function fitFrame() {
    let x0 = start.x, x1 = start.x, y0 = start.y, y1 = start.y;
    for (const r of race) for (let j = 0; j < r.n; j++) {
      const x = r.path[2 * j], y = r.path[2 * j + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const pad = Math.max(300, 0.2 * Math.max(x1 - x0, y1 - y0));
    x0 -= pad; x1 += pad * 1.4; y0 -= pad; y1 += pad; // a little extra on the right for labels
    const minW = Math.max(1200, MIN_PX_M * (raceWrap.getBoundingClientRect().width || 800));
    const wM = Math.max(x1 - x0, (y1 - y0) * ASPECT, minW);
    if (wM >= T.widthM * 0.72) return { ...FULL };
    const hM = wM / ASPECT, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const vx0 = Math.min(Math.max(cx - wM / 2, 0), T.widthM - wM), vy0 = Math.min(Math.max(cy - hM / 2, 0), T.heightM - hM);
    return { x0: vx0, y0: vy0, x1: vx0 + wM, y1: vy0 + hM };
  }
  const sameView = (a, b) => Math.abs(a.x0 - b.x0) + Math.abs(a.x1 - b.x1) + Math.abs(a.y0 - b.y0) + Math.abs(a.y1 - b.y1) < 2;
  const contains = (a, b) => a.x0 <= b.x0 + 1 && a.y0 <= b.y0 + 1 && a.x1 >= b.x1 - 1 && a.y1 >= b.y1 - 1;

  let fly = null;
  // Glide the race map to `target`, zooming on a log scale. `k` is how much of
  // the paths to show while moving.
  function flyTo(target, k, done) {
    if (fly) cancelAnimationFrame(fly.raf);
    const from = { ...view };
    if (reduceMotion || sameView(from, target)) { view = { ...target }; fly = null; renderRaceBase(); drawRace(k); if (done) done(); return; }
    const fw = from.x1 - from.x0, tw = target.x1 - target.x0;
    const fc = [(from.x0 + from.x1) / 2, (from.y0 + from.y1) / 2], tc = [(target.x0 + target.x1) / 2, (target.y0 + target.y1) / 2];
    const dur = 750, t0 = performance.now();
    const tick = (now) => {
      const f = Math.min((now - t0) / dur, 1);
      const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
      if (f < 1) {
        const wNow = Math.exp(Math.log(fw) + (Math.log(tw) - Math.log(fw)) * e);
        const cx = fc[0] + (tc[0] - fc[0]) * e, cy = fc[1] + (tc[1] - fc[1]) * e;
        view = { x0: cx - wNow / 2, x1: cx + wNow / 2, y0: cy - wNow / ASPECT / 2, y1: cy + wNow / ASPECT / 2 };
        renderRaceBase(true); drawRace(k);
        fly.raf = requestAnimationFrame(tick);
      } else {
        view = { ...target }; fly = null;
        renderRaceBase(); drawRace(k);
        if (done) done();
      }
    };
    fly = { raf: requestAnimationFrame(tick) };
  }

  function updateZoomButton() {
    const btn = $("zoom-btn");
    const framed = !sameView(raceFrame, FULL);
    btn.hidden = !framed;
    btn.textContent = sameView(view, FULL) ? "Zoom to the race" : "Show whole city";
  }
  $("zoom-btn").addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (anim) { cancelAnimationFrame(anim.raf); anim = null; }
    const full = race ? Math.max(...race.map((r) => r.n - 1)) : 0;
    wholeCity = !sameView(view, FULL);
    flyTo(wholeCity ? FULL : raceFrame, full, updateZoomButton);
  });

  // ---------- Map drawing ----------
  function sizeCanvas(cv) {
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return { w, h, dpr, cssW: r.width };
  }

  function drawStreets(ctx, P, w, dpr) {
    const z = zoomOf(P.v), v = P.v;
    const minorAlpha = Math.min(1, Math.max(0, (z - 1.8) / 1.4));
    const widthScale = Math.min(2.4, 0.6 + 0.22 * z) * Math.min(1.2, w / dpr / 700 + 0.4);
    ctx.strokeStyle = col.street;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    let rank = -1;
    for (const s of STREETS) { // sorted minor first, so major roads draw on top
      if (s.rank !== rank) {
        if (rank >= 0) ctx.stroke();
        rank = s.rank;
        ctx.globalAlpha = rank >= 3 ? minorAlpha * (rank === 4 ? 0.75 : 0.95) : 1;
        ctx.lineWidth = [2.2, 1.4, 0.9, 0.8, 0.6][rank] * dpr * widthScale;
        ctx.beginPath();
      }
      if ((rank >= 3 && minorAlpha <= 0) || !inView(v, s.x0, s.y0, s.x1, s.y1)) continue;
      ctx.moveTo(P.X(s.pts[0]), P.Y(s.pts[1]));
      for (let i = 2; i < s.pts.length; i += 2) ctx.lineTo(P.X(s.pts[i]), P.Y(s.pts[i + 1]));
    }
    if (rank >= 0) ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 50 ft interval (index every 250 ft) for the whole city, 25 ft (index every
  // 100 ft) when zoomed in.
  const contourInterval = (z) => (z >= 2.5 ? 25 : 50);
  function drawContours(ctx, P, dpr) {
    const iv = contourInterval(zoomOf(P.v)), v = P.v;
    if (iv === 25 && !fineContours) { addContours(Array.from({ length: 18 }, (_, i) => 25 + 50 * i)); fineContours = true; }
    const isIndex = (ft) => (iv === 25 ? ft % 100 === 0 : ft % 250 === 0);
    ctx.strokeStyle = col.contour;
    for (const lvl of CONTOURS) {
      if (lvl.ft % iv !== 0) continue;
      ctx.globalAlpha = isIndex(lvl.ft) ? 0.75 : 0.42;
      ctx.lineWidth = (isIndex(lvl.ft) ? 1.1 : 0.6) * dpr;
      ctx.beginPath();
      const s = lvl.segs;
      for (let i = 0; i < s.length; i += 4) {
        const ax = s[i], ay = s[i + 1];
        if (ax < v.x0 - 40 || ax > v.x1 + 40 || ay < v.y0 - 40 || ay > v.y1 + 40) continue;
        ctx.moveTo(P.X(ax), P.Y(ay));
        ctx.lineTo(P.X(s[i + 2]), P.Y(s[i + 3]));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawHillLabel(ctx, L, dpr) {
    const halo = (text, x, y) => {
      ctx.strokeStyle = col.land; ctx.lineWidth = 3 * dpr; ctx.lineJoin = "round";
      ctx.strokeText(text, x, y); ctx.fillText(text, x, y);
    };
    ctx.fillStyle = col.ink;
    ctx.beginPath();
    ctx.moveTo(L.x, L.y - L.tri); ctx.lineTo(L.x + L.tri, L.y + L.tri * 0.75); ctx.lineTo(L.x - L.tri, L.y + L.tri * 0.75); ctx.closePath();
    ctx.lineWidth = 2 * dpr; ctx.strokeStyle = col.land; ctx.stroke(); ctx.fill();
    ctx.font = `italic 600 ${L.nameSize}px ${col.fontDisplay}`;
    ctx.textAlign = L.spot.align; ctx.textBaseline = "middle";
    ctx.fillStyle = col.ink;
    halo(L.name, L.spot.tx, L.spot.ty);
    if (L.lines === 2) {
      ctx.font = `500 ${L.ftSize}px ${col.fontMono}`;
      ctx.fillStyle = col.ink2;
      halo(`${L.ft} ft`, L.spot.tx, L.spot.ty + L.nameSize * 0.95);
    }
  }

  // Greedy label placement: priority hills (where climbers ended), then hills
  // by prominence, neighbourhoods, and street names when zoomed in.
  function drawLabels(ctx, P, w, h, dpr, opts) {
    const scale = Math.min(1.15, Math.max(0.78, w / dpr / 760));
    const boxes = (opts.obstacles || []).slice();
    const fits = (b) => b.x0 >= 2 && b.y0 >= 2 && b.x1 <= w - 2 && b.y1 <= h - 2 &&
      !boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
    const halo = (text, x, y) => {
      ctx.strokeStyle = col.land; ctx.lineWidth = 3 * dpr; ctx.lineJoin = "round";
      ctx.strokeText(text, x, y); ctx.fillText(text, x, y);
    };
    const pri = opts.priority || [];
    const others = HILLS.map((hl, i) => i).filter((i) => HILLS[i].named && !HILLS[i].edge && HILLS[i].prom >= opts.minProm && !pri.includes(i))
      .sort((a, b) => HILLS[b].prom - HILLS[a].prom).slice(0, opts.maxHills);
    const nameSize = Math.round(13 * scale * dpr), ftSize = Math.round(10.5 * scale * dpr);
    for (const i of [...pri, ...others]) {
      const hl = HILLS[i], isPri = pri.includes(i);
      const x = P.X((hl.c + 0.5) * T.cell), y = P.Y((hl.r + 0.5) * T.cell);
      if (x < 0 || y < 0 || x > w || y > h) continue;
      const name = hl.name;
      ctx.font = `italic 600 ${nameSize}px ${col.fontDisplay}`;
      const tw = ctx.measureText(name).width;
      const tri = 4.5 * dpr * scale, gap = tri + 5 * dpr;
      const lines = opts.showFt ? 2 : 1;
      const bh = nameSize * 1.05 + (lines === 2 ? ftSize * 1.1 : 0);
      // Beside the summit; where climbers ended, also above or below it.
      const spots = [[gap, 0, "left"], [-gap, 0, "right"]];
      if (isPri) spots.push([gap, -bh - 2 * dpr, "left"], [-gap, -bh - 2 * dpr, "right"], [gap, bh, "left"], [-gap, bh, "right"]);
      const boxOf = ([dx, dy, align]) => {
        const tx = x + dx, ty = y + dy, x0 = align === "left" ? tx : tx - tw;
        return { tx, ty, align, b: { x0: x0 - 2, x1: x0 + tw + 2, y0: ty - nameSize * 0.75, y1: ty - nameSize * 0.75 + bh } };
      };
      let spot = spots.map(boxOf).find((c) => fits(c.b));
      if (!spot && isPri) spot = boxOf(spots[0]); // a climber's destination is always labelled
      if (!spot) continue;
      boxes.push(spot.b, { x0: x - tri - 1, x1: x + tri + 1, y0: y - tri - 1, y1: y + tri });
      const label = { x, y, tri, spot, name, ft: hl.summit_ft, nameSize, ftSize, lines };
      // Destinations go on top of the paths, drawn once the race has finished.
      if (isPri && opts.deferred) opts.deferred.push(label); else drawHillLabel(ctx, label, dpr);
    }
    if (opts.places) {
      const ps = Math.round(10.5 * scale * dpr);
      ctx.font = `600 ${ps}px ${col.fontDisplay}`;
      if ("letterSpacing" in ctx) ctx.letterSpacing = `${1.6 * dpr}px`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (const p of meta.places) {
        const text = p.name.toUpperCase();
        const x = P.X((p.c + 0.5) * T.cell), y = P.Y((p.r + 0.5) * T.cell), tw = ctx.measureText(text).width;
        const b = { x0: x - tw / 2 - 2, x1: x + tw / 2 + 2, y0: y - ps * 0.6, y1: y + ps * 0.6 };
        if (!fits(b)) continue;
        boxes.push(b);
        ctx.fillStyle = col.muted;
        halo(text, x, y);
      }
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    }
    if (opts.streets) {
      // Each named street once, along its longest visible straight stretch.
      const fs = Math.round(10.5 * dpr);
      ctx.font = `500 ${fs}px ${col.fontBody}`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const best = new Map();
      for (const s of STREETS) {
        if (s.name < 0 || !inView(P.v, s.x0, s.y0, s.x1, s.y1)) continue;
        for (let i = 0; i + 3 < s.pts.length; i += 2) {
          const ax = P.X(s.pts[i]), ay = P.Y(s.pts[i + 1]), bx = P.X(s.pts[i + 2]), by = P.Y(s.pts[i + 3]);
          const cx = (ax + bx) / 2, cy = (ay + by) / 2;
          if (cx < 0 || cy < 0 || cx > w || cy > h) continue;
          const len = Math.hypot(bx - ax, by - ay);
          const cur = best.get(s.name);
          if (!cur || s.rank < cur.rank || (s.rank === cur.rank && len > cur.len)) best.set(s.name, { len, cx, cy, ang: Math.atan2(by - ay, bx - ax), rank: s.rank, name: s.name });
        }
      }
      const list = [...best.values()].sort((a, b) => a.rank - b.rank || b.len - a.len).slice(0, 60);
      for (const L of list) {
        const text = shortName(STREET_NAMES[L.name]);
        const tw = ctx.measureText(text).width;
        if (tw + 12 * dpr > L.len) continue;
        let ang = L.ang;
        if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
        const cw = Math.abs(Math.cos(ang)) * tw + Math.abs(Math.sin(ang)) * fs, ch = Math.abs(Math.sin(ang)) * tw + Math.abs(Math.cos(ang)) * fs;
        const b = { x0: L.cx - cw / 2, x1: L.cx + cw / 2, y0: L.cy - ch / 2, y1: L.cy + ch / 2 };
        if (!fits(b)) continue;
        boxes.push(b);
        ctx.save(); ctx.translate(L.cx, L.cy); ctx.rotate(ang);
        ctx.fillStyle = col.ink2; halo(text, 0, 0);
        ctx.restore();
      }
    }
  }

  // ---------- Race view ----------
  const raceBase = $("race-base"), racePaths = $("race-paths"), raceWrap = $("race-wrap");
  let race = null, anim = null, destLabels = [];

  // fast: during a fly-over, just the cropped relief.
  function renderRaceBase(fast) {
    const { w, h, dpr } = sizeCanvas(raceBase);
    const ctx = raceBase.getContext("2d");
    const P = project(view, w), z = zoomOf(view);
    ctx.imageSmoothingEnabled = true;
    if (!fast && z > 1.6) {
      ctx.drawImage(reliefForView(view, w, h, dpr), 0, 0, w, h);
    } else {
      ctx.fillStyle = col.water; ctx.fillRect(0, 0, w, h);
      const f = S / T.cell;
      ctx.drawImage(relief, view.x0 * f, view.y0 * f, (view.x1 - view.x0) * f, (view.y1 - view.y0) * f, 0, 0, w, h);
    }
    if (fast) return;
    drawStreets(ctx, P, w, dpr);
    drawContours(ctx, P, dpr);
    const dest = race ? [...new Set(race.filter((r) => r.cls.kind === "hill").map((r) => r.cls.hill))] : [];
    destLabels = [];
    drawLabels(ctx, P, w, h, dpr, { minProm: z < 1.6 ? 8 : z < 3 ? 4 : 1.5, maxHills: 60, showFt: true, places: true, streets: z >= 3, priority: dest, obstacles: raceObstacles(P, dpr), deferred: destLabels });
    renderScaleBar(P.k / dpr);
    $("contour-note").textContent = `Contour interval ${contourInterval(z)} feet`;
    updateZoomButton();
  }

  // Small boxes along the paths and around the pin, so labels don't hide under them.
  function raceObstacles(P, dpr) {
    if (!race) return [];
    const out = [], r = 7 * dpr;
    const add = (x, y) => out.push({ x0: x - r, x1: x + r, y0: y - r, y1: y + r });
    add(P.X(start.x), P.Y(start.y));
    for (const q of race) {
      let lx = -1e9, ly = -1e9;
      for (let j = 0; j < q.n; j++) {
        const x = P.X(q.path[2 * j]), y = P.Y(q.path[2 * j + 1]);
        if (Math.abs(x - lx) + Math.abs(y - ly) < r) continue;
        add(x, y); lx = x; ly = y;
      }
    }
    return out;
  }

  function renderScaleBar(pxPerM) {
    // Pick round lengths that make bars of at most ~120 px.
    const kmOpts = [0.1, 0.2, 0.25, 0.5, 1, 2], miOpts = [0.1, 0.25, 0.5, 1];
    const km = [...kmOpts].reverse().find((d) => d * 1000 * pxPerM <= 120) || kmOpts[0];
    const mi = [...miOpts].reverse().find((d) => d * 1609.34 * pxPerM <= 120) || miOpts[0];
    const kmPx = km * 1000 * pxPerM, miPx = mi * 1609.34 * pxPerM;
    const kmLabel = km < 1 ? `${km * 1000} m` : `${km} km`, miLabel = `${mi} mi`;
    const W = Math.ceil(Math.max(kmPx, miPx) + 60);
    $("scalebar").innerHTML =
      `<svg width="${W}" height="26" aria-hidden="true">` +
      `<rect x="0" y="4" width="${kmPx / 2}" height="4" fill="${col.ink}"/><rect x="${kmPx / 2}" y="4" width="${kmPx / 2}" height="4" fill="none" stroke="${col.ink}" stroke-width="1"/>` +
      `<text x="${kmPx + 4}" y="9" fill="${col.muted}" font-size="11" font-family="var(--font-mono)">${kmLabel}</text>` +
      `<rect x="0" y="16" width="${miPx / 2}" height="4" fill="none" stroke="${col.ink}" stroke-width="1"/><rect x="${miPx / 2}" y="16" width="${miPx / 2}" height="4" fill="${col.ink}"/>` +
      `<text x="${miPx + 4}" y="21" fill="${col.muted}" font-size="11" font-family="var(--font-mono)">${miLabel}</text></svg>`;
  }

  function computeRace() {
    race = state.lanes.map((lane, i) => {
      const r = C.climb(T, lane.opt, settingsFor(lane), start.x, start.y, true);
      const cls = C.classify(T, HILLS, r.x, r.y);
      const p = r.path, n = p.length / 2;
      let arrived = n - 1;
      if ((cls.kind === "hill" || cls.kind === "bump") && C.OPTIMIZERS[lane.opt].anneal) {
        // Annealing can touch a summit's height early and wander off again, so
        // it has arrived once it stays up there.
        for (let k = n - 1; k >= 0; k--) {
          if (C.heightAt(T, p[2 * k], p[2 * k + 1]) < cls.top - C.ARRIVED_M) { arrived = Math.min(k + 1, n - 1); break; }
        }
      } else if (cls.kind === "hill" || cls.kind === "bump") {
        for (let k = 0; k < n; k++) {
          if (C.heightAt(T, p[2 * k], p[2 * k + 1]) >= cls.top - C.ARRIVED_M) { arrived = k; break; }
        }
      }
      let dist = 0;
      for (let k = 1; k <= arrived; k++) dist += Math.hypot(p[2 * k] - p[2 * k - 2], p[2 * k + 1] - p[2 * k - 1]);
      return { i, lane, path: p, n, cls, arrived, dist, endFt: C.heightAt(T, r.x, r.y) * FT };
    });
  }

  function drawMarker(ctx, shape, x, y, r, fill, ring) {
    ctx.beginPath();
    if (shape === "circle") ctx.arc(x, y, r, 0, 2 * Math.PI);
    else if (shape === "square") ctx.rect(x - r * 0.88, y - r * 0.88, r * 1.76, r * 1.76);
    else if (shape === "triangle") { ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x + r * 1.05, y + r * 0.75); ctx.lineTo(x - r * 1.05, y + r * 0.75); ctx.closePath(); }
    else { ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r * 1.05, y); ctx.lineTo(x, y + r * 1.2); ctx.lineTo(x - r * 1.05, y); ctx.closePath(); }
    ctx.lineWidth = ring; ctx.strokeStyle = col.sheet; ctx.stroke();
    ctx.fillStyle = fill; ctx.fill();
  }

  function drawRace(k) {
    const { w, h, dpr } = sizeCanvas(racePaths);
    const ctx = racePaths.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    if (!race) return;
    const P = project(view, w);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const pass of [0, 1]) {
      for (const r of race) {
        const m = Math.min(k, r.n - 1);
        ctx.beginPath();
        ctx.moveTo(P.X(r.path[0]), P.Y(r.path[1]));
        for (let j = 1; j <= m; j++) ctx.lineTo(P.X(r.path[2 * j]), P.Y(r.path[2 * j + 1]));
        if (pass === 0) { ctx.strokeStyle = col.sheet; ctx.lineWidth = 5 * dpr; ctx.globalAlpha = 0.9; }
        else { ctx.strokeStyle = col.lanes[r.i]; ctx.lineWidth = 2.4 * dpr; ctx.globalAlpha = 1; }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    // Start pin.
    const sx = P.X(start.x), sy = P.Y(start.y);
    ctx.beginPath(); ctx.arc(sx, sy, 6.5 * dpr, 0, 2 * Math.PI);
    ctx.fillStyle = col.ink; ctx.strokeStyle = col.sheet; ctx.lineWidth = 2.5 * dpr; ctx.stroke(); ctx.fill();
    ctx.beginPath(); ctx.arc(sx, sy, 2.2 * dpr, 0, 2 * Math.PI); ctx.fillStyle = col.sheet; ctx.fill();
    // Climber markers at their current (or final) position.
    for (const r of [...race].reverse()) {
      const m = Math.min(k, r.n - 1);
      drawMarker(ctx, SHAPES[r.i], P.X(r.path[2 * m]), P.Y(r.path[2 * m + 1]), 5.5 * dpr, col.lanes[r.i], 2 * dpr);
    }
    if (!fly && race.every((r) => k >= r.n - 1)) for (const L of destLabels) drawHillLabel(ctx, L, dpr);
  }

  function playRace() {
    if (anim) cancelAnimationFrame(anim.raf);
    const K = Math.max(...race.map((r) => Math.min(r.arrived + 40, r.n - 1)));
    const full = Math.max(...race.map((r) => r.n - 1));
    if (reduceMotion) { drawRace(full); anim = null; return; }
    const dur = Math.min(5200, Math.max(1600, K * 6)); // the same number of steps per frame for everyone
    const t0 = performance.now();
    const tick = (now) => {
      const f = Math.min((now - t0) / dur, 1);
      drawRace(f < 1 ? Math.floor(K * f) : full);
      if (f < 1) anim.raf = requestAnimationFrame(tick); else anim = null;
    };
    anim = { raf: requestAnimationFrame(tick) };
  }

  // mode "fly": a new starting point; glide to frame the race, then run it.
  // Otherwise (settings changed): keep the view unless the paths no longer fit.
  // mode: "fly" for a new start (always reframe), "refit" when a change is
  // finished (new climber, slider let go: reframe unless showing the whole
  // city), nothing while a slider moves (only zoom out if a path leaves the view).
  let raceSig = "";
  function runRace(mode) {
    const sig = JSON.stringify([state, start.x, start.y]), same = sig === raceSig;
    raceSig = sig;
    if (!same) { computeRace(); renderScores(); }
    raceFrame = fitFrame();
    if (mode === "fly") {
      if (anim) { cancelAnimationFrame(anim.raf); anim = null; }
      wholeCity = false;
      if (activeTab !== "race") { view = { ...raceFrame }; return; }
      flyTo(raceFrame, 0, playRace);
    } else if (mode === "refit" && !wholeCity && !sameView(view, raceFrame)) {
      if (anim) { cancelAnimationFrame(anim.raf); anim = null; }
      if (activeTab !== "race") { view = { ...raceFrame }; return; }
      flyTo(raceFrame, 0, playRace);
    } else if (!same) {
      if (!wholeCity && !contains(view, raceFrame)) { view = { ...raceFrame }; renderRaceBase(); }
      else if (!fly) renderRaceBase();
      playRace();
    }
  }

  // ---------- Scoreboard ----------
  const nf = (x, d = 0) => x.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
  function laneKeySVG(i) {
    const c = col.lanes[i], s = SHAPES[i];
    const shape = s === "circle" ? `<circle cx="11" cy="8" r="4.5" fill="${c}"/>`
      : s === "square" ? `<rect x="7" y="4" width="8" height="8" fill="${c}"/>`
      : s === "triangle" ? `<path d="M11 3.2 L15.6 11.6 L6.4 11.6 Z" fill="${c}"/>`
      : `<path d="M11 2.8 L15.6 8 L11 13.2 L6.4 8 Z" fill="${c}"/>`;
    return `<svg class="key" width="22" height="16" viewBox="0 0 22 16" aria-hidden="true"><line x1="0" y1="8" x2="22" y2="8" stroke="${c}" stroke-width="2.4"/>${shape}</svg>`;
  }
  // "η 100" for the gradient climbers, "T₀ 40" for simulated annealing.
  const paramText = (lane) => `${C.OPTIMIZERS[lane.opt].sym || "η"} ${lrText(lane)}`;
  function lrText(lane) {
    const v = lane.lr;
    return v >= 100 ? nf(v) : v >= 10 ? nf(v, 0) : v >= 1 ? nf(v, 1) : nf(v, 2);
  }
  function outcomeText(cls) {
    if (cls.kind === "hill") return { where: HILLS[cls.hill].name, ft: HILLS[cls.hill].summit_ft };
    if (cls.kind === "bump") return { where: "Stopped on a flat spot", ft: null };
    if (cls.kind === "stalled") return { where: "Ran out of steps, still climbing", ft: null };
    return { where: "Left the city toward Daly City", ft: null };
  }

  function nearestPlace(x, y) {
    let best = null, bd = Infinity;
    for (const p of meta.places) {
      const d = Math.hypot((p.c + 0.5) * T.cell - x, (p.r + 0.5) * T.cell - y);
      if (d < bd) { bd = d; best = p.name; }
    }
    return best;
  }

  function renderScores() {
    const startFt = C.heightAt(T, start.x, start.y) * FT;
    const label = start.label ? `<b>${start.label}</b>` : `your pin <b>near ${nearestPlace(start.x, start.y)}</b>`;
    $("from").innerHTML = `Starting from ${label} at <span class="num">${nf(startFt)} ft</span>`;
    const best = Math.max(...race.map((r) => (r.cls.kind === "hill" ? HILLS[r.cls.hill].summit_ft : -1)));
    $("scores").innerHTML = race.map((r) => {
      const o = outcomeText(r.cls);
      const name = C.OPTIMIZERS[r.lane.opt].label;
      const isBest = r.cls.kind === "hill" && o.ft === best && race.some((q) => q.cls.kind !== "hill" || HILLS[q.cls.hill].summit_ft !== best);
      let metaLine;
      if (r.cls.kind === "hill" || r.cls.kind === "bump") {
        metaLine = `${r.cls.kind === "bump" ? `at ${nf(r.endFt)} ft · ` : ""}arrived in ${nf(r.arrived)} steps · walked ${nf(r.dist / 1000, 1)} km`;
      } else if (r.cls.kind === "stalled") {
        metaLine = `at ${nf(r.endFt)} ft after ${nf(r.n - 1)} steps · walked ${nf(r.dist / 1000, 1)} km`;
      } else {
        metaLine = `walked ${nf(r.dist / 1000, 1)} km before reaching the county line`;
      }
      return `<li class="score">${laneKeySVG(r.i)}
        <div class="who"><b>${name}</b><span class="num">${paramText(r.lane)}</span></div>
        <div class="where">${o.where}${o.ft ? ` <span class="ft">${nf(o.ft)} ft</span>` : ""}${isBest ? ' <span class="chip">Highest</span>' : ""}</div>
        <div class="meta">${metaLine}</div></li>`;
    }).join("");
    racePaths.setAttribute("aria-label", `Map of San Francisco. ${race.map((r) => `${C.OPTIMIZERS[r.lane.opt].label}: ${outcomeText(r.cls).where}`).join(". ")}.`);
  }

  // Race map interaction.
  const raceTip = $("race-tip");
  function eventXY(ev, el) {
    const r = el.getBoundingClientRect();
    const fx = (ev.clientX - r.left) / r.width, fy = (ev.clientY - r.top) / r.height;
    return { x: fx * T.widthM, y: fy * T.heightM, px: ev.clientX - r.left, py: ev.clientY - r.top, w: r.width, h: r.height };
  }
  function placeTip(tip, p) {
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = p.px + 14, top = p.py + 14;
    if (left + tw > p.w - 4) left = p.px - tw - 14;
    if (top + th > p.h - 4) top = p.py - th - 14;
    tip.style.left = `${Math.max(4, left)}px`; tip.style.top = `${Math.max(4, top)}px`;
  }
  // Pointer position on the race map, in metres within the current view.
  function raceXY(ev) {
    const p = eventXY(ev, raceWrap);
    p.x = view.x0 + (p.px / p.w) * (view.x1 - view.x0);
    p.y = view.y0 + (p.py / p.h) * (view.y1 - view.y0);
    return p;
  }
  raceWrap.addEventListener("pointermove", (ev) => {
    if (ev.pointerType === "touch") return;
    const p = raceXY(ev);
    const el = C.heightAt(T, p.x, p.y);
    raceTip.innerHTML = el < 1 ? "Water" : `<span class="num">${nf(el * FT)} ft</span> · near ${nearestPlace(p.x, p.y)}<br>Click to start here`;
    placeTip(raceTip, p);
  });
  raceWrap.addEventListener("pointerleave", () => { raceTip.hidden = true; });
  raceWrap.addEventListener("click", (ev) => {
    const p = raceXY(ev);
    if (C.heightAt(T, p.x, p.y) < 1) return;
    start = { x: p.x, y: p.y, label: null };
    $("addr").value = "";
    $("race-hint").hidden = true;
    runRace("fly");
  });

  // ---------- Address search (offline; nothing leaves the page) ----------
  const GEO = window.SFGeocode.makeGeocoder(meta, Object.entries(PLACES).map(([name, [la, lo]]) => ({ name, kind: "preset", ...toXY(la, lo) })));
  function searchMessage(text, suggestions, query, bad) {
    const msg = $("search-msg");
    msg.textContent = text;
    msg.dataset.state = suggestions ? "error" : "";
    for (const sug of suggestions || []) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "linkish";
      const fixed = bad && query.toLowerCase().includes(bad.toLowerCase().trim())
        ? query.replace(new RegExp(bad.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), sug) : sug;
      b.textContent = `Try ${fixed}`;
      b.addEventListener("click", () => { $("addr").value = fixed; doSearch(); });
      msg.append(" ", b);
    }
  }
  function doSearch() {
    const q = $("addr").value;
    // An empty box replays the race from the current start.
    if (!q.trim()) { searchMessage("", null); showTab("race"); runRace("fly"); return; }
    const r = GEO.search(q);
    if (r.error) { searchMessage(r.error, r.suggestions || [], q, r.bad); return; }
    const p = r.lat != null ? toXY(r.lat, r.lon) : r;
    if (!(p.x > 0 && p.y > 0 && p.x < T.widthM && p.y < T.heightM)) { searchMessage("That's outside San Francisco's map.", []); return; }
    if (C.heightAt(T, p.x, p.y) < 1) { searchMessage(`${r.label} is in the water. Try a spot on land.`, []); return; }
    start = { x: p.x, y: p.y, label: r.label + (r.approx ? " (approx.)" : "") };
    searchMessage(r.approx ? "Position is interpolated between nearby addresses, so it may be off by half a block." : "", null);
    $("race-hint").hidden = true;
    showTab("race");
    runRace("fly");
  }
  $("search").addEventListener("submit", (ev) => { ev.preventDefault(); doSearch(); });

  // ---------- Basins of attraction ----------
  const TERR_SPACING = [180, 90];
  const terr = { sig: null, level: -1, codes: null, gw: 0, gh: 0, spacing: 0, job: 0, progress: 0, running: false };
  const terrCards = [];

  function sig() {
    return JSON.stringify([state.lanes, state.beta, state.steps, state.noise, state.rotationDeg, state.cosine]);
  }

  function buildTerrCards() {
    const grid = $("terr-grid");
    grid.innerHTML = "";
    terrCards.length = 0;
    for (let i = 0; i < 4; i++) {
      const card = document.createElement("div");
      card.className = "terr-card";
      card.innerHTML = `<header>${laneKeySVG(i)}<h3></h3><span class="stat"></span></header>
        <div class="map-wrap clickable"><canvas aria-hidden="true"></canvas><canvas role="img"></canvas><div class="map-tip" hidden></div></div>`;
      grid.appendChild(card);
      const [base, over] = card.querySelectorAll("canvas");
      const wrap = card.querySelector(".map-wrap"), tip = card.querySelector(".map-tip");
      terrCards.push({ card, base, over, wrap, tip });
      wrap.addEventListener("pointermove", (ev) => terrHover(ev, i));
      wrap.addEventListener("pointerleave", () => terrHover(null, i));
      wrap.addEventListener("click", (ev) => terrClick(ev, wrap));
    }
    updateTerrHeaders();
  }

  function updateTerrHeaders() {
    terrCards.forEach((tc, i) => {
      tc.card.querySelector(".key").outerHTML = laneKeySVG(i);
      tc.card.querySelector("h3").textContent = C.OPTIMIZERS[state.lanes[i].opt].label;
    });
  }

  function startTerritories() {
    const s = sig();
    if (terr.sig === s && (terr.running || terr.level === TERR_SPACING.length - 1)) return;
    terr.sig = s; terr.level = -1; terr.job++; terr.running = true;
    runLevel(0, terr.job);
  }

  function runLevel(level, job) {
    const spacing = TERR_SPACING[level];
    const gw = Math.ceil(T.widthM / spacing), gh = Math.ceil(T.heightM / spacing);
    const codes = state.lanes.map(() => new Int16Array(gw * gh).fill(-9));
    const land = [];
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      if (C.heightAt(T, (i + 0.5) * spacing, (j + 0.5) * spacing) > 1) land.push(j * gw + i);
    }
    const lanes = state.lanes.map((l) => ({ opt: l.opt, s: settingsFor(l) }));
    let li = 0, k = 0;
    const total = land.length * lanes.length;
    const slice = () => {
      if (job !== terr.job) return;
      const t0 = performance.now();
      while (li < lanes.length && performance.now() - t0 < 14) {
        for (let n = 0; n < 40 && k < land.length; n++, k++) {
          const cell = land[k], x = (cell % gw + 0.5) * spacing, y = (Math.floor(cell / gw) + 0.5) * spacing;
          const r = C.climb(T, lanes[li].opt, lanes[li].s, x, y, false);
          codes[li][cell] = C.outcomeCode(C.classify(T, HILLS, r.x, r.y));
        }
        if (k >= land.length) { li++; k = 0; }
      }
      const done = li * land.length + k;
      terr.progress = (level + done / total) / TERR_SPACING.length;
      setStatus();
      if (li < lanes.length) { setTimeout(slice, 0); return; }
      Object.assign(terr, { level, codes, gw, gh, spacing, landCount: land.length });
      renderTerritories();
      if (level + 1 < TERR_SPACING.length) setTimeout(() => runLevel(level + 1, job), 0);
      else { terr.running = false; setStatus(); }
    };
    setTimeout(slice, 0);
  }

  function setStatus() {
    const st = $("status");
    if (terr.running) {
      st.innerHTML = `Mapping basins <span class="num">${Math.round(terr.progress * 100)}%</span><span class="bar"><i style="width:${terr.progress * 100}%"></i></span>`;
    } else if (activeTab === "territories" && terr.codes) {
      st.textContent = `Each map runs ${nf(terr.landCount)} starting points, ${terr.spacing} m apart`;
    } else {
      st.textContent = "Click the map to move the start";
    }
  }

  function codeColor(code) {
    if (code >= 0) return rampColor(HILLS[code].summit_ft);
    return rgb(code === C.BUMP ? col.flat : code === C.STALLED ? col.stalled : col.left);
  }

  function paintCodes(cv, codes, colorOf) {
    const { gw, gh } = terr;
    const off = document.createElement("canvas"); off.width = gw; off.height = gh;
    const octx = off.getContext("2d"), img = octx.createImageData(gw, gh);
    for (let i = 0; i < codes.length; i++) {
      if (codes[i] === -9) continue;
      const c = colorOf(codes[i], i);
      if (!c) continue;
      img.data[4 * i] = c[0]; img.data[4 * i + 1] = c[1]; img.data[4 * i + 2] = c[2]; img.data[4 * i + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    return off;
  }

  // borders: false skips the basin outlines (annealing's endings are random draws, not basins).
  function drawTerrMap(cv, off, codes, labels, borders = true) {
    const { w, h, dpr } = sizeCanvas(cv);
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = col.water; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(landMask, 0, 0, w, h);
    // Basin cells cover whole spacing blocks; their right/bottom edge may overhang the grid.
    const bw = terr.gw * terr.spacing / T.widthM * w, bh = terr.gh * terr.spacing / T.heightM * h;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, bw, bh);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(shade, 0, 0, w, h);
    if (codes && borders) {
      // Borders between basins: a thin gap in the sheet colour.
      ctx.strokeStyle = col.sheet; ctx.globalAlpha = 0.85; ctx.lineWidth = Math.max(1, 0.8 * dpr);
      ctx.beginPath();
      const cw = bw / terr.gw, ch = bh / terr.gh, { gw, gh } = terr;
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
        const a = codes[j * gw + i];
        if (a === -9) continue;
        if (i + 1 < gw && codes[j * gw + i + 1] !== a && codes[j * gw + i + 1] !== -9) { ctx.moveTo((i + 1) * cw, j * ch); ctx.lineTo((i + 1) * cw, (j + 1) * ch); }
        if (j + 1 < gh && codes[(j + 1) * gw + i] !== a && codes[(j + 1) * gw + i] !== -9) { ctx.moveTo(i * cw, (j + 1) * ch); ctx.lineTo((i + 1) * cw, (j + 1) * ch); }
      }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    ctx.drawImage(waterMask, 0, 0, w, h);
    drawLabels(ctx, project(FULL, w), w, h, dpr, labels);
  }

  function renderTerritories() {
    if (!terr.codes || activeTab !== "territories") return;
    const { codes } = terr;
    terrCards.forEach((tc, i) => {
      const off = paintCodes(tc.base, codes[i], codeColor);
      drawTerrMap(tc.base, off, codes[i], { minProm: 30, maxHills: 9, showFt: false, places: false }, !C.OPTIMIZERS[state.lanes[i].opt].anneal);
      // Stats for the header.
      const c = codes[i];
      let land = 0, stalled = 0, flat = 0, left = 0;
      const tops = new Set();
      for (const v of c) {
        if (v === -9) continue;
        land++;
        if (v >= 0) tops.add(v); else if (v === C.STALLED) stalled++; else if (v === C.BUMP) flat++; else left++;
      }
      const pct = (n) => `${Math.round((100 * n) / land)}%`;
      const parts = [C.OPTIMIZERS[state.lanes[i].opt].anneal ? `${tops.size} tops reached, a random draw per start` : `${tops.size} basins`];
      if (stalled / land >= 0.005) parts.push(`out of steps on ${pct(stalled)}`);
      if (flat / land >= 0.005) parts.push(`flat spots ${pct(flat)}`);
      tc.card.querySelector(".stat").textContent = parts.join(" · ");
      tc.over.setAttribute("aria-label", `${C.OPTIMIZERS[state.lanes[i].opt].label} basins of attraction: ${parts.join(", ")}`);
      sizeCanvas(tc.over);
    });
    renderDisagreement();
  }

  function renderDisagreement() {
    const { codes, gw, gh } = terr;
    const n = gw * gh, distinct = new Uint8Array(n);
    const counts = [0, 0, 0, 0, 0];
    let land = 0;
    const pair = {};
    for (let i = 0; i < n; i++) {
      if (codes[0][i] === -9) continue;
      land++;
      const v = codes.map((c) => c[i]);
      const d = new Set(v).size;
      distinct[i] = d; counts[d]++;
      for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) if (v[a] !== v[b]) pair[`${a}-${b}`] = (pair[`${a}-${b}`] || 0) + 1;
    }
    const dis = col.dis.map(rgb);
    const off = paintCodes($("dis-base"), codes[0], (c, i) => (distinct[i] > 1 ? dis[distinct[i] - 2] : null));
    drawTerrMap($("dis-base"), off, null, { minProm: 30, maxHills: 12, showFt: false, places: false });
    sizeCanvas($("dis-over"));
    const pct = (k) => Math.round((100 * k) / land);
    const pctText = (k) => (k > 0 && pct(k) === 0 ? "under 1%" : `${pct(k)}%`);
    const names = state.lanes.map((l) => C.OPTIMIZERS[l.opt].label);
    const pairs = Object.entries(pair).sort((a, b) => b[1] - a[1]);
    const [hiA, hiB] = pairs[0] ? pairs[0][0].split("-").map(Number) : [0, 1];
    const lo = pairs[pairs.length - 1] ? pairs[pairs.length - 1][0].split("-").map(Number) : [0, 1];
    const num = (v) => `<span class="num">${v}</span>`;
    $("dis-text").innerHTML = tpl("disagreement", {
      agree: num(`${pct(counts[1])}%`), other: num(`${100 - pct(counts[1])}%`),
      two: pctText(counts[2]), three: pctText(counts[3]), four: pctText(counts[4]),
      pair_a: names[hiA], pair_b: names[hiB], pair_pct: `${pct(pairs[0] ? pairs[0][1] : 0)}%`,
      alike_a: names[lo[0]], alike_b: names[lo[1]], alike_pct: `${pct(pairs.length ? pairs[pairs.length - 1][1] : 0)}%`,
    }).replace("<p>", '<p class="big">');
  }

  function cellAt(x, y) {
    const i = Math.min(terr.gw - 1, Math.floor(x / terr.spacing)), j = Math.min(terr.gh - 1, Math.floor(y / terr.spacing));
    return j * terr.gw + i;
  }

  function codeLabel(code) {
    if (code >= 0) return `${HILLS[code].name} <span class="num">${nf(HILLS[code].summit_ft)} ft</span>`;
    return code === C.BUMP ? "Flat spot" : code === C.STALLED ? "Ran out of steps" : "Left the city";
  }

  function terrHover(ev, idx, wrapOverride) {
    const all = [...terrCards.map((t) => t.over), $("dis-over")];
    for (const cv of all) { const ctx = cv.getContext("2d"); ctx.clearRect(0, 0, cv.width, cv.height); }
    terrCards.forEach((t) => (t.tip.hidden = true));
    $("dis-tip").hidden = true;
    if (!ev || !terr.codes || ev.pointerType === "touch") return;
    const wrap = wrapOverride || terrCards[idx].wrap;
    const tip = wrapOverride ? $("dis-tip") : terrCards[idx].tip;
    const p = eventXY(ev, wrap);
    const cell = cellAt(p.x, p.y);
    if (terr.codes[0][cell] === -9) return;
    for (const cv of all) {
      const { w, h, dpr } = sizeCanvas(cv);
      const ctx = cv.getContext("2d");
      const x = p.x / T.widthM * w, y = p.y / T.heightM * h;
      ctx.beginPath(); ctx.arc(x, y, 6 * dpr, 0, 2 * Math.PI);
      ctx.lineWidth = 3.5 * dpr; ctx.strokeStyle = col.sheet; ctx.stroke();
      ctx.lineWidth = 1.6 * dpr; ctx.strokeStyle = col.ink; ctx.stroke();
    }
    tip.innerHTML = terr.codes.map((c, i) =>
      `<div class="row">${laneKeySVG(i).replace('width="22"', 'width="14"')}<span><b>${C.OPTIMIZERS[state.lanes[i].opt].label}</b> → ${codeLabel(c[cell])}</span></div>`
    ).join("") + `<div style="color:var(--muted);margin-top:4px">Click to race from here</div>`;
    placeTip(tip, p);
  }

  function terrClick(ev, wrap) {
    const p = eventXY(ev, wrap);
    if (C.heightAt(T, p.x, p.y) < 1) return;
    start = { x: p.x, y: p.y, label: null };
    $("addr").value = "";
    $("race-hint").hidden = true;
    showTab("race");
    runRace("fly");
    $("tool").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }
  $("dis-wrap").addEventListener("pointermove", (ev) => terrHover(ev, -1, $("dis-wrap")));
  $("dis-wrap").addEventListener("pointerleave", () => terrHover(null, -1));
  $("dis-wrap").addEventListener("click", (ev) => terrClick(ev, $("dis-wrap")));

  function renderLegend() {
    const stops = col.ramp.map((c, i) => `rgb(${c.join(",")}) ${(i / 6) * 100}%`).join(", ");
    $("ramp-bar").style.background = `linear-gradient(90deg, ${stops})`;
    $("ramp-ticks").innerHTML = [0, 300, 600, 900].map((ft) =>
      `<span style="position:absolute;left:${(ft / RAMP_MAX_FT) * 100}%;transform:translateX(${ft === 0 ? 0 : ft === 900 ? -80 : -50}%)">${ft === 900 ? "900 ft" : ft}</span>`).join("");
    $("ramp-ticks").style.position = "relative";
    $("ramp-ticks").style.height = "1.2em";
  }

  // ---------- Tabs ----------
  let activeTab = "race";
  function showTab(name) {
    activeTab = name;
    $("tab-race").setAttribute("aria-selected", String(name === "race"));
    $("tab-territories").setAttribute("aria-selected", String(name === "territories"));
    $("view-race").hidden = name !== "race";
    $("view-territories").hidden = name !== "territories";
    try {
      if (name === "territories" && location.hash !== "#territories") history.replaceState(null, "", "#territories");
      else if (name === "race" && location.hash === "#territories") history.replaceState(null, "", "#race");
    } catch (e) { /* the frame may not allow it; the tab still works */ }
    if (name === "territories") { startTerritories(); renderTerritories(); }
    setStatus();
    requestAnimationFrame(() => { if (name === "race" && !fly) { renderRaceBase(); if (!anim) drawRace(Infinity); } });
  }
  $("tab-race").addEventListener("click", () => showTab("race"));
  $("tab-territories").addEventListener("click", () => showTab("territories"));
  window.addEventListener("hashchange", () => showTab(location.hash === "#territories" ? "territories" : "race"));

  // ---------- Controls ----------
  const LR_STEPS = 1000;
  const lrToSlider = (opt, lr) => { const [, lo, hi] = C.OPTIMIZERS[opt].lr; return Math.round(LR_STEPS * Math.log(lr / lo) / Math.log(hi / lo)); };
  const sliderToLr = (opt, v) => { const [, lo, hi] = C.OPTIMIZERS[opt].lr; const x = lo * Math.pow(hi / lo, v / LR_STEPS); return Number(x.toPrecision(2)); };

  function buildLanes() {
    $("lanes").innerHTML = state.lanes.map((lane, i) => `
      <div class="lane">
        ${laneKeySVG(i)}
        <select id="lane-${i}-opt" aria-label="Climber ${i + 1} optimizer">
          ${CLIMBER_ORDER.map((k) => `<option value="${k}"${k === lane.opt ? " selected" : ""}>${C.OPTIMIZERS[k].label}</option>`).join("")}
        </select>
        <div class="slider">
          <input type="range" id="lane-${i}-lr" min="0" max="${LR_STEPS}" step="1" value="${lrToSlider(lane.opt, lane.lr)}" aria-label="Climber ${i + 1} learning rate">
          <output id="lane-${i}-out" class="num">${paramText(lane)}</output>
          <span class="unit" id="lane-${i}-unit">${C.OPTIMIZERS[lane.opt].lrUnit}</span>
        </div>
      </div>`).join("");
    state.lanes.forEach((lane, i) => {
      $(`lane-${i}-opt`).addEventListener("change", (ev) => {
        const opt = ev.target.value;
        state.lanes[i] = { opt, lr: C.OPTIMIZERS[opt].lr[0] };
        $(`lane-${i}-lr`).value = lrToSlider(opt, state.lanes[i].lr);
        $(`lane-${i}-out`).textContent = paramText(state.lanes[i]);
        $(`lane-${i}-unit`).textContent = C.OPTIMIZERS[opt].lrUnit;
        updateTerrHeaders();
        changed("refit");
      });
      $(`lane-${i}-lr`).addEventListener("input", (ev) => {
        state.lanes[i].lr = sliderToLr(state.lanes[i].opt, Number(ev.target.value));
        $(`lane-${i}-out`).textContent = paramText(state.lanes[i]);
        changed();
      });
      $(`lane-${i}-lr`).addEventListener("change", () => changed("refit"));
    });
  }

  function syncShared() {
    $("set-beta").value = state.beta; $("out-beta").textContent = state.beta.toFixed(2);
    $("set-steps").value = state.steps; $("out-steps").textContent = nf(state.steps);
    $("set-noise").value = state.noise; $("out-noise").textContent = state.noise.toFixed(3);
    $("set-rot").value = state.rotationDeg; $("out-rot").textContent = `${state.rotationDeg}°`;
    $("set-cosine").checked = state.cosine;
  }
  const bindRange = (id, key, parse) => {
    $(id).addEventListener("input", (ev) => { state[key] = parse(ev.target.value); syncShared(); changed(); });
    $(id).addEventListener("change", () => changed("refit"));
  };
  bindRange("set-beta", "beta", Number);
  bindRange("set-steps", "steps", Number);
  bindRange("set-noise", "noise", Number);
  bindRange("set-rot", "rotationDeg", Number);
  $("set-cosine").addEventListener("change", (ev) => { state.cosine = ev.target.checked; changed("refit"); });
  $("reset").addEventListener("click", () => { state = defaults(); buildLanes(); syncShared(); updateTerrHeaders(); changed("refit"); });

  let changeTimer = null;
  function changed(mode) {
    runRace(mode);
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => { if (activeTab === "territories") startTerritories(); }, 300);
  }

  // ---------- Things to try ----------
  const TRIES = [
    { id: "judah", place: "9th & Judah" },
    { id: "glen", place: "Glen Park BART" },
    { id: "hayes", place: "Hayes Valley" },
    { id: "rotate", place: "Hayes Valley", set: { rotationDeg: 30 } },
    { id: "ocean", place: "Ocean Beach at Judah" },
    { id: "lion", place: "Ocean Beach at Judah", lanes: { 2: "lion" } },
    { id: "anneal", place: "Haight & Ashbury", lanes: { 3: "anneal" } },
    { id: "anneal-momentum", place: "Dolores Park", set: { beta: 0.95, noise: 0.08, cosine: true, steps: 3000 }, lr: { 1: 256 } },
  ];
  $("tries").innerHTML = TRIES.map((t, i) => `<button class="try" type="button" data-try="${i}"><b>${TEXT.cards[t.id].title}</b><span>${TEXT.cards[t.id].html}</span></button>`).join("");
  $("tries").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-try]");
    if (!b) return;
    const t = TRIES[Number(b.dataset.try)];
    state = defaults();
    Object.assign(state, t.set || {});
    for (const [i, opt] of Object.entries(t.lanes || {})) state.lanes[i] = { opt, lr: C.OPTIMIZERS[opt].lr[0] };
    for (const [i, lr] of Object.entries(t.lr || {})) state.lanes[i].lr = lr;
    start = placeStart(t.place);
    $("addr").value = "";
    $("race-hint").hidden = true;
    buildLanes(); syncShared(); updateTerrHeaders();
    showTab("race");
    changed("fly");
    $("tool").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  });

  // ---------- Climber cards ----------
  $("climber-cards").innerHTML = CLIMBER_ORDER.map((k) => [k, C.OPTIMIZERS[k]]).map(([k, o]) => `
    <article class="climber">
      <header><h3>${o.label}</h3><span class="tag">${TEXT.climbers[k].tag}</span></header>
      <pre>${o.rule}</pre>
      <p>${TEXT.climbers[k].html}</p>
    </article>`).join("");

  // ---------- Matrix toy (Muon's real job) ----------
  const MEM_KEYS = ["sgd", "adam", "muon"];
  const MEM_COLOR = { sgd: 0, adam: 2, muon: 3 }; // lane colours: SGD ink, Adam orange, Muon green
  const mem = { results: {}, rotated: true, step: 25, started: false };

  function memColor(k) { return col.lanes[MEM_COLOR[k]]; }
  function memLegend() {
    $("mem-legend").innerHTML = MEM_KEYS.map((k) =>
      `<span><svg width="18" height="10" aria-hidden="true"><line x1="0" y1="5" x2="18" y2="5" stroke="${memColor(k)}" stroke-width="2.5"/></svg>${C.MATRIX_OPTS[k].label} <span class="num" style="color:var(--muted)">η ${C.MATRIX_OPTS[k].lr}</span></span>`).join("");
  }

  function startMemory() {
    if (mem.started) return;
    mem.started = true;
    const { d, zipf, steps } = C.MEMORY;
    const jobs = [];
    for (const rotated of [true, false]) {
      const task = C.makeMemoryTask(d, rotated, zipf, 7);
      mem.task = task;
      for (const k of MEM_KEYS) jobs.push({ rotated, k, next: C.memoryTrainer(task, k, C.MATRIX_OPTS[k].lr), errs: [] });
    }
    const slice = () => {
      const t0 = performance.now();
      while (jobs.length && performance.now() - t0 < 14) {
        const j = jobs[0];
        j.errs.push(j.next());
        if (j.errs.length > steps) {
          jobs.shift();
          (mem.results[j.rotated ? "rot" : "aln"] ||= {})[j.k] = j.errs;
          if (Object.keys(mem.results[j.rotated ? "rot" : "aln"]).length === MEM_KEYS.length) renderMemory();
        }
      }
      if (jobs.length) setTimeout(slice, 0);
    };
    setTimeout(slice, 0);
  }

  const rareMean = (e) => { const d = e.length; let s = 0; for (let i = d / 2; i < d; i++) s += e[i]; return s / (d / 2); };

  function lineChart(svg, opts) {
    const W = 520, H = 280, m = { l: 40, r: opts.endLabels ? 62 : 16, t: 12, b: 34 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const X = (v) => m.l + (v - opts.x0) / (opts.x1 - opts.x0) * iw;
    const Y = (v) => m.t + (1 - v / opts.y1) * ih;
    let s = "";
    for (const v of opts.yTicks) {
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--rule)" stroke-width="1"/>`;
      s += `<text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="var(--font-mono)">${v.toFixed(2)}</text>`;
    }
    for (const v of opts.xTicks) {
      s += `<text x="${X(v)}" y="${H - m.b + 16}" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="var(--font-mono)">${v}</text>`;
    }
    s += `<text x="${m.l + iw / 2}" y="${H - 4}" text-anchor="middle" font-size="11.5" fill="var(--muted)">${opts.xLabel}</text>`;
    s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--muted)" stroke-width="1"/>`;
    if (opts.marker != null) s += `<line x1="${X(opts.marker)}" x2="${X(opts.marker)}" y1="${m.t}" y2="${Y(0)}" stroke="var(--brown)" stroke-width="1" stroke-dasharray="3 3"/>`;
    for (const sr of opts.series) {
      const d = sr.values.map((v, i) => `${i ? "L" : "M"}${X(opts.xOf(i)).toFixed(1)},${Y(Math.min(v, opts.y1)).toFixed(1)}`).join("");
      s += `<path d="${d}" fill="none" stroke="var(--sheet)" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>`;
      s += `<path d="${d}" fill="none" stroke="${sr.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    if (opts.endLabels) {
      // Direct labels at the right end, nudged apart so they never overlap.
      const ends = opts.series.map((sr) => ({ sr, y: Y(Math.min(sr.values[sr.values.length - 1], opts.y1)) })).sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 14);
      const over = ends[ends.length - 1].y - Y(0) - 4;
      if (over > 0) ends.forEach((e) => (e.y -= over));
      for (const e of ends) {
        s += `<line x1="${W - m.r + 4}" x2="${W - m.r + 12}" y1="${e.y}" y2="${e.y}" stroke="${e.sr.color}" stroke-width="2.2"/>`;
        s += `<text x="${W - m.r + 16}" y="${e.y + 4}" font-size="11.5" fill="var(--ink-2)">${e.sr.name}</text>`;
      }
    }
    s += `<g class="hover"></g><rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent" class="hit"/>`;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = s;
    // Hover: crosshair, dots and a tooltip.
    const hit = svg.querySelector(".hit"), g = svg.querySelector(".hover"), tip = opts.tip;
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const vx = (ev.clientX - r.left) / r.width * W;
      const i = Math.max(0, Math.min(opts.series[0].values.length - 1, Math.round((vx - m.l) / iw * (opts.series[0].values.length - 1))));
      const xv = X(opts.xOf(i));
      g.innerHTML = `<line x1="${xv}" x2="${xv}" y1="${m.t}" y2="${Y(0)}" stroke="var(--muted)" stroke-width="1"/>` +
        opts.series.map((sr) => `<circle cx="${xv}" cy="${Y(Math.min(sr.values[i], opts.y1))}" r="4" fill="${sr.color}" stroke="var(--sheet)" stroke-width="2"/>`).join("");
      tip.innerHTML = `<b>${opts.tipTitle(i)}</b>` + opts.series.map((sr) =>
        `<div class="row"><svg width="14" height="8" aria-hidden="true"><line x1="0" y1="4" x2="14" y2="4" stroke="${sr.color}" stroke-width="2.5"/></svg><span>${sr.name} <span class="num">${sr.values[i].toFixed(2)}</span></span></div>`).join("");
      const box = svg.parentElement.getBoundingClientRect();
      placeTip(tip, { px: ev.clientX - box.left, py: ev.clientY - box.top, w: box.width, h: box.height });
    };
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerleave", () => { g.innerHTML = ""; tip.hidden = true; });
  }

  function renderMemory() {
    const res = mem.results[mem.rotated ? "rot" : "aln"];
    if (!res) return;
    const steps = C.MEMORY.steps, d = C.MEMORY.d;
    lineChart($("svg-curve"), {
      x0: 0, x1: steps, y1: 1, yTicks: [0, 0.25, 0.5, 0.75, 1], xTicks: [0, 25, 50, 75, 100], xLabel: "Training step",
      xOf: (i) => i, marker: mem.step, tip: $("tip-curve"), tipTitle: (i) => `Step ${i}`, endLabels: true,
      series: MEM_KEYS.map((k) => ({ name: C.MATRIX_OPTS[k].label, color: memColor(k), values: res[k].map(rareMean) })),
    });
    lineChart($("svg-facts"), {
      x0: 1, x1: d, y1: 1, yTicks: [0, 0.25, 0.5, 0.75, 1], xTicks: [1, 16, 32, 48, 64], xLabel: "Fact, from most common to rarest",
      xOf: (i) => i + 1, marker: null, tip: $("tip-facts"),
      tipTitle: (i) => `Fact ${i + 1}: seen ${(mem.task.p[i] * 100).toFixed(mem.task.p[i] < 0.01 ? 2 : 1)}% of the time`,
      series: MEM_KEYS.map((k) => ({ name: C.MATRIX_OPTS[k].label, color: memColor(k), values: res[k][mem.step] })),
    });
    $("mem-step-label").textContent = mem.step;
    const at = (k, s) => rareMean(res[k][s]).toFixed(2);
    const other = mem.results[mem.rotated ? "aln" : "rot"];
    const adamOther = other ? rareMean(other.adam[mem.step]).toFixed(2) : "…";
    const num = (v) => `<span class="num">${v}</span>`;
    const vals = { step: num(mem.step), sgd: num(at("sgd", mem.step)), adam: num(at("adam", mem.step)), muon: num(at("muon", mem.step)), adam_other: num(adamOther) };
    $("mem-findings").innerHTML = mem.rotated ? tpl("matrix random", vals) : tpl("matrix aligned", vals);
  }
  $("mem-rot").addEventListener("click", () => { mem.rotated = true; $("mem-rot").setAttribute("aria-pressed", "true"); $("mem-aln").setAttribute("aria-pressed", "false"); renderMemory(); });
  $("mem-aln").addEventListener("click", () => { mem.rotated = false; $("mem-aln").setAttribute("aria-pressed", "true"); $("mem-rot").setAttribute("aria-pressed", "false"); renderMemory(); });
  $("mem-step").addEventListener("input", (ev) => { mem.step = Number(ev.target.value); $("out-mem-step").textContent = mem.step; renderMemory(); });

  // ---------- Boot ----------
  function renderAll() {
    readColors();
    buildBaseLayers();
    renderLegend();
    memLegend();
    buildLanes();
    updateTerrHeaders();
    if (activeTab === "race") { renderRaceBase(); drawRace(Infinity); } else renderTerritories();
    renderScores();
    renderMemory();
  }

  readColors();
  buildBaseLayers();
  buildLanes();
  syncShared();
  buildTerrCards();
  renderLegend();
  memLegend();
  // Open on the whole city, then glide in to frame the first race.
  computeRace();
  renderScores();
  raceFrame = fitFrame();
  showTab(location.hash === "#territories" ? "territories" : "race");
  renderRaceBase();
  drawRace(0);
  if (reduceMotion) { view = { ...raceFrame }; renderRaceBase(); playRace(); }
  else setTimeout(() => { if (activeTab === "race" && !fly && sameView(view, FULL)) flyTo(raceFrame, 0, playRace); else view = { ...raceFrame }; }, 700);

  // Redraw on resize and theme changes; start the background work once the map is up.
  let resizeTimer = null;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (activeTab === "race") { if (!fly) { renderRaceBase(); if (!anim) drawRace(Infinity); } } else renderTerritories();
    }, 120);
  }).observe($("tool"));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);
  new MutationObserver(renderAll).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (activeTab === "race") { if (!fly) renderRaceBase(); } else renderTerritories(); });
  setTimeout(() => { startTerritories(); startMemory(); }, 1200);
})();
