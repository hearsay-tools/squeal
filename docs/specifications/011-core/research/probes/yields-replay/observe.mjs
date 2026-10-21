// THROWAWAY probe (011-core/research/yields-replay.md, row 011-68). What cezar's daemons did under
// the shipped rule: fast Vitest tiers started after a 0.1.237 or 0.1.238 daemon of their worktree
// started, read only. A tier of at most 4 files outside a checkpoint that ends "run cancelled"
// can only be 0.1.237's supersession or yield (0.1.236 cancelled backlog tiers only). For each tier
// with an event, the 0.1.237 decision the replay's model makes, against what happened.
import { writeFileSync } from "node:fs";
import { runs, runsOf, revsOf, reach, keyedCount, RECREATE, lastKnown, waits, loadAt, roots, stats, db } from "./load-data.mjs";

const shipped = new Map(roots.filter((r) => ["0.1.237", "0.1.238"].includes(r.daemon_version)).map((r) => [r.id, r]));
const lines = [];
const log = (s) => { lines.push(s); console.log(s); };
const copiedAt = Math.max(...runs.map((r) => r.e));
const mine = runs.filter((r) => shipped.has(r.wt) && r.s >= shipped.get(r.wt).daemon_started_at);
log(`worktrees with a 0.1.237 or 0.1.238 daemon: ${shipped.size}; their fast Vitest tiers since the daemon's start: ${mine.length} (of <= 4 files outside a checkpoint: ${mine.filter((r) => !r.backlog).length}), up to ${new Date(copiedAt).toISOString()}`);
const ISO = (t) => new Date(t).toISOString().slice(11, 19);
const rows = [];
// A named path is promoted and queued only when it has no current result: as replay.mjs, its file
// runs after the tier, with no revision re-keying it between the wait and that run.
const pending = (r, w, path) => {
  const next = (runsOf.get(r.wt) ?? []).find((x) => x.s >= w.at && x.files.some((f) => f.endsWith("\0" + path)));
  if (!next || next.s < r.e - 1000 || next.s - w.at > 1800_000) return false;
  return !(revsOf.get(r.wt) ?? []).some((v) => v.t > w.at && v.t < next.s && [...reach(v.changes)].some((f) => f.endsWith("\0" + path)));
};
const marks = new Map(); // `${wt}\0${file}` -> { t, r }: a yield's cut, as replay.mjs `markLive`
const markLive = (wt, f, cut, t) =>
  !(revsOf.get(wt) ?? []).some((v) => v.t > cut.t && v.t <= t && reach(v.changes).has(f)) &&
  !(runsOf.get(wt) ?? []).some((x) => x !== cut.r && x.s > cut.t && x.e <= t && x.files.includes(f) && x.completed.has(f));
for (const r of mine) {
  const revs = (revsOf.get(r.wt) ?? []).filter((v) => v.t >= r.s && v.t < r.e);
  const named = waits.filter((w) => w.wt === r.wt && w.at >= r.s && w.at < r.e && w.paths.some((p) => !r.files.some((f) => f.endsWith("\0" + p))));
  if (!r.cancelled && !revs.length && !named.length) continue;
  const changed = new Set();
  const evs = [];
  for (const v of revs) {
    const reached = reach(v.changes);
    for (const f of r.files) if (reached.has(f)) changed.add(f);
    const edit = keyedCount(v.changes) < 10 && reached.size > 0;
    const recreate = v.changes.some((c) => RECREATE.test(c.path));
    evs.push({ t: v.t, kind: `r${v.number}`, superseded: r.files.every((f) => changed.has(f)), waited: edit || recreate });
  }
  for (const w of named) evs.push({ t: w.at, kind: "named", superseded: false, waited: w.paths.some((p) => !r.files.some((f) => f.endsWith("\0" + p)) && pending(r, w, p)) });
  evs.sort((a, b) => a.t - b.t);
  let model = null;
  for (const ev of evs) {
    const el = (ev.t - r.s) / 1000;
    if (ev.superseded) { model = { t: ev.t, why: "superseded" }; break; }
    if (!ev.waited || (r.backlog && ev.kind !== "named")) continue;
    const rem = Math.max(0, ...r.files.map((f) => (lastKnown(f, r.s) ?? 0) - el));
    if (rem <= 30) continue;
    const marked = r.files.find((f) => { const m = marks.get(`${r.wt}\0${f}`); return m && markLive(r.wt, f, m, ev.t); });
    if (marked) { model = { t: null, why: `refused at +${el.toFixed(0)} s, ${marked.split("\0")[1].split("/").pop()} already cut` }; break; }
    model = { t: ev.t, why: `yield to ${ev.kind}, remainder ${rem.toFixed(0)} s` };
    for (const f of r.files) marks.set(`${r.wt}\0${f}`, { t: ev.t, r });
    break;
  }
  const last = evs.filter((e) => e.t <= r.e).at(-1);
  rows.push({
    run: r.id.slice(0, 8), wt: r.wt.slice(0, 8), start: ISO(r.s), files: r.files.length, backlog: r.backlog, wallS: (r.e - r.s) / 1000,
    cancelled: r.cancelled, completed: r.completed.size, events: evs.map((e) => `${e.kind}${e.kind === "named" && !e.waited ? "(current)" : ""}@+${((e.t - r.s) / 1000).toFixed(0)}s`).join(" "),
    model: model ? (model.t === null ? model.why : `${model.why} at +${((model.t - r.s) / 1000).toFixed(0)} s`) : "runs to its end",
    modelEndS: model?.t ? (model.t - r.s) / 1000 + 3.1 : null,
    eventToEndS: r.cancelled && evs.length ? (r.e - Math.max(...evs.filter((e) => e.t <= r.e).map((e) => e.t))) / 1000 : null,
    load: loadAt(r.s), failure: r.failure,
    // A cancelled tier's last-known remainder at its last event, less what the cancel took: the time
    // 0.1.236 would have kept the lane (estimated).
    savedS: r.cancelled && last ? Math.max(0, ...r.files.map((f) => (lastKnown(f, r.s) ?? 0) - (last.t - r.s) / 1000)) - (r.e - last.t) / 1000 : null,
  });
}
log("run | worktree | start | files | backlog-sized | wall s | cancelled | modules ended | events (+s from start) | model 0.1.237 at 30 s | load");
for (const x of rows) log(`${x.run} | ${x.wt} | ${x.start} | ${x.files} | ${x.backlog} | ${x.wallS.toFixed(1)} | ${x.cancelled} | ${x.completed} | ${x.events} | ${x.model} | ${x.load}`);
const small = rows.filter((x) => !x.backlog);
const agree = small.filter((x) => x.cancelled === (x.modelEndS !== null));
log(`tiers of <= 4 files with an event or a cancel: ${small.length}; cancelled ${small.filter((x) => x.cancelled).length}; the model agrees on cancel or not in ${agree.length}`);
log(`cancelled tiers of <= 4 files, estimated lane time saved against running to the end: ${small.filter((x) => x.cancelled).map((x) => `${x.run} ${x.savedS.toFixed(1)} s`).join(", ")}`);
log(`cancelled tiers of <= 4 files, last event to run end: ${JSON.stringify(stats(small.filter((x) => x.cancelled && x.eventToEndS !== null).map((x) => x.eventToEndS)))}`);
// The `yields` meta rows as published at the copy.
for (const m of db.prepare("select key, value from meta where key like 'yields:%'").all()) log(`meta ${m.key}: ${m.value}`);
writeFileSync(new URL("./results/observe.txt", import.meta.url), lines.join("\n") + "\n");
