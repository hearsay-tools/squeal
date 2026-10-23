// 011-148 probe (throwaway): tables over fate.mjs's lines.
// Usage: node sum.mjs <fate.jsonl> [filter: all|live|removed|cls=<class prefix>]
import { readFileSync } from "node:fs";
const [, , path, filter = "all"] = process.argv;
let rows = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
if (filter === "live") rows = rows.filter((r) => r.live);
if (filter === "removed") rows = rows.filter((r) => !r.live);
if (filter.startsWith("cls=")) rows = rows.filter((r) => r.cls.startsWith(filter.slice(4)));
const total = rows.reduce((a, r) => a + r.secs, 0);
const pct = (s) => (100 * s / total).toFixed(1) + "%";
const group = (r) => {
  if (r.stored) return "stored";
  const f = r.fate;
  if (f.startsWith("not-ended:timed-out")) return "timed out (not ended)";
  if (f.startsWith("not-ended:cancel:edit-during-backlog")) return "cancel: edit during a backlog tier";
  if (f.startsWith("not-ended:cancel:supersession")) return "cancel: supersession";
  if (f.startsWith("not-ended:cancel:yield")) return "cancel: yield";
  if (f.startsWith("not-ended:cancel:step-down") || f.startsWith("not-ended:cancel:stop")) return "cancel: stop or step-down";
  if (f.startsWith("not-ended:crashed") || f.startsWith("not-ended:no-report:crashed")) return "crashed";
  if (f.startsWith("not-ended:no-report")) return "no report (node:test or pytest), no result";
  if (f.startsWith("not-ended:failure")) return "not ended, run withheld (bytes no key names)";
  if (f.startsWith("not-ended")) return "not ended, other: " + f;
  if (f === "ended:worktree-removed") return "ended, worktree removed since (results pruned)";
  if (f === "ended:inputs-changed" || f === "ended:superseded") return "ended, inputs changed during the run";
  if (f.startsWith("ended:withheld")) return "ended, withheld";
  if (f === "ended:replaced-same-key") return "ended, a later run stored the same key (replaced)";
  return "ended, no rule seen";
};
const t = {};
for (const r of rows) {
  const g = group(r);
  const o = (t[g] ??= { s: 0, n: 0, sNotStarted: 0, keyNowHas: 0, keyNowNone: 0, keyNowUndet: 0, laterSame: 0, laterSameW: 0 });
  o.s += r.secs; o.n++;
  if (!r.stored) {
    if (r.atKeyNow && r.atKeyNow !== "none") o.keyNowHas += r.secs; else if (r.atKeyNow === "none") o.keyNowNone += r.secs; else o.keyNowUndet += r.secs;
    if (r.later && r.later.by !== "unknown-key") { o.laterSame += r.secs; if (r.later.by === "same-worktree") o.laterSameW += r.secs; }
  }
}
console.log(`${path} [${filter}] file runs ${rows.length}, recorded s ${Math.round(total)}`);
console.log("group | recorded s | share | files | result at the key now: yes / no / undetermined (s) | later run at an inferred same key (s)");
for (const [g, o] of Object.entries(t).sort((a, b) => b[1].s - a[1].s))
  console.log(`${g} | ${Math.round(o.s)} | ${pct(o.s)} | ${o.n} | ${Math.round(o.keyNowHas)} / ${Math.round(o.keyNowNone)} / ${Math.round(o.keyNowUndet)} | ${Math.round(o.laterSame)}`);
const ns = rows.filter((r) => !r.stored).reduce((a, r) => a + r.secs, 0);
console.log(`stored nothing: ${Math.round(ns)} s, ${pct(ns)}`);
// by class
const c = {};
for (const r of rows) { const o = (c[r.cls] ??= { s: 0, ns: 0, rem: 0 }); o.s += r.secs; if (!r.stored) { o.ns += r.secs; if (r.fate === "ended:worktree-removed") o.rem += r.secs; } }
console.log("class | recorded s | share | stored nothing | of which ended in a removed worktree");
for (const [k, o] of Object.entries(c).sort((a, b) => b[1].s - a[1].s))
  console.log(`${k} | ${Math.round(o.s)} | ${pct(o.s)} | ${(100 * o.ns / o.s).toFixed(0)}% | ${(100 * o.rem / o.s).toFixed(0)}%`);
