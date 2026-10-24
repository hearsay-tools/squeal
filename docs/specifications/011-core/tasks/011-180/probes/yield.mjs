// Row 011-180: each run C4 step 5's yield cancelled, file by file, from a store copy and the run logs copied
// with it, read only. Prints one JSON line per run, then a summary line.
// Usage: node yield.mjs <store copy> <hours> <runs snapshot> <end, ISO time> [projects outside the fast Vitest lane,
// comma-separated]
// Built on tasks/011-136/probes/cut.mjs with the cause changed: the same file classes (completed, endedWithheld,
// grace, inFlight, neverStarted) and the same two bounds of a cut file's seconds (low: its tests that passed or
// failed in the run; high: its module duration in the nearest later run of its worktree, at most the run's wall).
// Added: the daemon's estimate at the cancel and rule B's branch (src/core/scheduler/yields.ts #decide), the
// revisions during the run, the next run of the worktree in the fast Vitest lane, and each cut file's remainder.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const [, , path, hours, logs, endArg, otherArg = ""] = process.argv;
if (!endArg) throw new Error("usage: yield.mjs <store copy> <hours> <runs snapshot> <end> [other projects]");
const db = new DatabaseSync(path, { readOnly: true });
const end = Date.parse(endArg), since = end - Number(hours) * 3600_000;
const CAUSE = "run cancelled: it yielded to an edit's work, a promoted file or a runner part waiting for it";
const YIELD_S = 30; // YIELD_REMAINDER_MS
const other = new Set(otherArg.split(",").filter(Boolean));
const live = new Set(db.prepare("SELECT id FROM worktrees").all().map((w) => w.id));
const read = (dir, name) => { try { return readFileSync(`${logs}/${dir.split("/").pop()}/${name}`, "utf8"); } catch { return null; } };
const reportOf = (run) => { if (run.rep !== undefined) return run.rep; const t = read(run.log_dir, "report.json"); try { return (run.rep = t && JSON.parse(t).report); } catch { return (run.rep = null); } };
const id = (f) => f.project + "\0" + f.path;
const label = (k) => { const [p, f] = k.split("\0"); return p ? `[${p}] ${f}` : f; };
const all = db.prepare("SELECT * FROM runs ORDER BY started_at").all();
const byWorktree = new Map();
for (const r of all) { const l = byWorktree.get(r.worktree_id) ?? []; byWorktree.set(r.worktree_id, l); l.push(r); }
const picks = (r) => (r.picks ??= JSON.parse(r.test_files).map(id));
const fast = (r) => picks(r).every((k) => !other.has(k.split("\0")[0]));
const revisionsOf = db.prepare("SELECT number, created_at, changes FROM revisions WHERE worktree_id = ? ORDER BY number");
const closureOf = db.prepare("SELECT closure_paths FROM test_files WHERE project = ? AND path = ?");
// As cut.mjs: the log's labels, the MODULE lines before and after the cancel note, per label its tests.
const parse = (text) => {
  const named = new Set(), before = new Set(), after = new Set(), tests = new Map();
  let cancelled = false;
  const of = (l) => tests.get(l) ?? (tests.set(l, { all: new Set(), ran: new Set(), skip: new Set(), ms: new Map() }), tests.get(l));
  for (const line of text.split("\n")) {
    let m;
    if (line.startsWith("squeal: run cancelled")) cancelled = true;
    else if ((m = /^MODULE \S+ (.+)$/.exec(line))) { named.add(m[1]); (cancelled ? after : before).add(m[1]); }
    else if ((m = /^(PASS|FAIL|SKIP) (.+?) > (.+?)(?: \((\d+) ms\))?$/.exec(line))) {
      named.add(m[2]); const t = of(m[2]); t.all.add(m[3]);
      if (m[1] !== "SKIP" && m[4]) t.ms.set(m[3], Number(m[4]) / 1000);
      if (m[1] === "SKIP") t.skip.add(m[3]); else if (!cancelled) t.ran.add(m[3]);
    }
    else if ((m = /^\[\w+\] ("(?:[^"\\]|\\.)*"|.+?): /.exec(line))) named.add(m[1][0] === '"' ? JSON.parse(m[1]) : m[1]);
  }
  return { named, before, after, tests, noted: cancelled };
};
const durationsOf = (r) => (r.durs ??= new Map((reportOf(r)?.fileDurations ?? []).map((d) => [id(d.testFile), d.durationMs / 1000])));
// A file's module duration in the nearest later run of the same worktree that reports one (cut.mjs's high bound).
const durationLater = (run, k) => {
  for (const r of byWorktree.get(run.worktree_id) ?? []) {
    if (r.started_at <= run.started_at || !picks(r).includes(k)) continue;
    const d = durationsOf(r).get(k);
    if (d !== undefined) return d;
  }
  return null;
};
// The daemon's last-known duration, inferred: the module duration in the nearest earlier run that ended before the
// tier started, of the same worktree (its own results), else of any worktree (a lookup or the bootstrap's newest).
const estimateOf = (run, k) => {
  const earlier = (list) => list.filter((r) => r.ended_at !== null && r.ended_at <= run.started_at && picks(r).includes(k)).reverse();
  for (const r of earlier(byWorktree.get(run.worktree_id) ?? [])) { const d = durationsOf(r).get(k); if (d !== undefined) return { s: d, from: "worktree" }; }
  for (const r of earlier(all)) { const d = durationsOf(r).get(k); if (d !== undefined) return { s: d, from: "other" }; }
  return { s: null, from: null };
};
const r1 = (x) => (x === null || x === undefined ? null : +x.toFixed(1));
const out = [];
for (const run of all) {
  if (run.started_at < since || run.started_at > end || run.ended_at === null) continue;
  const rep = reportOf(run);
  if (!String(rep?.failure ?? "").startsWith(CAUSE)) continue;
  const files = picks(run), wall = (run.ended_at - run.started_at) / 1000;
  const log = parse(read(run.log_dir, "vitest.log") ?? "");
  const completed = new Set((rep.completedFiles ?? []).map(id));
  const scope = live.has(run.worktree_id) ? "live" : "removed";
  const list = byWorktree.get(run.worktree_id) ?? [];
  const later = list.filter((r) => r.started_at > run.started_at);
  const c = { completed: 0, endedWithheld: 0, grace: 0, inFlight: 0, neverStarted: 0, handedOver: 0, cutRerun: 0 };
  const secs = { low: 0, high: 0, unknown: 0 };
  const cutFiles = [];
  // Rule B at the cancel: the largest estimate among the files whose module had not ended before the note
  // (a file with none counts 0), less the time run; the cancel is taken at the run's end (an upper bound).
  let estS = 0, estKnown = 0, estUnknown = 0, actualMax = 0, actualKnown = true;
  for (const k of files) {
    const l = label(k);
    if (completed.has(k)) { c.completed++; continue; }
    if (log.before.has(l) && !log.after.has(l)) { c.endedWithheld++; continue; }
    const est = estimateOf(run, k);
    if (est.s === null) estUnknown++; else { estKnown++; estS = Math.max(estS, est.s); }
    const laterS = durationLater(run, k);
    if (laterS === null) actualKnown = false; else actualMax = Math.max(actualMax, laterS);
    if (!log.named.has(l)) { c.neverStarted++; if (later.some((r) => picks(r).includes(k))) c.handedOver++; continue; }
    const grace = log.after.has(l);
    const high = laterS === null ? wall : Math.min(laterS, wall);
    if (laterS === null) secs.unknown++;
    const low = [...(log.tests.get(l)?.ms.values() ?? [])].reduce((a, b) => a + b, 0);
    const rerun = later.some((r) => picks(r).includes(k));
    if (rerun) c.cutRerun++;
    c[grace ? "grace" : "inFlight"]++; secs.low += low; secs.high += high;
    cutFiles.push({ file: k.split("\0")[1], how: grace ? "grace" : "inFlight", lowS: r1(low), highS: r1(high), estS: r1(est.s),
      estFrom: est.from, laterS: r1(laterS), leftS: laterS === null ? null : r1(laterS - wall), rerun });
  }
  const remainderS = estS - wall;
  const branch = remainderS > YIELD_S ? "remainder" : -remainderS >= YIELD_S ? "overrun" : "neither";
  // The revisions during the run (exact in a live worktree), and the next run of the worktree in the fast lane.
  const revs = revisionsOf.all(run.worktree_id);
  const during = revs.filter((r) => r.created_at > run.started_at && r.created_at <= run.ended_at);
  const next = later.find((r) => fast(r) && r.started_at >= run.ended_at - 1000) ?? null;
  const changed = new Set(during.flatMap((r) => JSON.parse(r.changes).map((x) => x.path)));
  const reached = (k) => { const [p, f] = k.split("\0"); if (changed.has(f)) return true; const row = closureOf.get(p, f); return !!row && JSON.parse(row.closure_paths).some((x) => changed.has(x)); };
  const nextRep = next && reportOf(next);
  for (const x of Object.keys(secs)) secs[x] = r1(secs[x]);
  out.push({
    run: run.id.slice(0, 8), worktree: run.worktree_id.slice(0, 8), scope, revision: run.revision,
    checkpoint: run.checkpoint_id ? run.checkpoint_id.slice(0, 8) : null, start: new Date(run.started_at).toISOString(),
    wall, picked: files.length, ...c, secs, noted: log.noted,
    rule: { estS: r1(estS), estKnown, estUnknown, remainderS: r1(remainderS), branch },
    actual: { maxS: actualKnown ? r1(actualMax) : null, leftS: actualKnown ? r1(actualMax - wall) : null },
    during: during.map((r) => ({ n: r.number, atS: r1((r.created_at - run.started_at) / 1000), count: JSON.parse(r.changes).length,
      paths: JSON.parse(r.changes).map((x) => x.path).slice(0, 4) })),
    next: next && { run: next.id.slice(0, 8), revision: next.revision, afterEndS: r1((next.started_at - run.ended_at) / 1000),
      wall: r1((next.ended_at - next.started_at) / 1000), picked: picks(next).length, checkpoint: !!next.checkpoint_id,
      failure: String(nextRep?.failure ?? "").split("\n")[0] || null, reached: scope === "live" ? picks(next).filter(reached).length : null,
      hasCut: picks(next).filter((k) => cutFiles.some((f) => f.file === k.split("\0")[1])).length,
      files: picks(next).slice(0, 4).map((k) => k.split("\0")[1]) },
    cutFiles,
  });
}
for (const o of out) console.log(JSON.stringify(o));
const sum = (f) => +out.reduce((a, o) => a + f(o), 0).toFixed(1);
console.log(JSON.stringify({ summary: true, runs: out.length, picked: sum((o) => o.picked), completed: sum((o) => o.completed),
  endedWithheld: sum((o) => o.endedWithheld), grace: sum((o) => o.grace), inFlight: sum((o) => o.inFlight),
  neverStarted: sum((o) => o.neverStarted), handedOver: sum((o) => o.handedOver), cutRerun: sum((o) => o.cutRerun),
  secs: { low: sum((o) => o.secs.low), high: sum((o) => o.secs.high), unknown: sum((o) => o.secs.unknown) },
  branches: Object.fromEntries(["remainder", "overrun", "neither"].map((b) => [b, out.filter((o) => o.rule.branch === b).length])) }));
