// Tune each optimizer's learning rate on the associative-memory toy and
// compare errors on common vs rare facts, with keys aligned or rotated.
// Usage: node tools/tune_memory.js [d] [steps] [zipf exponent]
const core = require("../web/src/core.js");
const d = Number(process.argv[2] || 64), steps = Number(process.argv[3] || 100), zipf = Number(process.argv[4] || 1.5);
const grid = [0.002, 0.003, 0.005, 0.007, 0.01, 0.015, 0.02, 0.03, 0.05, 0.07, 0.1, 0.15, 0.2, 0.3, 0.5, 0.7, 1, 1.5, 2, 3, 4, 6, 8];
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const summary = (e) => ({ all: mean(e), common: mean(e.slice(0, d / 4)), rare: mean(e.slice(-d / 2)) });
for (const rotated of [true, false]) {
  const task = core.makeMemoryTask(d, rotated, zipf, 7);
  console.log(`${rotated ? "ROTATED" : "ALIGNED"} keys, d=${d}, ${steps} steps, zipf ${zipf}; most/least common fact ${(task.p[0] * 100).toFixed(1)}% / ${(task.p[d - 1] * 100).toFixed(2)}%`);
  for (const key of ["sgd", "adam", "muon"]) {
    let best = null;
    for (const lr of grid) {
      const r = core.trainMemory(task, key, steps, lr);
      const s = summary(r.errs[steps]);
      if (Number.isFinite(s.all) && (!best || s.all < best.s.all)) best = { lr, s, r };
    }
    const fixed = core.MATRIX_OPTS[key].lr;
    const f = summary(core.trainMemory(task, key, steps, fixed).errs[steps]);
    const at = (k) => summary(best.r.errs[Math.min(k, steps)]).rare.toFixed(2);
    console.log(`  ${key.padEnd(5)} best lr ${String(best.lr).padEnd(5)} err all ${best.s.all.toFixed(3)} common ${best.s.common.toFixed(3)} rare ${best.s.rare.toFixed(3)} | rare at 25/50/100: ${at(25)} ${at(50)} ${at(100)} | page lr ${fixed}: all ${f.all.toFixed(3)} rare ${f.rare.toFixed(3)}`);
  }
}
