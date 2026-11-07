// Throwaway probe for research/edit-relevance.md (2026-11-07): summarises order.mjs output.
// Usage: node summary.mjs <order-out.json>
import { readFileSync } from "node:fs";
const o = JSON.parse(readFileSync(process.argv[2], "utf8"));
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1); };
const r1 = (x) => +x.toFixed(1);
const ORD = ["T", "A", "B", "C", "P"];
const res = { revisions: o.revisions.length, failures: o.failures.length };
// failures: one per (revision, file)
res.failureClasses = {}; for (const f of o.failures) res.failureClasses[f.cls] = (res.failureClasses[f.cls] ?? 0) + 1;
res.failureKinds = {}; for (const f of o.failures) { const k = f.depth === 1 ? "direct" : f.plain > 0 ? "plain" : f.depth > 0 ? "otherValue" : "noValuePath"; res.failureKinds[k] = (res.failureKinds[k] ?? 0) + 1; }
res.failureRevisions = new Set(o.failures.map((f) => f.w + ":" + f.n)).size;
res.byOrder = {};
for (const k of ORD) {
  const a = o.failures.map((f) => f[k].ahead), d = o.failures.map((f) => f[k].ahead - f.T.ahead);
  res.byOrder[k] = { inEditWork: o.failures.filter((f) => f[k].edit).length, aheadP50: q(a, 0.5), aheadP90: q(a, 0.9), aheadMax: q(a, 1),
    sooner: d.filter((x) => x < -0.05).length, later: d.filter((x) => x > 0.05).length, same: d.filter((x) => Math.abs(x) <= 0.05).length,
    deltaP10: q(d, 0.1), deltaP50: q(d, 0.5), deltaP90: q(d, 0.9),
    movedOutOfEditWork: o.failures.filter((f) => f.T.edit && !f[k].edit).length, movedIntoEditWork: o.failures.filter((f) => !f.T.edit && f[k].edit).length };
}
// per revision with a failure: the first failure's work ahead under each order
const firsts = new Map();
for (const f of o.failures) { const key = f.w + ":" + f.n; const cur = firsts.get(key) ?? {}; for (const k of ORD) cur[k] = Math.min(cur[k] ?? Infinity, f[k].ahead); cur.edit = cur.edit ?? {}; for (const k of ORD) cur.edit[k] = (cur.edit[k] ?? false) || f[k].edit; firsts.set(key, cur); }
res.firstFailure = {};
for (const k of ORD) { const d = [...firsts.values()].map((x) => x[k] - x.T); res.firstFailure[k] = { aheadP50: q([...firsts.values()].map((x) => x[k]), 0.5), aheadP90: q([...firsts.values()].map((x) => x[k]), 0.9),
  sooner: d.filter((x) => x < -0.05).length, later: d.filter((x) => x > 0.05).length, deltaP50: q(d, 0.5), deltaMin: q(d, 0), deltaMax: q(d, 1), firstInEditWork: [...firsts.values()].filter((x) => x.edit[k]).length }; }
// failures in files that only load the edited file, or do not load it
for (const cls of ["loadedOnly", "notLoaded", "noRecord"]) {
  const fs = o.failures.filter((f) => f.cls === cls);
  res["fail_" + cls] = { n: fs.length, inTEdit: fs.filter((f) => f.T.edit).length, inAEdit: fs.filter((f) => f.A.edit).length,
    laterUnderA: fs.map((f) => r1(f.A.ahead - f.T.ahead)).sort((a, b) => a - b), laterUnderC: fs.map((f) => r1(f.C.ahead - f.T.ahead)).sort((a, b) => a - b) };
}
// edit work sizes
res.editWork = {};
for (const k of ORD) { const f = o.revisions.map((r) => r.edit[k].files), s = o.revisions.map((r) => r.edit[k].sec);
  res.editWork[k] = { filesP50: q(f, 0.5), filesP90: q(f, 0.9), filesMax: q(f, 1), secP50: q(s, 0.5), secP90: q(s, 0.9), secTotal: Math.round(s.reduce((a, b) => a + b, 0)) }; }
const tot = (fn) => o.revisions.reduce((a, r) => a + fn(r), 0);
res.rekeyedSec = Math.round(tot((r) => r.sec));
res.tEditSec = Math.round(tot((r) => r.edit.T.sec));
res.tEditNotCalledSec = Math.round(tot((r) => r.tKeptNotCalled));
res.tEditNotCalledShare = +(100 * res.tEditNotCalledSec / res.tEditSec).toFixed(1);
res.revisionsWithTEditNotCalled = o.revisions.filter((r) => r.tKeptNotCalledFiles > 0).length;
res.clsShareOfRekeyedSec = {}; for (const r of o.revisions) for (const [c, s] of Object.entries(r.clsSec)) res.clsShareOfRekeyedSec[c] = (res.clsShareOfRekeyedSec[c] ?? 0) + s;
for (const c in res.clsShareOfRekeyedSec) res.clsShareOfRekeyedSec[c] = +(100 * res.clsShareOfRekeyedSec[c] / res.rekeyedSec).toFixed(1);
// proxy quality against coverage (pairs with a record): precision and recall in seconds and files
const P = o.pairs.filter((p) => !["noRecord", "own"].includes(p[0]));
const truth = (p) => p[0] === "called" || p[0] === "loadedUnknown";
const signals = { direct: (p) => p[1] === 1, depthLe2: (p) => p[1] >= 1 && p[1] <= 2, plainPath: (p) => p[2] >= 1, plainLe2: (p) => p[2] >= 1 && p[2] <= 2, anyValue: (p) => p[1] >= 1, namesake: (p) => p[3] === 1, directOrNamesake: (p) => p[1] === 1 || p[3] === 1 };
const allTrueSec = P.filter(truth).reduce((a, p) => a + p[5], 0), allSec = P.reduce((a, p) => a + p[5], 0);
res.proxy = { pairs: P.length, calledShareSec: +(100 * allTrueSec / allSec).toFixed(1), calledShareFiles: +(100 * P.filter(truth).length / P.length).toFixed(1) };
for (const [name, fn] of Object.entries(signals)) {
  const pos = P.filter(fn), tp = pos.filter(truth);
  const sec = (a) => a.reduce((s, p) => s + p[5], 0);
  res.proxy[name] = { precisionSec: +(100 * sec(tp) / (sec(pos) || 1)).toFixed(1), recallSec: +(100 * sec(tp) / allTrueSec).toFixed(1), shareOfSec: +(100 * sec(pos) / allSec).toFixed(1),
    precisionFiles: +(100 * tp.length / (pos.length || 1)).toFixed(1), recallFiles: +(100 * tp.length / P.filter(truth).length).toFixed(1) };
}
console.log(JSON.stringify(res, null, 1));
