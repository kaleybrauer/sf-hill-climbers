// Checks the "Aim for the high ground" card and its footnote: how often tuned
// settings reach the highest summits, and whether that is luck of this map.
// Usage: node tools/global_reach.js [spacing_m]
const fs = require("node:fs");
const path = require("node:path");
const core = require("../web/src/core.js");

const meta = JSON.parse(fs.readFileSync(path.join(__dirname, "../web/data/terrain.json"), "utf8"));
const base = new Uint16Array(Buffer.from(meta.elev_cm_b64, "base64").buffer.slice(0));
const spacing = Number(process.argv[2] || 120);
const { west, north, south } = meta.bbox, lat0 = (south + north) / 2;
const mLat = Math.PI * 6378137 / 180, mLon = mLat * Math.cos(lat0 * Math.PI / 180);
const xy = (la, lo) => [(lo - west) * mLon, (north - la) * mLat];
const hillIdx = (n) => meta.hills.findIndex((h) => h.name === n);
const DAV = hillIdx("Mount Davidson");
const TOP4 = new Set(["Mount Davidson", "Twin Peaks · south", "Twin Peaks · north", "Mount Sutro"].map(hillIdx));
const pct = (n, d) => ((100 * n) / d).toFixed(1).padStart(5) + "%";

function landStarts(t) {
  const s = [];
  for (let y = spacing / 2; y < t.heightM; y += spacing)
    for (let x = spacing / 2; x < t.widthM; x += spacing)
      if (core.heightAt(t, x, y) > 1) s.push([x, y]);
  return s;
}
const ANNEAL = { noise: 0.08, cosine: true, steps: 3000, rotationDeg: 0 };
const DEFAULT = { beta: 0.9, noise: 0, cosine: false, steps: 1000, rotationDeg: 0 };
const PRESET = { ...ANNEAL, lr: 256, beta: 0.95 };

const t = core.makeTerrain(meta, base);
const starts = landStarts(t);
console.log(`${starts.length} land starts at ${spacing} m`);
function reach(key, s) {
  let dav = 0, top = 0;
  for (const [x, y] of starts) {
    const r = core.climb(t, key, s, x, y, false);
    const c = core.outcomeCode(core.classify(t, meta.hills, r.x, r.y));
    if (c === DAV) dav++;
    if (TOP4.has(c)) top++;
  }
  return `top 4 ${pct(top, starts.length)}  Davidson ${pct(dav, starts.length)} (${pct(dav, top)} of top-4 endings)`;
}

// 1. The preset, its ablations, and Momentum at its defaults.
console.log("preset                  ", reach("momentum", PRESET));
console.log("preset without noise    ", reach("momentum", { ...PRESET, noise: 0 }));
console.log("preset without decay    ", reach("momentum", { ...PRESET, cosine: false }));
console.log("momentum defaults       ", reach("momentum", { ...DEFAULT, lr: 30 }));

// 2. Each optimizer at the best settings found by sweeping the sliders
//    (η up to each slider's max, β, noise; cosine decay and 3000 steps).
const BEST = {
  lion: { lr: 60, beta: 0.99, noise: 0.06 }, momentum: { lr: 180, beta: 0.97 }, nesterov: { lr: 362, beta: 0.95 },
  muon: { lr: 80, beta: 0.99 }, sgd: { lr: 2000, beta: 0.9 }, adam: { lr: 60, beta: 0.99 },
};
for (const [k, b] of Object.entries(BEST)) console.log(`best ${k.padEnd(19)}`, reach(k, { ...ANNEAL, ...b }));

// 3. Move the global maximum: add a peak in Bayview, narrow or broad.
const W = meta.width, H = meta.height, cell = meta.cell_m;
for (const sigma of [150, 600]) {
  const [px, py] = xy(37.7337, -122.3911);
  const e = new Uint16Array(base);
  let peak = 0;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const d2 = ((c + 0.5) * cell - px) ** 2 + ((r + 0.5) * cell - py) ** 2;
    e[r * W + c] = Math.min(65535, e[r * W + c] + Math.round(28000 * Math.exp(-d2 / (2 * sigma * sigma))));
    peak = Math.max(peak, e[r * W + c]);
  }
  const tb = core.makeTerrain(meta, e);
  const sb = landStarts(tb);
  const found = (s) => sb.filter(([x, y]) => { const r = core.climb(tb, "momentum", s, x, y, false); return core.heightAt(tb, r.x, r.y) > peak / 100 - 3; }).length;
  console.log(`Bayview peak (sigma ${sigma} m, ${(peak / 100 * 3.2808).toFixed(0)} ft): defaults reach it ${pct(found({ ...DEFAULT, lr: 30 }), sb.length)}, preset ${pct(found(PRESET), sb.length)}`);
}
