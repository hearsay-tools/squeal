// THROWAWAY probe (011-core/research/catch-up.md). Replays cezar's catch-up after the
// 2026-10-19 pull (main worktree, 7fe10d99) from the recorded per-file times
// (results/cezar-733.json): every fast file the edit route and the restart's `run --all` ran,
// under four rules, per lane, one lane's tiers one after another. Times are sums of check
// durations (low by 1.04 to 1.27, calibrate.mjs). Every rule takes files in one order, the
// recorded one: the edit route's files as it ran them (C4 step 4's classes: failing, edited,
// direct, transitive), then the rest as the restart's backlog ran them. Slow files (the e2e lane) are left out: the
// slow tier runs them one at a time under every rule.
import { readFileSync, writeFileSync } from "node:fs";
import { makespan, FIXED_S } from "./calibrate.mjs";
const runs = JSON.parse(readFileSync(new URL("results/cezar-733.json", import.meta.url)));
const files = new Map();
for (const r of runs) if (r.lane !== "slow") for (const f of r.files) {
  const was = files.get(f.id);
  files.set(f.id, { id: f.id, s: f.s, lane: r.lane, seq: was?.seq ?? files.size });
}
const lanes = { vitest: [...files.values()].filter((f) => f.lane === "vitest"), "node:test": [...files.values()].filter((f) => f.lane === "node:test") };
const inOrder = (a, b) => a.seq - b.seq;

// C4's edit tier: the first file, then a file while the slowest stays within max(1 s, 4 × fastest).
function editTiers(fs, size) {
  const q = [...fs].sort(inOrder), tiers = [];
  while (q.length) {
    const t = [q.shift()];
    // A file out of span stays queued in its place; the tier looks further down (`joinSpan`).
    for (let i = 0; i < q.length && t.length < size; ) {
      const lo = Math.min(...t.map((f) => f.s), q[i].s), hi = Math.max(...t.map((f) => f.s), q[i].s);
      if (hi <= Math.max(1, 4 * lo)) t.push(q.splice(i, 1)[0]); else i++;
    }
    tiers.push(t);
  }
  return tiers;
}
// C4 step 5's backlog tier: one round of W, then while sum/W + (1 − 1/W)·longest ≤ 120 s, ≤ 200 files.
function backlogTiers(fs, w, order = inOrder) {
  const q = [...fs].sort(order), tiers = [];
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
// Slots (011-21 slice 2): W one-file runs at a time, the next file as one ends.
function slots(fs, w, order = inOrder) {
  const free = Array(w).fill(0), done = [];
  for (const f of [...fs].sort(order)) { const i = free.indexOf(Math.min(...free)); free[i] += f.s + FIXED_S; done.push(free[i]); }
  return { end: Math.max(...free), done: done.sort((a, b) => a - b), busy: null };
}
function serial(tiers, w) {
  let t = 0; const done = [], busy = [];
  for (const tier of tiers) { const wall = makespan(tier.map((f) => f.s), Math.min(w, tier.length)) + FIXED_S; busy.push([t, t + wall]); t += wall; for (const _ of tier) done.push(t); }
  return { end: t, done, busy };
}
// An edit landing at a uniform moment of the catch-up: how long its own file waits to start.
// Uncancelled tiers: the rest of the tier in flight. Vitest cancel: at most its 1 s + 5 s grace
// (the 0.36 s R1 measured is the usual case). node:test beside a backlog tier or slot: 0.
const meanWait = (busy) => { const total = busy.reduce((a, [s, e]) => a + (e - s), 0); return busy.reduce((a, [s, e]) => a + (e - s) ** 2 / 2, 0) / total; };
const longestTier = (busy) => Math.max(...busy.map(([s, e]) => e - s));
const at = (done, sec) => done.filter((d) => d <= sec).length;
const rows = [];
for (const [rule, plan] of [
  ["edit route, tierSize 4 (0.1.224)", (fs, lane) => serial(editTiers(fs, 4), 4)],
  ["edit route, tierSize 12 (cezar stopgap)", (fs, lane) => serial(editTiers(fs, 12), 12)],
  // First group: no slots (they are the backlog's), node:test tiers of runner.tierSize, never cancelled.
  ["first group at backlog width (uncancelled)", (fs, lane) => lane === "vitest" ? serial(backlogTiers(fs, 23), 23) : serial(backlogTiers(fs, 4), 4)],
  ["third group, backlog route (cancelled by an edit)", (fs, lane) => lane === "vitest" ? serial(backlogTiers(fs, 23), 23) : slots(fs, 4)],
  // The same, the group shortest first as one class (no edited/direct/transitive split).
  ["third group, one class shortest first", (fs, lane) => lane === "vitest" ? serial(backlogTiers(fs, 23, (a, b) => a.s - b.s), 23) : slots(fs, 4, (a, b) => a.s - b.s)],
]) {
  for (const [lane, fs] of Object.entries(lanes)) {
    const r = plan(fs, lane);
    const third = rule.startsWith("third");
    const wait = third ? (lane === "node:test" ? "0 (beside)" : "≤ 6 (cancel)") : `${meanWait(r.busy).toFixed(0)} mean, ${longestTier(r.busy).toFixed(0)} worst`;
    rows.push({ rule, lane, meanDoneS: Math.round(r.done.reduce((a, d) => a + d, 0) / r.done.length), sumS: Math.round(fs.reduce((a, f) => a + f.s, 0)), files: fs.length, endS: Math.round(r.end), at2min: at(r.done, 120), at5min: at(r.done, 300), at10min: at(r.done, 600), tiers: r.busy?.length ?? fs.length, editWaitS: wait });
  }
}
console.table(rows);
writeFileSync("results/replay-733.json", JSON.stringify(rows, null, 1));
