// Run: node tests/geocode.test.js   (needs web/data/terrain.json)
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { makeGeocoder } = require("../web/src/geocode.js");

const meta = JSON.parse(fs.readFileSync(path.join(__dirname, "../web/data/terrain.json"), "utf8"));
const lat0 = (meta.bbox.south + meta.bbox.north) / 2;
const mLat = Math.PI * 6378137 / 180, mLon = mLat * Math.cos(lat0 * Math.PI / 180);
const xy = (la, lo) => ({ x: (lo - meta.bbox.west) * mLon, y: (meta.bbox.north - la) * mLat });
const g = makeGeocoder(meta, [{ name: "16th St BART", kind: "preset", ...xy(37.7650, -122.4197) }]);

let failures = 0;
function near(query, la, lo, tol, kind) {
  try {
    const r = g.search(query);
    assert.ok(!r.error, r.error);
    const p = r.lat != null ? xy(r.lat, r.lon) : r;
    const want = xy(la, lo);
    const d = Math.hypot(p.x - want.x, p.y - want.y);
    assert.ok(d <= tol, `${Math.round(d)} m away (label "${r.label}")`);
    if (kind) assert.strictEqual(r.kind, kind);
    console.log(`ok   ${query.padEnd(34)} -> ${r.label} (${Math.round(d)} m)`);
  } catch (e) { failures++; console.log(`FAIL ${query}\n     ${e.message}`); }
}
function fails(query, hint) {
  const r = g.search(query);
  const ok = !!r.error && (!hint || (r.suggestions || []).some((s) => s.includes(hint)));
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${query.padEnd(34)} -> ${r.error || r.label} ${r.suggestions ? JSON.stringify(r.suggestions) : ""}`);
}

near("Valencia & 24th", 37.7524, -122.4207, 60, "intersection");
near("valencia st and 24th street", 37.7524, -122.4207, 60, "intersection");
near("Haight and Ashbury", 37.7699, -122.4469, 60, "intersection");
near("Irving & 19th Ave", 37.7639, -122.4770, 60, "intersection");
near("Castro / 18th", 37.7609, -122.4350, 60, "intersection");
near("Dolores Park", 37.7596, -122.4269, 250, "place");
near("16th St BART", 37.7650, -122.4197, 120, "place");
near("Glen Park BART", 37.7330, -122.4338, 150, "place");
near("Coit Tower", 37.8024, -122.4058, 150, "place");
near("Twin Peaks", 37.7530, -122.4474, 400, "place");
near("Mount Davidson", 37.7383, -122.4541, 150, "place");
near("37.76, -122.42", 37.76, -122.42, 5, "coords");
near("500 Valencia St", 37.7647, -122.4219, 120, "address");
near("3500 20th St", 37.7588, -122.4192, 40, "address");
near("1 Dr Carlton B Goodlett Pl", 37.7793, -122.4193, 200);
near("2000 Hayes St, San Francisco, CA 94117", 37.7736, -122.4495, 60, "address");
near("Valencia St", 37.7600, -122.4214, 2000, "street");
fails("Valencai St", "Valencia");
fails("99999 Valencia St");
fails("Nowhere Street & Valencia");

process.exitCode = failures ? 1 : 0;
console.log(failures ? `${failures} failed` : "all passed");
