// Find starting points where the default optimizers end on different named
// hills — candidates for the page's "try these" presets.
const fs = require("node:fs");
const path = require("node:path");
const core = require("../web/src/core.js");
const meta = JSON.parse(fs.readFileSync(path.join(__dirname, "../web/data/terrain.json"), "utf8"));
const t = core.makeTerrain(meta, new Uint16Array(Buffer.from(meta.elev_cm_b64, "base64").buffer.slice(0)));
const lanes = ["sgd", "momentum", "adam", "muon"];
const shared = { beta: 0.9, noise: 0, steps: 1000, rotationDeg: 0, cosine: false };
const { west, north } = meta.bbox, lat0 = (meta.bbox.south + north) / 2;
const mLat = Math.PI * 6378137 / 180, mLon = mLat * Math.cos(lat0 * Math.PI / 180);
const out = [];
for (let y = 50; y < t.heightM; y += 100) for (let x = 50; x < t.widthM; x += 100) {
  if (core.heightAt(t, x, y) < 2) continue;
  const res = lanes.map((k) => {
    const r = core.climb(t, k, { ...shared, lr: core.OPTIMIZERS[k].lr[0] }, x, y, false);
    return core.classify(t, meta.hills, r.x, r.y);
  });
  const named = res.filter((r) => r.kind === "hill" && meta.hills[r.hill].named).map((r) => r.hill);
  const distinct = new Set(res.map((r) => (r.kind === "hill" ? r.hill : r.kind))).size;
  if (distinct >= 3 && new Set(named).size >= 3) {
    const place = meta.places.reduce((b, p) => {
      const d = Math.hypot((p.c + 0.5) * 20 - x, (p.r + 0.5) * 20 - y);
      return d < b[1] ? [p.name, d] : b;
    }, ["", 1e9]);
    out.push({ x, y, lat: (north - y / mLat).toFixed(5), lon: (west + x / mLon).toFixed(5), place: place[0],
      ends: res.map((r) => (r.kind === "hill" ? meta.hills[r.hill].name : r.kind)).join(" | "),
      score: distinct * 10 + new Set(named).size });
  }
}
out.sort((a, b) => b.score - a.score);
for (const o of out.slice(0, 40)) console.log(`${o.place.padEnd(16)} ${o.lat},${o.lon}  x=${o.x} y=${o.y}  ${o.ends}`);
console.log(out.length, "candidates");
