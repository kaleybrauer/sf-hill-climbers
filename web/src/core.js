// Optimizer core: terrain sampling, the update rules, running and classifying
// a climb, and the matrix toy problem. Runs in the page and in Node (tests).
(function (root) {
  "use strict";

  // ---------- Terrain ----------

  // elevCm: Uint16Array of elevations in centimetres, row 0 = north.
  // Positions are in metres: x east, y south, measured from the NW corner.
  function makeTerrain(meta, elevCm) {
    const W = meta.width, H = meta.height, cell = meta.cell_m;
    const h = new Float32Array(W * H);
    for (let i = 0; i < h.length; i++) h[i] = elevCm[i] / 100;
    // Slope field (metres of rise per metre), central differences.
    const gx = new Float32Array(W * H), gy = new Float32Array(W * H);
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const i = r * W + c;
        const cl = Math.max(c - 1, 0), cr = Math.min(c + 1, W - 1);
        const ru = Math.max(r - 1, 0), rd = Math.min(r + 1, H - 1);
        gx[i] = (h[r * W + cr] - h[r * W + cl]) / ((cr - cl) * cell);
        gy[i] = (h[rd * W + c] - h[ru * W + c]) / ((rd - ru) * cell);
      }
    }
    return { W, H, cell, h, gx, gy, widthM: W * cell, heightM: H * cell };
  }

  function bilinear(t, arr, x, y) {
    let fx = x / t.cell - 0.5, fy = y / t.cell - 0.5;
    fx = Math.min(Math.max(fx, 0), t.W - 1.001);
    fy = Math.min(Math.max(fy, 0), t.H - 1.001);
    const c = fx | 0, r = fy | 0, ax = fx - c, ay = fy - r;
    const i = r * t.W + c;
    return (arr[i] * (1 - ax) + arr[i + 1] * ax) * (1 - ay) +
           (arr[i + t.W] * (1 - ax) + arr[i + t.W + 1] * ax) * ay;
  }

  const heightAt = (t, x, y) => bilinear(t, t.h, x, y);
  const slopeAt = (t, x, y) => [bilinear(t, t.gx, x, y), bilinear(t, t.gy, x, y)];

  // ---------- Optimizers ----------
  // Each minimises loss = -elevation, so the gradient handed to step() is
  // minus the slope. step() returns the displacement in metres.

  const NS = [3.4445, -4.7750, 2.0315]; // Muon's quintic Newton-Schulz coefficients

  const OPTIMIZERS = {
    sgd: {
      label: "SGD", lr: [100, 5, 2000], lrUnit: "m per unit slope",
      rule: "x ← x − η·g",
      init: () => ({}),
      step(s, g0, g1, lr) { return [-lr * g0, -lr * g1]; },
    },
    momentum: {
      label: "Momentum", lr: [30, 1, 500], lrUnit: "m per unit slope",
      rule: "v ← βv + g\nx ← x − η·v",
      init: () => ({ v0: 0, v1: 0 }),
      step(s, g0, g1, lr, hp) {
        s.v0 = hp.beta * s.v0 + g0; s.v1 = hp.beta * s.v1 + g1;
        return [-lr * s.v0, -lr * s.v1];
      },
    },
    nesterov: {
      label: "Nesterov", lr: [30, 1, 500], lrUnit: "m per unit slope",
      rule: "v ← βv + g\nx ← x − η·(g + βv)",
      init: () => ({ v0: 0, v1: 0 }),
      step(s, g0, g1, lr, hp) {
        s.v0 = hp.beta * s.v0 + g0; s.v1 = hp.beta * s.v1 + g1;
        return [-lr * (g0 + hp.beta * s.v0), -lr * (g1 + hp.beta * s.v1)];
      },
    },
    adam: {
      label: "Adam", lr: [8, 0.5, 60], lrUnit: "m per step",
      rule: "m ← β₁m + (1−β₁)g\nv ← β₂v + (1−β₂)g²\nx ← x − η·m̂ / (√v̂ + ε)",
      init: () => ({ m0: 0, m1: 0, v0: 0, v1: 0, t: 0 }),
      step(s, g0, g1, lr, hp) {
        const b1 = hp.beta, b2 = 0.999;
        s.t++;
        s.m0 = b1 * s.m0 + (1 - b1) * g0; s.m1 = b1 * s.m1 + (1 - b1) * g1;
        s.v0 = b2 * s.v0 + (1 - b2) * g0 * g0; s.v1 = b2 * s.v1 + (1 - b2) * g1 * g1;
        const c1 = 1 - Math.pow(b1, s.t), c2 = 1 - Math.pow(b2, s.t);
        return [-lr * (s.m0 / c1) / (Math.sqrt(s.v0 / c2) + 1e-8),
                -lr * (s.m1 / c1) / (Math.sqrt(s.v1 / c2) + 1e-8)];
      },
    },
    rmsprop: {
      label: "RMSprop", lr: [4, 0.5, 60], lrUnit: "m per step",
      rule: "v ← ρv + (1−ρ)g²\nx ← x − η·g / (√v + ε)",
      init: () => ({ v0: 0, v1: 0 }),
      step(s, g0, g1, lr) {
        s.v0 = 0.99 * s.v0 + 0.01 * g0 * g0; s.v1 = 0.99 * s.v1 + 0.01 * g1 * g1;
        return [-lr * g0 / (Math.sqrt(s.v0) + 1e-8), -lr * g1 / (Math.sqrt(s.v1) + 1e-8)];
      },
    },
    adagrad: {
      label: "Adagrad", lr: [60, 2, 600], lrUnit: "m per step at the start",
      rule: "G ← G + g²\nx ← x − η·g / (√G + ε)",
      init: () => ({ G0: 0, G1: 0 }),
      step(s, g0, g1, lr) {
        s.G0 += g0 * g0; s.G1 += g1 * g1;
        return [-lr * g0 / (Math.sqrt(s.G0) + 1e-8), -lr * g1 / (Math.sqrt(s.G1) + 1e-8)];
      },
    },
    lion: {
      label: "Lion", lr: [6, 0.5, 60], lrUnit: "m per axis per step",
      rule: "u ← sign(β₁m + (1−β₁)g)\nm ← β₂m + (1−β₂)g\nx ← x − η·u",
      init: () => ({ m0: 0, m1: 0 }),
      step(s, g0, g1, lr, hp) {
        const c0 = hp.beta * s.m0 + (1 - hp.beta) * g0, c1 = hp.beta * s.m1 + (1 - hp.beta) * g1;
        s.m0 = 0.99 * s.m0 + 0.01 * g0; s.m1 = 0.99 * s.m1 + 0.01 * g1;
        return [-lr * Math.sign(c0), -lr * Math.sign(c1)];
      },
    },
    muon: {
      label: "Muon (2D)", lr: [10, 0.5, 80], lrUnit: "≈ m per step ÷ 0.7",
      rule: "m ← βm + g\nX ← (g + βm) / ‖g + βm‖\nrepeat 5×: X ← (a + b‖X‖² + c‖X‖⁴)·X\nx ← x − η·X",
      init: () => ({ m0: 0, m1: 0 }),
      step(s, g0, g1, lr, hp) {
        s.m0 = hp.beta * s.m0 + g0; s.m1 = hp.beta * s.m1 + g1;
        let x0 = g0 + hp.beta * s.m0, x1 = g1 + hp.beta * s.m1; // Nesterov form, as in Muon
        const n = Math.hypot(x0, x1) + 1e-7;
        x0 /= n; x1 /= n;
        // Newton-Schulz on the 1x2 matrix [x0 x1]: XXᵀ is the scalar ‖X‖².
        for (let k = 0; k < 5; k++) {
          const q = x0 * x0 + x1 * x1, f = NS[0] + NS[1] * q + NS[2] * q * q;
          x0 *= f; x1 *= f;
        }
        return [-lr * x0, -lr * x1];
      },
    },
  };

  // ---------- Running a climb ----------

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // settings: { lr, beta, noise, steps, rotationDeg, cosine }
  // Returns the end point, net displacement over the last 100 steps, the
  // number of steps taken, and (if record) the path as [x0,y0,x1,y1,...].
  function climb(t, optKey, settings, x, y, record) {
    const opt = OPTIMIZERS[optKey];
    const s = opt.init();
    const th = (settings.rotationDeg || 0) * Math.PI / 180;
    const cs = Math.cos(th), sn = Math.sin(th);
    const steps = settings.steps;
    const rand = mulberry32(((x * 73856093) ^ (y * 19349663)) | 0);
    const path = record ? new Float32Array(2 * (steps + 1)) : null;
    if (path) { path[0] = x; path[1] = y; }
    const xmin = 0.5 * t.cell, xmax = t.widthM - 0.5 * t.cell;
    const ymin = 0.5 * t.cell, ymax = t.heightM - 0.5 * t.cell;
    const hist = new Float32Array(2 * 101); // ring buffer of the last 100 positions
    let k = 0, settledAt = -1;
    for (; k < steps; k++) {
      hist[2 * (k % 101)] = x; hist[2 * (k % 101) + 1] = y;
      // Gradient of loss = -elevation, plus optional Gaussian noise.
      let g0 = -bilinear(t, t.gx, x, y), g1 = -bilinear(t, t.gy, x, y);
      if (settings.noise > 0) {
        const u1 = rand() || 1e-9, u2 = rand();
        const rr = settings.noise * Math.sqrt(-2 * Math.log(u1));
        g0 += rr * Math.cos(2 * Math.PI * u2); g1 += rr * Math.sin(2 * Math.PI * u2);
      }
      // Into the rotated frame the optimizer sees, step, and back out.
      const lr = settings.lr * (settings.cosine ? 0.5 * (1 + Math.cos(Math.PI * k / steps)) : 1);
      const d = opt.step(s, cs * g0 + sn * g1, -sn * g0 + cs * g1, lr, settings);
      x += cs * d[0] - sn * d[1];
      y += sn * d[0] + cs * d[1];
      if (!(x === x) || !(y === y)) { x = hist[2 * (k % 101)]; y = hist[2 * (k % 101) + 1]; }
      x = Math.min(Math.max(x, xmin), xmax);
      y = Math.min(Math.max(y, ymin), ymax);
      if (path) { path[2 * k + 2] = x; path[2 * k + 3] = y; }
      // Converged: moved less than half a metre over the last 100 steps.
      if (k >= 100 && settledAt < 0) {
        const j = (k + 1) % 101;
        if (Math.hypot(x - hist[2 * j], y - hist[2 * j + 1]) < 0.5) { settledAt = k + 1; if (!record) { k++; break; } }
      }
    }
    const j = k % 101, back = Math.min(k, 100);
    const jb = (k - back) % 101;
    const disp = k >= 100 ? Math.hypot(x - hist[2 * jb], y - hist[2 * jb + 1]) : Infinity;
    return { x, y, disp, steps: k, settledAt: settledAt < 0 ? null : settledAt,
             path: path ? path.subarray(0, 2 * (k + 1)) : null };
  }

  // ---------- Where did it end up? ----------
  // Walk uphill on the grid from the end point to the top it sits under. If the
  // optimizer is within ARRIVED_M of that top it has arrived: kind "hill" (a top
  // with real prominence) or "bump" (a trivial micro-top). Otherwise it ran out
  // of steps while still climbing: "stalled". "left" means it crossed the city
  // line or ended in the water.
  const ARRIVED_M = 2.5;

  // Index the destination tops by grid cell once per hills list.
  function hillIndex(t, hills) {
    if (hills._index) return hills._index;
    const idx = new Map();
    hills.forEach((hl, i) => idx.set(hl.r * t.W + hl.c, i));
    Object.defineProperty(hills, "_index", { value: idx, enumerable: false });
    return idx;
  }

  function ascend(t, r, c) {
    for (;;) {
      let br = r, bc = c, bh = t.h[r * t.W + c];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= t.H || cc >= t.W) continue;
        const v = t.h[rr * t.W + cc];
        if (v > bh) { bh = v; br = rr; bc = cc; }
      }
      if (br === r && bc === c) return [r, c];
      r = br; c = bc;
    }
  }

  function topAt(t, hills, r, c) {
    const idx = hillIndex(t, hills);
    const exact = idx.get(r * t.W + c);
    if (exact !== undefined) return exact;
    // A flat-topped summit can stop the walk a few cells short of the recorded top.
    let best = -1, bestD = 7;
    for (let i = 0; i < hills.length; i++) {
      const hl = hills[i], d = Math.hypot(hl.r - r, hl.c - c);
      if (d < bestD && Math.abs(hl.elev - t.h[r * t.W + c]) < 0.3) { best = i; bestD = d; }
    }
    return best;
  }

  // Returns { kind, hill (index or -1), top (elevation in m of the top above
  // the end point; where it would have arrived) }.
  function classify(t, hills, x, y) {
    const hp = heightAt(t, x, y);
    if (hp < 0.5 || y > t.heightM - 1.5 * t.cell) return { kind: "left", hill: -1, top: hp };
    const [r, c] = ascend(t, Math.round(y / t.cell - 0.5), Math.round(x / t.cell - 0.5));
    const top = t.h[r * t.W + c];
    if (top - hp > ARRIVED_M) return { kind: "stalled", hill: -1, top };
    const i = topAt(t, hills, r, c);
    if (i < 0) return { kind: "bump", hill: -1, top };
    return { kind: hills[i].edge ? "left" : "hill", hill: i, top };
  }

  // Outcome code for maps: hill index >= 0, or one of these.
  const BUMP = -1, STALLED = -2, LEFT = -3;
  function outcomeCode(res) {
    return res.kind === "hill" ? res.hill : res.kind === "bump" ? BUMP : res.kind === "stalled" ? STALLED : LEFT;
  }

  // ---------- Matrix toy problem (associative memory) ----------
  // Learn W (d x d) so that W k_i ≈ v_i for n facts seen with Zipf frequency
  // p_i ∝ 1/i. Keys either line up with the coordinate axes or are rotated by
  // a random orthogonal matrix; values are orthonormal.

  function randomOrthogonal(d, rand) {
    const Q = [];
    for (let i = 0; i < d; i++) {
      let v = Array.from({ length: d }, () => {
        const u1 = rand() || 1e-9, u2 = rand();
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      });
      for (const q of Q) { const dot = v.reduce((a, x, j) => a + x * q[j], 0); v = v.map((x, j) => x - dot * q[j]); }
      const n = Math.hypot(...v); Q.push(v.map((x) => x / n));
    }
    return Q; // rows are orthonormal
  }

  function makeMemoryTask(d, rotated, zipf, seed) {
    const rand = mulberry32(seed || 7);
    const V = randomOrthogonal(d, rand);
    const R = randomOrthogonal(d, rand);
    const K = rotated ? R : Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => (i === j ? 1 : 0)));
    const z = Array.from({ length: d }, (_, i) => Math.pow(i + 1, -(zipf || 1)));
    const Z = z.reduce((a, b) => a + b, 0);
    return { d, K, V, p: z.map((x) => x / Z) };
  }

  // Errors ‖W k_i − v_i‖ for every fact, and the gradient of the expected
  // loss Σ p_i ‖W k_i − v_i‖² / 2 (facts weighted by how often they appear).
  function memoryGrad(task, W) {
    const { d, K, V } = task;
    const E = [], err = new Float64Array(d);
    for (let i = 0; i < d; i++) {
      const e = new Float64Array(d);
      for (let a = 0; a < d; a++) {
        let s = -V[i][a];
        for (let b = 0; b < d; b++) s += W[a * d + b] * K[i][b];
        e[a] = s;
      }
      E.push(e);
      err[i] = Math.hypot(...e);
    }
    const G = new Float64Array(d * d);
    for (let i = 0; i < d; i++) {
      for (let a = 0; a < d; a++) for (let b = 0; b < d; b++) G[a * d + b] += task.p[i] * E[i][a] * K[i][b];
    }
    return { G, err };
  }

  function matmul(A, B, n, m, k) { // (n x m)(m x k)
    const C = new Float64Array(n * k);
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      const a = A[i * m + j];
      if (a) for (let l = 0; l < k; l++) C[i * k + l] += a * B[j * k + l];
    }
    return C;
  }
  function transpose(A, n, m) { const T = new Float64Array(n * m); for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) T[j * n + i] = A[i * m + j]; return T; }

  function newtonSchulz(G, d) {
    let n = 0; for (const v of G) n += v * v;
    let X = G.map((v) => v / (Math.sqrt(n) + 1e-7));
    for (let k = 0; k < 5; k++) {
      const A = matmul(X, transpose(X, d, d), d, d, d);
      const AA = matmul(A, A, d, d, d);
      const B = A.map((v, i) => NS[1] * v + NS[2] * AA[i]);
      const BX = matmul(B, X, d, d, d);
      X = X.map((v, i) => NS[0] * v + BX[i]);
    }
    return X;
  }

  // The toy problem shown on the page: 64 facts, Zipf exponent 1.5, 100 steps.
  // Learning rates are each optimizer's best (lowest mean error at step 100) on
  // a grid search, found by tools/tune_memory.js; they are the same for aligned
  // and rotated keys.
  const MEMORY = { d: 64, zipf: 1.5, steps: 100 };
  const MATRIX_OPTS = {
    sgd: { label: "SGD", lr: 4 },
    adam: { label: "Adam", lr: 0.05 },
    muon: { label: "Muon", lr: 0.05 },
  };

  // A training run from W = 0, one step at a time. next() returns the
  // current error of every fact, then takes a step.
  function memoryTrainer(task, key, lr) {
    const d = task.d, W = new Float64Array(d * d);
    const m = new Float64Array(d * d), v = new Float64Array(d * d);
    let t = 0;
    return function next() {
      t++;
      const { G, err } = memoryGrad(task, W);
      if (key === "sgd") {
        for (let i = 0; i < W.length; i++) W[i] -= lr * G[i];
      } else if (key === "adam") {
        const c1 = 1 - Math.pow(0.9, t), c2 = 1 - Math.pow(0.999, t);
        for (let i = 0; i < W.length; i++) {
          m[i] = 0.9 * m[i] + 0.1 * G[i]; v[i] = 0.999 * v[i] + 0.001 * G[i] * G[i];
          W[i] -= lr * (m[i] / c1) / (Math.sqrt(v[i] / c2) + 1e-8);
        }
      } else {
        for (let i = 0; i < W.length; i++) m[i] = 0.95 * m[i] + G[i];
        const O = newtonSchulz(m.map((x, i) => G[i] + 0.95 * x), d);
        // Muon's usual shape scaling is 1 for a square matrix.
        for (let i = 0; i < W.length; i++) W[i] -= lr * O[i];
      }
      return Array.from(err);
    };
  }

  // Run `steps` steps; returns errs[0..steps], the errors before each step.
  function trainMemory(task, key, steps, lr) {
    const next = memoryTrainer(task, key, lr), errs = [];
    for (let k = 0; k <= steps; k++) errs.push(next());
    return { errs };
  }

  const api = { makeTerrain, heightAt, slopeAt, ARRIVED_M, OPTIMIZERS, climb, classify, outcomeCode, BUMP, STALLED, LEFT,
                MEMORY, MATRIX_OPTS, makeMemoryTask, memoryTrainer, trainMemory, mulberry32 };
  root.SFCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
