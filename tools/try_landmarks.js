// Where do the default optimizers go from well-known places?
const fs = require("node:fs");
const path = require("node:path");
const core = require("../web/src/core.js");
const meta = JSON.parse(fs.readFileSync(path.join(__dirname, "../web/data/terrain.json"), "utf8"));
const t = core.makeTerrain(meta, new Uint16Array(Buffer.from(meta.elev_cm_b64, "base64").buffer.slice(0)));
const lanes = (process.argv[2] || "sgd,momentum,adam,muon").split(",");
const shared = { beta: 0.9, noise: 0, steps: 1000, rotationDeg: 0, cosine: false, ...JSON.parse(process.argv[3] || "{}") };
const { west, north } = meta.bbox, lat0 = (meta.bbox.south + north) / 2;
const mLat = Math.PI * 6378137 / 180, mLon = mLat * Math.cos(lat0 * Math.PI / 180);
const P = {
  "Dolores Park": [37.7596, -122.4269], "16th St BART": [37.7650, -122.4197], "Haight & Ashbury": [37.7699, -122.4469],
  "24th & Castro": [37.7516, -122.4339], "de Young": [37.7715, -122.4687], "Ocean Beach (Judah)": [37.7605, -122.5080],
  "Oracle Park": [37.7786, -122.3893], "Glen Park BART": [37.7330, -122.4338], "NoPa (Divis & Fell)": [37.7738, -122.4378],
  "Stern Grove": [37.7360, -122.4770], "Balboa Park BART": [37.7213, -122.4475], "Chinatown": [37.7955, -122.4064],
  "24th & Valencia": [37.7524, -122.4207], "Presidio Main Post": [37.8007, -122.4570], "9th & Irving": [37.7640, -122.4663],
  "Sunset Blvd & Irving": [37.7630, -122.4950], "Cole Valley": [37.7656, -122.4500], "Hayes Valley": [37.7765, -122.4242],
  "Bayview (3rd & Palou)": [37.7337, -122.3911], "Civic Center": [37.7793, -122.4176], "Japantown": [37.7854, -122.4294],
  "Marina Green": [37.8036, -122.4368], "Clement & 6th": [37.7829, -122.4642], "West Portal Ave": [37.7405, -122.4660],
  "Excelsior (Mission & Geneva)": [37.7166, -122.4410], "Twin Peaks Blvd": [37.7550, -122.4440], "SF State": [37.7241, -122.4799],
  "Ferry Building": [37.7953, -122.3940], "Bernal (Cortland)": [37.7390, -122.4160], "Mission Bay": [37.7700, -122.3920],
};
for (const [name, [la, lo]] of Object.entries(P)) {
  const x = (lo - west) * mLon, y = (north - la) * mLat;
  const ends = lanes.map((k) => {
    const r = core.climb(t, k, { ...shared, lr: (shared.lr && shared.lr[k]) || core.OPTIMIZERS[k].lr[0] }, x, y, false);
    const c = core.classify(t, meta.hills, r.x, r.y);
    return (c.kind === "hill" ? `${meta.hills[c.hill].name} (${meta.hills[c.hill].summit_ft})` : c.kind) + ` ${r.steps}`;
  });
  console.log(`${name.padEnd(28)} ${String(Math.round(core.heightAt(t, x, y) * 3.28)).padStart(4)} ft  ${ends.join(" | ")}`);
}
