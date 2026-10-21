// THROWAWAY probe (011-core/research/yields-replay.md, row 011-68). Questions 1, 2 and 4: replays
// cezar's recorded fast Vitest tiers, read only, under three rules:
//   236: no yield (recorded: edit tiers run to their end, backlog tiers cancelled as recorded);
//   237: 0.1.237 as shipped (`src/core/scheduler/yields.ts`): cancel when the revisions during the
//        run re-keyed every file of the tier; else yield to an edit's work, a promoted file or a
//        recreate when the largest last-known duration among all its files, less its elapsed
//        time, exceeds Y; one cut per file and key; a backlog tier still cancelled as recorded;
//   54:  011-54's: as 237, but the supersession takes only the files whose module has not ended;
//   54u: as 54, the remainder over the unfinished files too.
// Each with the duration source `est` (the store's sum of results, `durationOf`) or `wall`.
// Window: tiers started before 0.1.237's release (UNTIL), so the recorded timeline is 0.1.236's.
import { writeFileSync } from "node:fs";
import { runs, runsOf, revsOf, reach, keyedCount, RECREATE, inFlight, overhead, lastKnown, hist, stats, q, waits, loadAt, FIXED_S } from "./load-data.mjs";

const UNTIL = Date.parse(process.env.UNTIL ?? "2026-10-21T12:53:22Z");
const CANCEL_S = 3.1; // revision to run end after a scheduler cancel, p50 (running-tier-yields.md 1)
const W = 23; // a tier of at most W files starts every file at once (cezar's maxWorkers)
const span = { from: Math.min(...runs.map((r) => r.s)), to: UNTIL };
const inWindow = (r) => r.s < UNTIL && r.e <= UNTIL + 3600_000;
const ended = (r, f, el) => r.files.length <= W && (r.dur.get(f) ?? Infinity) <= el;

// ---- Events: revisions and named-wait episodes during a fast tier of the same worktree ----
const events = [];
for (const [wt, revs] of revsOf) for (const v of revs) {
  const r = inFlight(wt, v.t);
  if (!r || !inWindow(r)) continue;
  const reached = reach(v.changes);
  const recreate = v.changes.some((c) => RECREATE.test(c.path));
  if (!reached.size && !recreate) continue;
  const keyed = keyedCount(v.changes);
  events.push({ kind: "rev", t: v.t, r, wt, reached, recreate, edit: keyed < 10 && reached.size > 0, catchUp: keyed >= 10, residualS: (r.e - v.t) / 1000 });
}
const episodes = new Map();
for (const w of waits) {
  if (w.at < span.from || w.at > span.to) continue;
  const r = inFlight(w.wt, w.at);
  if (!r || !inWindow(r)) continue;
  const blocked = [];
  for (const path of w.paths) {
    if (r.files.some((f) => f.endsWith("\0" + path))) continue;
    const mine = (runsOf.get(w.wt) ?? []).filter((x) => x.s >= w.at && x.files.some((f) => f.endsWith("\0" + path)));
    const next = mine[0];
    if (!next || next.s < r.e - 1000 || next.s - w.at > 1800_000) continue;
    const rekeyed = (revsOf.get(w.wt) ?? []).some((v) => v.t > w.at && v.t < next.s && [...reach(v.changes)].some((f) => f.endsWith("\0" + path)));
    if (rekeyed) continue;
    const done = mine.find((x) => [...x.completed].some((f) => f.endsWith("\0" + path))) ?? next;
    const f = done.files.find((x) => x.endsWith("\0" + path));
    blocked.push({ path, next, done, own: done.dur.get(f) ?? 0, ovh: overhead(done) });
  }
  if (!blocked.length) continue;
  const key = `${w.wt}\0${r.id}`;
  const ep = episodes.get(key) ?? { kind: "named", t: w.at, r, wt: w.wt, waits: 0, files: new Map() };
  ep.waits++;
  for (const b of blocked) if (!ep.files.has(b.path)) ep.files.set(b.path, b);
  episodes.set(key, ep);
}
for (const ep of episodes.values()) {
  const files = [...ep.files.values()];
  ep.first = files.reduce((a, b) => (a.done.e <= b.done.e ? a : b));
  ep.recordedS = (ep.first.done.e - ep.t) / 1000; // the first named verdict, as recorded
  ep.ownS = Math.min(...files.map((b) => b.own + b.ovh));
  ep.behindS = (ep.r.e - ep.t) / 1000;
  events.push(ep);
}
events.sort((a, b) => a.t - b.t);

// A yield's mark on (worktree, file) ends when the file's key moves (a later revision reaches it) or
// a later recorded run of it, other than the cut one, ends with its module (its result landed).
function markLive(wt, f, cut, t) {
  if ((revsOf.get(wt) ?? []).some((v) => v.t > cut.t && v.t <= t && reach(v.changes).has(f))) return false;
  if ((runsOf.get(wt) ?? []).some((x) => x !== cut.r && x.s > cut.t && x.e <= t && x.completed.has(f))) return false;
  return true;
}

function simulate(rule, Y, source) {
  const cancelledAt = new Map(); // run -> { t, how }
  const marks = new Map(); // `${wt}\0${f}` -> { t, r }
  const changed = new Map(); // run -> Set(file) re-keyed during its run
  const out = { cancels: [], free: 0, yields: 0, refusedFair: 0, refusedRemainder: 0, cutFree: 0, cutYield: 0, lostYield: 0, freedLane: 0, decisions: [], editWait: [], editWaitRec: [], named: [], namedNext: [], namedRec: [], namedBehind: [] };
  for (const ev of events) {
    const r = ev.r;
    if (ev.kind === "rev") {
      if (!changed.has(r)) changed.set(r, new Set());
      for (const f of r.files) if (ev.reached.has(f)) changed.get(r).add(f);
    }
    const el = (ev.t - r.s) / 1000;
    let gone = cancelledAt.get(r);
    if (!gone && rule !== "236") {
      const unfinished = r.files.filter((f) => !ended(r, f, el));
      const ch = changed.get(r) ?? new Set();
      const superseded = ev.kind === "rev" && (rule === "237" ? r.files.every((f) => ch.has(f)) : unfinished.length > 0 && unfinished.every((f) => ch.has(f)));
      const waited = ev.kind === "named" || ev.edit || ev.recreate;
      if (superseded && !r.cancelled) {
        gone = { t: ev.t, how: "free" };
        out.cancels.push({ how: "free", backlog: r.backlog, by: ev.kind, cut: unfinished.length, lost: 0, freed: Math.max(0, (r.e - ev.t) / 1000 - CANCEL_S) });
        out.free++; out.cutFree += unfinished.length; out.freedLane += Math.max(0, (r.e - ev.t) / 1000 - CANCEL_S);
      } else if (waited && !r.cancelled && !(r.backlog && ev.kind === "rev" && ev.edit)) {
        const fair = !r.files.some((f) => { const m = marks.get(`${r.wt}\0${f}`); return m && m.r !== r && markLive(r.wt, f, m, ev.t); });
        const over = rule === "54u" ? unfinished : r.files;
        const rem = (src) => Math.max(0, ...over.map((f) => (lastKnown(f, r.s, src) ?? 0) - el));
        const remS = rem(source);
        out.decisions.push({ est: rem("est"), wall: rem("wall"), fair });
        if (!fair) { if (remS > Y) out.refusedFair++; }
        else if (remS > Y) {
          gone = { t: ev.t, how: "yield" };
          out.cancels.push({ how: "yield", backlog: r.backlog, by: ev.kind === "named" ? "named" : ev.edit ? "edit" : "recreate", cut: unfinished.length, lost: r.files.length <= W ? unfinished.length * el : 0, laneLost: unfinished.length ? el : 0, freed: Math.max(0, (r.e - ev.t) / 1000 - CANCEL_S) });
          out.yields++; out.cutYield += unfinished.length;
          out.lostYield += r.files.length <= W ? unfinished.length * el : 0;
          out.freedLane += Math.max(0, (r.e - ev.t) / 1000 - CANCEL_S);
          for (const f of unfinished) marks.set(`${r.wt}\0${f}`, { t: ev.t, r });
        } else out.refusedRemainder++;
      }
      if (gone) cancelledAt.set(r, gone);
    }
    const tierEndS = gone ? Math.min(ev.residualS ?? ev.behindS, Math.max(0, (gone.t - ev.t) / 1000 + CANCEL_S)) : null;
    if (ev.kind === "rev" && ev.edit) {
      out.editWaitRec.push(ev.residualS);
      out.editWait.push(tierEndS ?? ev.residualS);
    }
    if (ev.kind === "named") {
      out.namedRec.push(ev.recordedS);
      // Two verdict models: `shift`, the recorded verdict less the blocking-tier time saved (what
      // ran after the tier still runs); `next`, the named file runs right after the cancel.
      const shift = tierEndS === null ? ev.recordedS : ev.recordedS - Math.max(0, ev.behindS - tierEndS);
      const next = tierEndS === null ? ev.recordedS : Math.min(ev.recordedS, tierEndS + ev.ownS);
      out.named.push(shift);
      out.namedNext.push(next);
      out.namedBehind.push(tierEndS ?? ev.behindS);
      ev[`v_${rule}_${Y}_${source}`] = shift;
      ev[`n_${rule}_${Y}_${source}`] = next;
    }
  }
  return out;
}

const lines = [];
const log = (s) => { lines.push(s); console.log(s); };
const inW = runs.filter(inWindow);
log(`window ${new Date(span.from).toISOString()} .. ${new Date(UNTIL).toISOString()} (0.1.237 released); fast Vitest tiers ${inW.length}, backlog-sized ${inW.filter((r) => r.backlog).length}; tiers with an event ${new Set(events.map((e) => e.r)).size}`);
const revs = events.filter((e) => e.kind === "rev"), eps = events.filter((e) => e.kind === "named");
log(`revisions reaching a fast file or recreating during a tier: ${revs.length} (edit's work ${revs.filter((e) => e.edit).length}, catch-up ${revs.filter((e) => e.catchUp).length}, recreate ${revs.filter((e) => e.recreate).length}); named-wait episodes behind a tier: ${eps.length} (waits ${eps.reduce((a, e) => a + e.waits, 0)})`);
log(`load at the events: p50 ${q(events.map((e) => loadAt(e.t)), 0.5)}, p90 ${q(events.map((e) => loadAt(e.t)), 0.9)}, below 8: ${events.filter((e) => loadAt(e.t) < 8).length} of ${events.length}`);
log("");
log("rule | Y | source | free cancels (files cut) | yields (files cut, file-s lost) | refused: fair / remainder | lane-s freed | edit's wait for the tier p50/p90/sum | named wait behind the tier p50/p90/sum | named verdict, shift p50/p90 | named verdict, next p50/p90");
const table = [];
const runRule = (rule, Y, source) => {
  const o = simulate(rule, Y, source);
  const ew = stats(o.editWait), nv = stats(o.named), nb = stats(o.namedBehind), nn = stats(o.namedNext);
  table.push({ rule, Y, source, ...o, decisions: undefined, ew, nv, nb });
  log(`${rule} | ${Y} | ${source} | ${o.free} (${o.cutFree}) | ${o.yields} (${o.cutYield}, ${o.lostYield.toFixed(0)}) | ${o.refusedFair} / ${o.refusedRemainder} | ${o.freedLane.toFixed(0)} | ${ew.p50}/${ew.p90}/${ew.sum} | ${nb.p50}/${nb.p90}/${nb.sum} | ${nv.p50}/${nv.p90} | ${nn.p50}/${nn.p90}`);
  return o;
};
runRule("236", 0, "est");
for (const rule of ["237", "54", "54u"]) for (const source of ["est", "wall"]) for (const Y of [0, 15, 30, 60, 120]) runRule(rule, Y, source);

log("");
for (const [rule, Y, source] of [["237", 30, "est"], ["54", 30, "est"], ["237", 60, "est"], ["237", 30, "wall"]]) {
  const c = simulate(rule, Y, source).cancels;
  const part = (name, xs) => `${name} ${xs.length} (cut ${xs.reduce((a, x) => a + x.cut, 0)}, lost ${xs.reduce((a, x) => a + x.lost, 0).toFixed(0)} file-s and ${xs.reduce((a, x) => a + (x.laneLost ?? 0), 0).toFixed(0)} lane-s run again, lane freed ${xs.reduce((a, x) => a + x.freed, 0).toFixed(0)} s)`;
  log(`${rule} at ${Y} s, ${source}: ${part("free, tiers <= 4 files", c.filter((x) => x.how === "free" && !x.backlog))}; ${part("free, backlog-sized", c.filter((x) => x.how === "free" && x.backlog))}`);
  for (const by of ["edit", "named", "recreate"]) log(`  yields to ${by}: ${part("tiers <= 4 files", c.filter((x) => x.how === "yield" && x.by === by && !x.backlog))}; ${part("backlog-sized", c.filter((x) => x.how === "yield" && x.by === by && x.backlog))}`);
}

// ---- Question 2: the duration sources against each other, and the 30 s decision ----
log("");
const one = [], mod = [];
for (const xs of hist.values()) for (const h of xs) {
  if (h.oneWall && h.est) one.push(h);
  if (h.est && h.module) mod.push(h.module / h.est);
}
const ratio = (xs) => `p10 ${q(xs, 0.1).toFixed(3)}, p50 ${q(xs, 0.5).toFixed(3)}, p90 ${q(xs, 0.9).toFixed(3)} (n ${xs.length})`;
log(`Vitest module duration / store estimate, every file run with both: ${ratio(mod)}`);
log(`one-file run wall / store estimate: ${ratio(one.map((h) => h.oneWall / h.est))}`);
for (const [lo, hi] of [[0, 10], [10, 30], [30, 1e9]]) {
  const xs = one.filter((h) => h.est >= lo && h.est < hi).map((h) => h.oneWall - h.est);
  log(`  estimate ${lo} to ${hi === 1e9 ? "any" : hi} s: wall - estimate p50 ${q(xs, 0.5).toFixed(2)} s, p90 ${q(xs, 0.9).toFixed(2)} s, max ${Math.max(...xs).toFixed(2)} s (n ${xs.length})`);
}
log(`wall source: a one-file run's wall, else the estimate + ${FIXED_S} s`);
for (const rule of ["237", "54"]) {
  const d = simulate(rule, 30, "est").decisions.filter((x) => x.fair);
  const flip = d.filter((x) => (x.est > 30) !== (x.wall > 30));
  log(`rule ${rule}, yield checks ${d.length}: over 30 s by estimate ${d.filter((x) => x.est > 30).length}, by wall ${d.filter((x) => x.wall > 30).length}, decisions that differ ${flip.length}; remainder wall - estimate ${JSON.stringify(stats(d.map((x) => x.wall - x.est)))}`);
}

// ---- Per-episode verdicts under the three rules at 30 s, the estimate ----
log("");
const before0812 = eps.filter((e) => e.t < Date.parse("2026-10-21T08:12:00Z"));
log(`named episodes before 08:12Z (running-tier-yields.md's copy): ${before0812.length}; recorded verdict over 1,800 s: ${eps.filter((e) => e.recordedS > 1800).length} of ${eps.length}`);
for (const [name, sel] of [["all", () => true], ["behind a tier of <= 4 files", (e) => !e.r.backlog], ["behind a backlog-sized tier", (e) => e.r.backlog]]) {
  const xs = eps.filter(sel);
  const s = (k) => { const x = stats(xs.map((e) => e[k] ?? e.recordedS)); return `p50 ${x.p50}, p90 ${x.p90}`; };
  log(`named episodes, ${name}: ${xs.length}; verdict recorded (236) ${s("recordedS")}; shift: 237 ${s("v_237_30_est")}, 54 ${s("v_54_30_est")}, 54u ${s("v_54u_30_est")}; next: 237 ${s("n_237_30_est")}, 54 ${s("n_54_30_est")}`);
}
const diff = eps.filter((e) => e.v_237_30_est !== e.v_54_30_est || e.n_237_30_est !== e.n_54_30_est);
log(`episodes where 237 and 54 differ at 30 s: ${diff.length}`);
for (const e of diff) log(`  ${new Date(e.t).toISOString()} wt ${e.wt.slice(0, 8)} tier ${e.r.id.slice(0, 8)} (${e.r.files.length} files): 237 ${e.v_237_30_est.toFixed(1)} s, 54 ${e.v_54_30_est.toFixed(1)} s`);
writeFileSync("/tmp/r68/replay.json", JSON.stringify(table, null, 1));
writeFileSync(new URL("./results/replay.txt", import.meta.url), lines.join("\n") + "\n");
