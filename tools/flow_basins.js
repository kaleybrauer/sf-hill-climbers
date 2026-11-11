// How close is each optimizer's basin map to the terrain's own basins (where
// steepest ascent in tiny steps leads)? Checks the SGD-baseline line on the page.
// Usage: node tools/flow_basins.js [spacing_m]
const fs = require("node:fs");
const path = require("node:path");
const core = require("../web/src/core.js");

const meta = JSON.parse(fs.readFileSync(path.join(__dirname, "../web/data/terrain.json"), "utf8"));
const t = core.makeTerrain(meta, new Uint16Array(Buffer.from(meta.elev_cm_b64, "base64").buffer.slice(0)));
const sp = Number(process.argv[2] || 180);
const starts = [];
for (let y = sp / 2; y < t.heightM; y += sp)
  for (let x = sp / 2; x < t.widthM; x += sp)
    if (core.heightAt(t, x, y) > 1) starts.push([x, y]);
const end = (k, s, x, y) => {
  const r = core.climb(t, k, { rotationDeg: 0, noise: 0, cosine: false, ...s }, x, y, false);
  return core.outcomeCode(core.classify(t, meta.hills, r.x, r.y));
};
// Muon-2D with β = 0 is normalized gradient ascent, so 2 m steps trace the steepest-ascent curve.
const flow = starts.map(([x, y]) => end("muon", { lr: 2, beta: 0, steps: 40000 }, x, y));
console.log(`${starts.length} land starts at ${sp} m`);
const runs = [
  ["SGD default", "sgd", { lr: 100, beta: 0.9, steps: 1000 }],
  ["Momentum default", "momentum", { lr: 30, beta: 0.9, steps: 1000 }],
  ["Adam default", "adam", { lr: 8, beta: 0.9, steps: 1000 }],
  ["Muon default", "muon", { lr: 10, beta: 0.9, steps: 1000 }],
  ["Lion default", "lion", { lr: 6, beta: 0.9, steps: 1000 }],
  ["SGD tiny η", "sgd", { lr: 20, beta: 0.9, steps: 20000 }],
  ["Momentum tiny η", "momentum", { lr: 3, beta: 0.9, steps: 20000 }],
  ["Adam tiny η", "adam", { lr: 1, beta: 0.9, steps: 20000 }],
  ["Lion tiny η", "lion", { lr: 1, beta: 0.9, steps: 20000 }],
];
for (const [name, k, s] of runs) {
  let same = 0, both = 0, sameAll = 0;
  starts.forEach(([x, y], i) => {
    const v = end(k, s, x, y);
    if (v === flow[i]) sameAll++;
    if (v >= 0 && flow[i] >= 0) { both++; if (v === flow[i]) same++; }
  });
  console.log(`${name.padEnd(17)} same top as steepest ascent at ${((100 * sameAll) / starts.length).toFixed(0).padStart(3)}% of starts (${((100 * same) / both).toFixed(0)}% where both reach a top)`);
}
