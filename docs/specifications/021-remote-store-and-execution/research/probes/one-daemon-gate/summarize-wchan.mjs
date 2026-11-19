// Throwaway (row 021-17). Summarises wchan-watch.mjs output as daemon-model.md
// Q1 did: per project, the share of main-thread samples running (R), in a
// synchronous sleep (hrtimer_nanosleep: SQLite's busy handler, inferred),
// in the idle loop (ep_poll), in a futex wait, and elsewhere; per daemon too.
// With a lock-watch file, each sleep sample is matched with the holders the
// lock watch saw in that second: another process held the project's
// store.sqlite, its code.sqlite, or neither.
// With commonDirs, a sleep sample is (a) a prune wait when another daemon of
// the project was inside a logged prune hold at that instant (whole-second
// samples: in that second), else (b).
// Usage: node summarize-wchan.mjs <wchan.txt> [lockwatch.jsonl [commonDir...]]
import { readFileSync } from "node:fs";
import { longWrites } from "./long-writes.mjs";
const [wfile, lfile, ...dirs] = process.argv.slice(2);
const rows = readFileSync(wfile, "utf8").split("\n").filter(Boolean).map((l) => l.split(" "));
const holds = lfile ? readFileSync(lfile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
// A whole-second sample (window 1) is matched with any hold in that second; a
// millisecond sample (window 2 on) with holds within 20 ms (one lock poll) of it.
const heldBy = (project, file, sec, pid) => {
  const [a, b] = Number.isInteger(sec) ? [sec * 1000, (sec + 1) * 1000] : [sec * 1000 - 20, sec * 1000 + 20];
  return holds.some((h) => h.db === `${project}/.git/squeal/${file}` && h.pid !== pid
    && Date.parse(h.at) < b && Date.parse(h.at) + Math.max(h.ms, 20) > a);
};
const prunes = dirs.flatMap((d) => longWrites(d, 0, Infinity)).filter((w) => w.prune);
const inPrune = (project, sec, pid) => { const [a, b] = Number.isInteger(sec) ? [sec * 1000, (sec + 1) * 1000] : [sec * 1000 - 20, sec * 1000 + 20];
  return prunes.some((w) => w.project === project && w.pid !== pid && w.start < b && w.end > a); };
const cls = (st, w) => st === "R" ? "R" : w === "hrtimer_nanosleep" ? "sleep" : w === "ep_poll" ? "idle" : /futex/.test(w) ? "futex" : "other";
const sum = {}; const per = {}; const otherW = {};
let t0 = Infinity, t1 = 0; const loads = [];
for (const [s, pid, project, wt, st, w, load] of rows) {
  const sec = Number(s); t0 = Math.min(t0, Math.floor(sec)); t1 = Math.max(t1, Math.floor(sec)); loads.push(Number(load));
  const c = cls(st, w);
  const S = (sum[project] ??= { n: 0, R: 0, sleep: 0, idle: 0, futex: 0, other: 0, sleepStore: 0, sleepCode: 0, sleepBoth: 0, sleepNone: 0, sleepPrune: 0, daemons: new Set() });
  S.n++; S[c]++; S.daemons.add(pid);
  const D = (per[`${project} ${wt} ${pid}`] ??= { n: 0, R: 0, sleep: 0, idle: 0, futex: 0, other: 0 }); D.n++; D[c]++;
  if (c === "other") otherW[w] = (otherW[w] ?? 0) + 1;
  if (c === "sleep" && lfile) {
    const st2 = heldBy(project, "store.sqlite", sec, pid), co = heldBy(project, "code.sqlite", sec, pid);
    if (dirs.length && inPrune(project, sec, pid)) S.sleepPrune++;
    if (st2 && co) S.sleepBoth++; else if (st2) S.sleepStore++; else if (co) S.sleepCode++; else S.sleepNone++;
  }
}
const pc = (a, b) => `${b ? ((100 * a) / b).toFixed(1) : "0.0"}%`;
console.log(`window ${new Date(t0 * 1000).toISOString()} to ${new Date(t1 * 1000).toISOString()}, load ${Math.min(...loads)}-${Math.max(...loads)}`);
for (const [p, S] of Object.entries(sum)) {
  console.log(`${p}: ${S.daemons.size} daemons, ${S.n} samples; running ${pc(S.R, S.n)}, busy wait (hrtimer_nanosleep) ${pc(S.sleep, S.n)}, idle ep_poll ${pc(S.idle, S.n)}, futex ${pc(S.futex, S.n)}, other ${pc(S.other, S.n)}`);
  if (dirs.length) console.log(`  split: (a) busy wait while another daemon was in a logged prune hold ${pc(S.sleepPrune, S.n)} of samples, (b) the rest ${pc(S.sleep - S.sleepPrune, S.n)}`);
  if (lfile) console.log(`  busy-wait samples while another process held: only store.sqlite ${S.sleepStore} (${pc(S.sleepStore, S.n)} of samples), only code.sqlite ${S.sleepCode} (${pc(S.sleepCode, S.n)}), both ${S.sleepBoth} (${pc(S.sleepBoth, S.n)}), neither ${S.sleepNone} (of ${S.sleep})`);
}
console.log("per daemon (project worktree pid: samples, R, sleep, idle):");
for (const [k, D] of Object.entries(per).sort()) console.log(`  ${k}: ${D.n}, ${pc(D.R, D.n)}, ${pc(D.sleep, D.n)}, ${pc(D.idle, D.n)}`);
console.log("other wchan:", JSON.stringify(otherW));
