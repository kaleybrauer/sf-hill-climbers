// Run: node tests/core.test.js
const assert = require("node:assert");
const core = require("../web/src/core.js");

// A single smooth Gaussian hill, 100 m tall, on a 2 km square.
function gaussianHill() {
  const W = 101, H = 101, cell = 20;
  const dm = new Uint16Array(W * H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const dx = (c - 50) * cell, dy = (r - 50) * cell;
    dm[r * W + c] = Math.round(100 * (5 + 100 * Math.exp(-(dx * dx + dy * dy) / (2 * 350 * 350))));
  }
  return core.makeTerrain({ width: W, height: H, cell_m: cell }, dm);
}

const t = gaussianHill();
const top = { x: 50.5 * 20, y: 50.5 * 20 };
const hills = [{ name: "Top", r: 50, c: 50, elev: 105, edge: false }];
const base = { beta: 0.9, noise: 0, steps: 3000, rotationDeg: 0, cosine: false };
let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`ok   ${name}`); } catch (e) { failures++; console.log(`FAIL ${name}\n     ${e.message}`); }
}

for (const key of Object.keys(core.OPTIMIZERS)) {
  check(`${key} climbs a single hill`, () => {
    const s = { ...base, lr: core.OPTIMIZERS[key].lr[0] };
    const res = core.climb(t, key, s, 300, 1600, false);
    const d = Math.hypot(res.x - top.x, res.y - top.y);
    assert.ok(d < 60, `ended ${d.toFixed(1)} m from the top`);
    assert.strictEqual(core.classify(t, hills, res.x, res.y).kind, "hill");
  });
}

// Rotating the coordinate frame changes nothing for rotation-invariant rules.
for (const key of ["sgd", "momentum", "nesterov", "muon"]) {
  check(`${key} path is unchanged by rotating the axes`, () => {
    const s = { ...base, steps: 200, lr: core.OPTIMIZERS[key].lr[0] };
    const a = core.climb(t, key, s, 300, 1600, true).path;
    const b = core.climb(t, key, { ...s, rotationDeg: 30 }, 300, 1600, true).path;
    let maxd = 0;
    for (let i = 0; i < a.length; i += 2) maxd = Math.max(maxd, Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1]));
    assert.ok(maxd < 0.05, `paths differ by ${maxd.toFixed(3)} m`);
  });
}
for (const key of ["adam", "lion", "rmsprop", "adagrad"]) {
  check(`${key} path changes when the axes rotate`, () => {
    const s = { ...base, steps: 200, lr: core.OPTIMIZERS[key].lr[0] };
    const a = core.climb(t, key, s, 300, 1600, true).path;
    const b = core.climb(t, key, { ...s, rotationDeg: 30 }, 300, 1600, true).path;
    let maxd = 0;
    for (let i = 0; i < a.length; i += 2) maxd = Math.max(maxd, Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1]));
    assert.ok(maxd > 5, `paths only differ by ${maxd.toFixed(3)} m`);
  });
}

check("Adam's first step moves η along each axis, on flat and steep ground alike", () => {
  // Per-coordinate normalisation: the first step is η·sign(g) per axis, so a
  // diagonal step is √2·η long. This is Adam's diagonal bias.
  const s = { ...base, steps: 1, lr: 8 };
  const far = core.climb(t, "adam", s, 40, 40, true).path;   // nearly flat corner, diagonal slope
  const near = core.climb(t, "adam", s, 700, 1010, true).path; // steep flank
  for (const p of [far, near]) {
    const big = Math.max(Math.abs(p[2] - p[0]), Math.abs(p[3] - p[1]));
    assert.ok(Math.abs(big - 8) < 0.05, `largest axis move ${big.toFixed(3)} m`);
  }
  assert.ok(Math.abs(Math.hypot(far[2] - far[0], far[3] - far[1]) - 8 * Math.SQRT2) < 0.1);
});

check("SGD's first step scales with the slope", () => {
  const s = { ...base, steps: 1, lr: 100 };
  const far = core.climb(t, "sgd", s, 40, 40, true).path;
  const near = core.climb(t, "sgd", s, 700, 1010, true).path;
  assert.ok(Math.hypot(near[2] - near[0], near[3] - near[1]) > 20 * Math.hypot(far[2] - far[0], far[3] - far[1]));
});

check("Muon-2D step length is fixed (≈0.70 × lr)", () => {
  const s = { ...base, steps: 1, lr: 10 };
  for (const [x, y] of [[40, 40], [700, 1010], [1500, 300]]) {
    const p = core.climb(t, "muon", s, x, y, true).path;
    const len = Math.hypot(p[2] - p[0], p[3] - p[1]);
    assert.ok(Math.abs(len - 6.96) < 0.1, `step ${len.toFixed(3)} m`);
  }
});

check("Lion only moves diagonally", () => {
  const p = core.climb(t, "lion", { ...base, steps: 20, lr: 6 }, 300, 1600, true).path;
  for (let i = 2; i < p.length; i += 2) {
    assert.ok(Math.abs(Math.abs(p[i] - p[i - 2]) - Math.abs(p[i + 1] - p[i - 1])) < 1e-3);
  }
});

check("noise is reproducible for the same start", () => {
  const s = { ...base, steps: 300, lr: 100, noise: 0.03 };
  const a = core.climb(t, "sgd", s, 300, 1600, false), b = core.climb(t, "sgd", s, 300, 1600, false);
  assert.strictEqual(a.x, b.x); assert.strictEqual(a.y, b.y);
});

process.exitCode = failures ? 1 : 0;
console.log(failures ? `${failures} failed` : "all passed");

// The matrix toy: Muon and SGD don't care about the key basis; Adam does.
{
  const { d, zipf, steps } = core.MEMORY;
  const rare = (e) => e.slice(d / 2).reduce((a, b) => a + b, 0) / (d / 2);
  const run = (key, rotated) => rare(core.trainMemory(core.makeMemoryTask(d, rotated, zipf, 7), key, steps, core.MATRIX_OPTS[key].lr).errs[steps]);
  const r = {};
  for (const k of ["sgd", "adam", "muon"]) r[k] = [run(k, false), run(k, true)];
  check("memory toy: SGD and Muon are unchanged by rotating the keys", () => {
    assert.ok(Math.abs(r.sgd[0] - r.sgd[1]) < 1e-6 && Math.abs(r.muon[0] - r.muon[1]) < 1e-3, JSON.stringify(r));
  });
  check("memory toy: Adam is much worse on rare facts when keys are rotated", () => {
    assert.ok(r.adam[1] > 5 * r.adam[0], JSON.stringify(r.adam));
  });
  check("memory toy: Muon learns rare facts far better than SGD", () => {
    assert.ok(r.muon[1] < 0.1 * r.sgd[1], JSON.stringify(r));
  });
  process.exitCode = failures ? 1 : 0;
  console.log(failures ? `${failures} failed` : "all passed (incl. memory toy)");
}
