// THROWAWAY probe (011-core/research/central-edits.md, questions 2 and 4). Replays each of the 62
// revisions (results/direct.json.gz) on its own, from recorded durations, under each cut:
//   today      every re-keyed file is an edit's work: edit tiers of runner.tierSize (4, and cezar's
//              stopgap 12), C4 step 4's classes (edited, direct, the rest), shortest first in each,
//              the tier-sharing span (max(1 s, 4 × fastest));
//   (a)        edited and direct stay edit tiers; the rest is catch-up (011-22's group): Vitest
//              backlog tiers (W 23, 120 s budget, ≤ 200 files, shortest first), node:test slots (W 4);
//   (c) d ≤ 2  edited, direct and depth-2 files stay edit tiers; the rest is catch-up;
//   (a) cap K  edited files and at most K direct importers, shortest first, stay edit tiers; the rest
//              (more direct importers included) is catch-up: what a hub like runs/store.ts would need;
//   (b) N      (a) only when the revision re-keys more than N files: every one of the 62 re-keys
//              200 or more, so (b) equals (a) here for any N below 200 (see cuts.mjs for where N bites).
// Lanes run at once (C4 lanes paragraph); within a lane the first group runs before catch-up. A
// file's time is the median over its recorded runs of the sum of its checks' durations (low by
// 1.04 to 1.27 against measured walls, probes/catch-up/calibrate.mjs); a file with none takes its
// project's median. Files absent at the head (results/direct.json.gz "absent") are left out, and so
// is b20a0d00 r1 (its 223 "outside" files did not import the new module yet: today's closures).
// Measures: time to the revision's own test files' results (the last of them), time to all, and
// the next edit's wait: at a uniform moment of the Vitest lane's work, how long until a new edit's
// tier may start (an edit tier is never cancelled; a catch-up tier is, within 1 s + 5 s grace: 6 s
// counted; node:test runs beside catch-up slots: 0).
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { readResult } from "./graph.mjs";
import { FIXED_S, makespan } from "../catch-up/calibrate.mjs";

const db = new DatabaseSync(process.env.R25_STORE ?? "/tmp/r3/cezar-store.sqlite", { readOnly: true });
const revs = readResult("direct").filter((r) => r.rev !== "b20a0d00 r1");

const perRun = db.prepare(`select c.project, c.test_path path, r.run_id, sum(r.duration_ms) ms from results r
  join checks c on c.id = r.check_id group by c.project, c.test_path, r.run_id`).all();
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const byFile = new Map(), byProject = new Map();
for (const r of perRun) {
  const id = `${r.project}:${r.path}`;
  (byFile.get(id) ?? byFile.set(id, []).get(id)).push(r.ms / 1000);
  (byProject.get(r.project) ?? byProject.set(r.project, []).get(r.project)).push(r.ms / 1000);
}
const projMedian = new Map([...byProject].map(([p, xs]) => [p, median(xs)]));
const secs = (id) => median(byFile.get(id) ?? []) ?? projMedian.get(id.split(":")[0]) ?? 1;

const CLASS = { edited: 1, direct: 2, transitive: 3, outside: 3 };
const order = (a, b) => CLASS[a.cls] - CLASS[b.cls] || a.s - b.s;
const shortest = (a, b) => a.s - b.s;

function editTiers(fs, size) {
  const q = [...fs].sort(order), tiers = [];
  while (q.length) {
    const t = [q.shift()];
    for (let i = 0; i < q.length && t.length < size; ) {
      const lo = Math.min(...t.map((f) => f.s), q[i].s), hi = Math.max(...t.map((f) => f.s), q[i].s);
      if (hi <= Math.max(1, 4 * lo)) t.push(q.splice(i, 1)[0]); else i++;
    }
    tiers.push(t);
  }
  return tiers;
}
function backlogTiers(fs, w) {
  const q = [...fs].sort(shortest), tiers = [];
  while (q.length) {
    const t = [];
    let sum = 0, longest = 0;
    while (q.length && t.length < 200) {
      const s2 = sum + q[0].s, l2 = Math.max(longest, q[0].s);
      if (t.length >= w && s2 / w + (1 - 1 / w) * l2 > 120) break;
      t.push(q.shift()); sum = s2; longest = l2;
    }
    tiers.push(t);
  }
  return tiers;
}
/** Tiers one after another from `t0`: each file's result time, and the busy spans (cancellable or not). */
function serial(tiers, w, t0, cancellable, done, busy) {
  let t = t0;
  for (const tier of tiers) {
    const wall = makespan(tier.map((f) => f.s), Math.min(w ?? tier.length, tier.length)) + FIXED_S;
    busy.push({ s: t, e: t + wall, cancellable });
    t += wall;
    for (const f of tier) done.set(f.id, t);
  }
  return t;
}
function slots(fs, w, t0, done) {
  const free = Array(w).fill(t0);
  for (const f of [...fs].sort(shortest)) { const i = free.indexOf(Math.min(...free)); free[i] += f.s + FIXED_S; done.set(f.id, free[i]); }
  return Math.max(...free);
}
function plan(files, editOf, size) {
  const done = new Map(), busy = [];
  let end = 0;
  for (const lane of ["vitest", "node:test"]) {
    const fs = files.filter((f) => f.lane === lane);
    const edit = fs.filter(editOf), rest = fs.filter((f) => !editOf(f));
    const t = serial(editTiers(edit, size), null, 0, false, done, lane === "vitest" ? busy : []);
    const e = lane === "vitest" ? serial(backlogTiers(rest, 23), 23, t, true, done, busy) : slots(rest, 4, t, done);
    end = Math.max(end, e);
  }
  const total = busy.reduce((a, b) => a + (b.e - b.s), 0);
  const wait = total === 0 ? 0 : busy.reduce((a, b) => {
    const d = b.e - b.s;
    return a + (b.cancellable ? Math.min(d, 6) * d - Math.min(d, 6) ** 2 / 2 : d * d / 2);
  }, 0) / total;
  return { done, end, wait, longest: Math.max(0, ...busy.filter((b) => !b.cancellable).map((b) => b.e - b.s)) };
}

/** Edited files, and the `k` shortest direct importers of the revision's files. */
const capped = (files, k) => {
  const keep = new Set(files.filter((f) => f.cls === "direct").sort((a, b) => a.s - b.s).slice(0, k).map((f) => f.id));
  return (f) => f.cls === "edited" || keep.has(f.id);
};
const RULES = {
  "today, tierSize 4": [() => true, 4],
  "today, tierSize 12": [() => true, 12],
  "(a) edited + direct, tierSize 4": [(f) => f.cls === "edited" || f.cls === "direct", 4],
  "(a) edited + direct, tierSize 12": [(f) => f.cls === "edited" || f.cls === "direct", 12],
  "(a) cap 12 direct, tierSize 12": [(f, fs) => capped(fs, 12)(f), 12],
  "(c) depth ≤ 2, tierSize 4": [(f) => f.depth !== null && f.depth <= 2, 4],
};
const rows = [];
for (const r of revs) {
  const files = r.files.filter((f) => f.cls !== "absent").map((f) => ({ ...f, s: secs(f.id) }));
  const own = r.own.map((o) => o.id);
  for (const [rule, [editOf, size]] of Object.entries(RULES)) {
    const of = (f) => editOf(f, files);
    const p = plan(files, of, size);
    rows.push({ rev: r.rev, rule, files: files.length, edit: files.filter(of).length, ownS: Math.max(...own.map((id) => p.done.get(id) ?? 0)), ownFirstS: Math.min(...own.map((id) => p.done.get(id) ?? Infinity)),
      allS: p.end, meanS: [...p.done.values()].reduce((a, b) => a + b, 0) / p.done.size, waitS: p.wait, longestUncancelledS: p.longest });
  }
}
writeFileSync(new URL("results/replay.json", import.meta.url), JSON.stringify(rows, null, 1));
const q = (xs, f) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
const fmt = (xs) => `${q(xs, 0.5).toFixed(0)} / ${q(xs, 0.9).toFixed(0)} / ${Math.max(...xs).toFixed(0)}`;
const table = Object.keys(RULES).map((rule) => {
  const rs = rows.filter((x) => x.rule === rule);
  return { rule, revisions: rs.length, "edit files p50/p90/max": fmt(rs.map((x) => x.edit)), "first own s p50/p90/max": fmt(rs.map((x) => x.ownFirstS)), "last own s p50/p90/max": fmt(rs.map((x) => x.ownS)),
    "all s p50/p90/max": fmt(rs.map((x) => x.allS)), "mean result s p50": q(rs.map((x) => x.meanS), 0.5).toFixed(0),
    "next edit wait s p50/p90/max": fmt(rs.map((x) => x.waitS)), "longest uncancelled tier s max": Math.max(...rs.map((x) => x.longestUncancelledS)).toFixed(0) };
});
console.table(table);
for (const rev of ["ba5234dc r13", "bccd1abc r3", "bccd1abc r7", "ba5234dc r44", "66a59a96 r20", "ba5234dc r1", "b7555ac0 r99"]) {
  console.log(rev);
  for (const x of rows.filter((y) => y.rev === rev)) console.log(`  ${x.rule.padEnd(34)} files ${x.files} edit ${x.edit}: own ${x.ownFirstS.toFixed(0)} to ${x.ownS.toFixed(0)} s, all ${x.allS.toFixed(0)} s, mean ${x.meanS.toFixed(0)} s, next edit waits ${x.waitS.toFixed(1)} s`);
}
