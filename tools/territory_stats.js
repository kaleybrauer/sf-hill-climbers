// How often do optimizers end on different hills? Runs every optimizer from a
// grid of starting points on the real terrain and prints outcome statistics.
// Usage: node tools/territory_stats.js [spacing_m] [json overrides]
//   e.g. node tools/territory_stats.js 120 '{"steps":1500,"noise":0.01}'
const fs = require("node:fs");
const path = require("node:path");
const core = require("../web/src/core.js");

const meta = JSON.parse(fs.readFileSync(path.join(__dirname, "../web/data/terrain.json"), "utf8"));
const t = core.makeTerrain(meta, new Uint16Array(Buffer.from(meta.elev_cm_b64, "base64").buffer.slice(0)));
const spacing = Number(process.argv[2] || 120);
const over = JSON.parse(process.argv[3] || "{}");
const lanes = over.lanes || ["sgd", "momentum", "adam", "muon"];
const shared = { beta: 0.9, noise: 0, steps: 1500, rotationDeg: 0, cosine: false, ...over };

const starts = [];
for (let y = spacing / 2; y < t.heightM; y += spacing)
  for (let x = spacing / 2; x < t.widthM; x += spacing)
    if (core.heightAt(t, x, y) > 1) starts.push([x, y]);

const codes = {};
const t0 = Date.now();
let totalSteps = 0;
for (const key of lanes) {
  const lr = (over.lr && over.lr[key]) || core.OPTIMIZERS[key].lr[0];
  codes[key] = starts.map(([x, y]) => {
    const r = core.climb(t, key, { ...shared, lr }, x, y, false);
    totalSteps += r.steps;
    return core.outcomeCode(core.classify(t, meta.hills, r.x, r.y));
  });
}
const secs = (Date.now() - t0) / 1000;
const name = (c) => (c >= 0 ? meta.hills[c].name : { [-1]: "small bump", [-2]: "ran out of steps", [-3]: "left the city" }[c]);
console.log(`${starts.length} land starts at ${spacing} m; ${secs.toFixed(1)} s; ${(totalSteps / secs / 1e6).toFixed(1)} M steps/s`);
for (const key of lanes) {
  const c = codes[key];
  const frac = (f) => ((100 * c.filter(f).length) / c.length).toFixed(0).padStart(3) + "%";
  const hillsReached = new Set(c.filter((v) => v >= 0)).size;
  console.log(`${key.padEnd(9)} hill ${frac((v) => v >= 0)}  bump ${frac((v) => v === -1)}  stalled ${frac((v) => v === -2)}  left ${frac((v) => v === -3)}  distinct hills ${hillsReached}`);
}
let allAgree = 0;
const pair = {};
for (let i = 0; i < starts.length; i++) {
  const v = lanes.map((k) => codes[k][i]);
  if (v.every((x) => x === v[0])) allAgree++;
  for (let a = 0; a < lanes.length; a++) for (let b = a + 1; b < lanes.length; b++) {
    const k = lanes[a] + "/" + lanes[b];
    pair[k] = (pair[k] || 0) + (v[a] !== v[b] ? 1 : 0);
  }
}
console.log(`all ${lanes.length} agree at ${((100 * allAgree) / starts.length).toFixed(0)}% of starts`);
for (const [k, n] of Object.entries(pair)) console.log(`  ${k.padEnd(18)} disagree ${((100 * n) / starts.length).toFixed(0)}%`);
// Disagreement where both reached a real hill (different hills, not just "one stalled").
let bothHill = 0, diffHill = 0;
for (let i = 0; i < starts.length; i++) {
  const v = lanes.map((k) => codes[k][i]).filter((x) => x >= 0);
  if (v.length >= 2) { bothHill++; if (new Set(v).size > 1) diffHill++; }
}
console.log(`where 2+ optimizers reached a hill, they named different hills ${((100 * diffHill) / bothHill).toFixed(0)}% of the time`);
if (over.top) {
  for (const key of lanes) {
    const cnt = {};
    codes[key].forEach((c) => (cnt[name(c)] = (cnt[name(c)] || 0) + 1));
    console.log(key, Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, k]) => `${n} ${k}`).join(", "));
  }
}
