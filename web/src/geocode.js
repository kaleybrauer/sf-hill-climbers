// Offline geocoder for San Francisco: addresses ("3500 20th St"),
// intersections ("Valencia & 24th"), places ("Dolores Park", "16th St BART")
// and coordinates. Built from OpenStreetMap data embedded in the page, so
// nothing the viewer types leaves the browser.
(function (root) {
  "use strict";

  const SUFFIX = {
    street: "st", st: "st", str: "st", avenue: "ave", ave: "ave", av: "ave", boulevard: "blvd", blvd: "blvd",
    drive: "dr", dr: "dr", road: "rd", rd: "rd", way: "way", place: "pl", pl: "pl", terrace: "ter", ter: "ter",
    court: "ct", ct: "ct", lane: "ln", ln: "ln", alley: "aly", aly: "aly", highway: "hwy", hwy: "hwy",
    plaza: "plz", plz: "plz", circle: "cir", cir: "cir", parkway: "pkwy", pkwy: "pkwy", square: "sq", sq: "sq",
    walk: "walk", row: "row", expressway: "expy", path: "path", steps: "steps", loop: "loop",
  };
  const KIND_ORDER = { preset: 0, hill: 1, station: 2, park: 3, landmark: 4, campus: 5, neighborhood: 6 };

  const words = (s) => s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  function ordinal(n) {
    const v = n % 100;
    return n + (v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
  }
  // "St. Francis Blvd" -> { base: "saint francis", type: "blvd" }; "20" -> "20th".
  function streetKey(s) {
    const t = words(s);
    if (t.length > 1 && t[0] === "st") t[0] = "saint";
    if (t.length > 1 && t[0] === "mt") t[0] = "mount";
    let type = null;
    if (t.length > 1 && SUFFIX[t[t.length - 1]]) type = SUFFIX[t.pop()];
    if (t.length === 1 && /^\d+$/.test(t[0])) t[0] = ordinal(Number(t[0]));
    return { base: t.join(" "), type };
  }
  const placeKey = (s) => words(s).map((w) => SUFFIX[w] || w).join(" ");

  function levenshtein(a, b) {
    if (Math.abs(a.length - b.length) > 3) return 99;
    const row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0]; row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const cur = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
      }
    }
    return row[b.length];
  }

  // meta: the page's terrain.json; extra: [{name, x, y, kind}] in metres.
  function makeGeocoder(meta, extra) {
    const cell = meta.cell_m;
    const toM = (v10) => (v10 / 10 + 0.5) * cell;
    const names = meta.street_names;

    // Street polylines by name index, in metres.
    const lines = new Map();
    for (const s of meta.streets) {
      if (s[1] < 0) continue;
      let x = s[2], y = s[3];
      const pts = [toM(x), toM(y)];
      for (let i = 4; i < s.length; i += 2) { x += s[i]; y += s[i + 1]; pts.push(toM(x), toM(y)); }
      if (!lines.has(s[1])) lines.set(s[1], []);
      lines.get(s[1]).push(pts);
    }
    // Street names grouped by base ("valencia" -> Valencia Street).
    const byBase = new Map();
    names.forEach((n, i) => {
      const k = streetKey(n);
      if (!byBase.has(k.base)) byBase.set(k.base, []);
      byBase.get(k.base).push({ i, type: k.type, name: n });
    });
    // Address anchors, decoded lazily per street.
    const anchorCache = new Map();
    function anchors(i) {
      if (anchorCache.has(i)) return anchorCache.get(i);
      const f = meta.addresses[String(i)];
      let out = null;
      if (f) {
        out = [];
        let n = f[0], x = f[1], y = f[2];
        out.push([n, toM(x), toM(y)]);
        for (let k = 3; k < f.length; k += 3) { n += f[k]; x += f[k + 1]; y += f[k + 2]; out.push([n, toM(x), toM(y)]); }
      }
      anchorCache.set(i, out);
      return out;
    }
    // Places: OSM places plus hills, map labels and presets from the page.
    const places = [
      ...meta.pois.map(([name, kind, x, y]) => ({ name, kind, x: toM(x), y: toM(y) })),
      ...meta.hills.filter((h) => h.named && !h.edge).map((h) => ({ name: h.name, kind: "hill", x: (h.c + 0.5) * cell, y: (h.r + 0.5) * cell })),
      ...meta.places.map((p) => ({ name: p.name, kind: "neighborhood", x: (p.c + 0.5) * cell, y: (p.r + 0.5) * cell })),
      ...(extra || []),
    ].map((p) => ({ ...p, key: placeKey(p.name) }));

    function candidates(text) {
      const k = streetKey(text);
      let list = byBase.get(k.base) || [];
      if (k.type) { const typed = list.filter((c) => c.type === k.type); if (typed.length) list = typed; }
      // Prefer names that have geometry; longer streets first.
      return list.filter((c) => lines.has(c.i) || anchors(c.i))
        .sort((a, b) => (lines.get(b.i)?.reduce((s, l) => s + l.length, 0) || 0) - (lines.get(a.i)?.reduce((s, l) => s + l.length, 0) || 0));
    }

    function suggest(text) {
      const k = streetKey(text), out = [];
      for (const [base, list] of byBase) {
        if (!list.some((c) => lines.has(c.i))) continue;
        const d = levenshtein(k.base, base);
        if (d <= 2 && d < k.base.length / 2) out.push([d, list[0].name]);
      }
      const q = placeKey(text);
      for (const p of places) {
        const d = levenshtein(q, p.key);
        if (d <= 2 && d < q.length / 2) out.push([d, p.name]);
      }
      return out.sort((a, b) => a[0] - b[0]).slice(0, 3).map((o) => o[1]);
    }

    // Closest approach of two polylines (metres); returns {x, y, d}.
    function meet(la, lb) {
      let best = { d: Infinity };
      for (const a of la) for (const b of lb) {
        for (let i = 0; i + 3 < a.length; i += 2) {
          const ax = a[i], ay = a[i + 1], bx = a[i + 2], by = a[i + 3];
          for (let j = 0; j + 3 < b.length; j += 2) {
            const cx = b[j], cy = b[j + 1], dx = b[j + 2], dy = b[j + 3];
            const r = segMeet(ax, ay, bx, by, cx, cy, dx, dy);
            if (r.d < best.d) best = r;
          }
        }
      }
      return best;
    }
    function segMeet(ax, ay, bx, by, cx, cy, dx, dy) {
      const ux = bx - ax, uy = by - ay, vx = dx - cx, vy = dy - cy;
      const den = ux * vy - uy * vx;
      if (Math.abs(den) > 1e-9) {
        const t = ((cx - ax) * vy - (cy - ay) * vx) / den, s = ((cx - ax) * uy - (cy - ay) * ux) / den;
        if (t >= 0 && t <= 1 && s >= 0 && s <= 1) return { x: ax + t * ux, y: ay + t * uy, d: 0 };
      }
      let best = { d: Infinity };
      const tryPt = (px, py, qx, qy, wx, wy) => {
        const L = wx * wx + wy * wy;
        const t = L ? Math.max(0, Math.min(1, ((px - qx) * wx + (py - qy) * wy) / L)) : 0;
        const ex = qx + t * wx, ey = qy + t * wy, d = Math.hypot(px - ex, py - ey);
        if (d < best.d) best = { x: (px + ex) / 2, y: (py + ey) / 2, d };
      };
      tryPt(ax, ay, cx, cy, vx, vy); tryPt(bx, by, cx, cy, vx, vy);
      tryPt(cx, cy, ax, ay, ux, uy); tryPt(dx, dy, ax, ay, ux, uy);
      return best;
    }

    function midpoint(i) {
      const ls = lines.get(i);
      if (!ls) return null;
      const longest = ls.reduce((a, b) => (b.length > a.length ? b : a));
      let total = 0;
      for (let k = 2; k < longest.length; k += 2) total += Math.hypot(longest[k] - longest[k - 2], longest[k + 1] - longest[k - 1]);
      let run = 0;
      for (let k = 2; k < longest.length; k += 2) {
        const seg = Math.hypot(longest[k] - longest[k - 2], longest[k + 1] - longest[k - 1]);
        if (run + seg >= total / 2) {
          const t = seg ? (total / 2 - run) / seg : 0;
          return { x: longest[k - 2] + t * (longest[k] - longest[k - 2]), y: longest[k - 1] + t * (longest[k + 1] - longest[k - 1]) };
        }
        run += seg;
      }
      return { x: longest[0], y: longest[1] };
    }

    function intersection(a, b) {
      const ca = candidates(a), cb = candidates(b);
      if (!ca.length || !cb.length) {
        const bad = !ca.length ? a : b;
        return { error: `Couldn't find a street called "${bad.trim()}".`, suggestions: suggest(bad), bad };
      }
      let best = null;
      for (const x of ca) for (const y of cb) {
        if (!lines.has(x.i) || !lines.has(y.i) || x.i === y.i) continue;
        const r = meet(lines.get(x.i), lines.get(y.i));
        if (!best || r.d < best.d) best = { ...r, a: x.name, b: y.name };
      }
      if (!best || best.d > 60) return { error: `${ca[0].name} and ${cb[0].name} don't seem to cross.`, suggestions: [] };
      return { x: best.x, y: best.y, label: `${best.a} & ${best.b}`, kind: "intersection", approx: false };
    }

    function address(num, street) {
      const cs = candidates(street);
      if (!cs.length) return { error: `Couldn't find a street called "${street.trim()}".`, suggestions: suggest(street), bad: street };
      let range = null;
      for (const c of cs) {
        const an = anchors(c.i);
        if (!an) continue;
        const same = an.filter((a) => a[0] % 2 === num % 2);
        const use = same.length ? same : an;
        let lo = null, hi = null;
        for (const a of use) {
          if (a[0] <= num && (!lo || a[0] > lo[0])) lo = a;
          if (a[0] >= num && (!hi || a[0] < hi[0])) hi = a;
        }
        const label = `${num} ${c.name}`;
        if (lo && hi && hi[0] - lo[0] <= 200) {
          const t = hi[0] === lo[0] ? 0 : (num - lo[0]) / (hi[0] - lo[0]);
          return { x: lo[1] + t * (hi[1] - lo[1]), y: lo[2] + t * (hi[2] - lo[2]), label, kind: "address", approx: lo[0] !== num };
        }
        const near = [lo, hi].filter(Boolean).sort((p, q) => Math.abs(p[0] - num) - Math.abs(q[0] - num))[0];
        if (near && Math.abs(near[0] - num) <= 100) return { x: near[1], y: near[2], label, kind: "address", approx: true };
        if (!range) range = [an[0][0], an[an.length - 1][0], c.name];
      }
      if (range) return { error: `No number ${num} on ${range[2]}. Its addresses run from ${range[0]} to ${range[1]}.`, suggestions: [] };
      // A street without address data: fall back to its middle.
      const m = midpoint(cs[0].i);
      return m ? { ...m, label: `${cs[0].name} (no address data, using its middle)`, kind: "street", approx: true } : { error: `No addresses on ${cs[0].name}.`, suggestions: [] };
    }

    function place(q) {
      const station = /\b(bart|station|muni|caltrain)\b/.test(q);
      const key = placeKey(q.replace(/\b(bart|station|muni|caltrain)\b/gi, " "));
      if (!key) return null;
      let best = null;
      for (const p of places) {
        if (station && p.kind !== "station" && p.kind !== "preset") continue;
        let score = p.key === key ? 100 : p.key.startsWith(key + " ") ? 80 : (" " + p.key + " ").includes(" " + key + " ") ? 60 : p.key.includes(key) ? 30 : 0;
        if (!score) continue;
        score -= KIND_ORDER[p.kind] * 0.5 + p.key.length * 0.01;
        if (!best || score > best.score) best = { ...p, score };
      }
      return best && best.score >= (station ? 20 : 25) ? { x: best.x, y: best.y, label: best.name, kind: "place", approx: false } : null;
    }

    function search(input) {
      let q = String(input || "").trim();
      if (!q) return { error: "Type an address, an intersection or a place.", suggestions: [] };
      const ll = q.match(/^\s*(-?\d{1,3}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)\s*$/);
      if (ll) return { lat: Number(ll[1]), lon: Number(ll[2]), label: `${ll[1]}, ${ll[2]}`, kind: "coords", approx: false };
      q = q.replace(/,?\s*(san francisco|sf)\b.*$/i, "").replace(/,?\s*\b(ca|california)\b\s*\d*\s*$/i, "").replace(/\s+\d{5}(-\d{4})?\s*$/, "").replace(/\s*,\s*$/, "");
      // Intersection: "A & B", "A and B", "A at B", "A / B".
      const parts = q.split(/\s*(?:&|@|\/|\band\b|\bat\b)\s*/i).filter(Boolean);
      if (parts.length === 2) {
        const r = intersection(parts[0], parts[1]);
        if (!r.error) return r;
        const p = place(q);
        return p || r;
      }
      // Address: "3500 20th St", "123A Valencia".
      const ad = q.match(/^(\d+)[a-z]?(?:\s*-\s*\d+[a-z]?)?\s+(.+)$/i);
      if (ad && !/^(st|nd|rd|th)\b/i.test(ad[2])) return address(Number(ad[1]), ad[2]);
      // A street with an explicit type ("Valencia St") is a street, not a place.
      const k = streetKey(q);
      if (k.type) {
        const cs = candidates(q);
        if (cs.length) { const m = midpoint(cs[0].i); if (m) return { ...m, label: `${cs[0].name} (its middle)`, kind: "street", approx: true }; }
      }
      const p = place(q);
      if (p) return p;
      const cs = candidates(q);
      if (cs.length) { const m = midpoint(cs[0].i); if (m) return { ...m, label: `${cs[0].name} (its middle)`, kind: "street", approx: true }; }
      return { error: `Couldn't find "${q}".`, suggestions: suggest(q), bad: q };
    }

    return { search };
  }

  const api = { makeGeocoder, streetKey };
  root.SFGeocode = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
