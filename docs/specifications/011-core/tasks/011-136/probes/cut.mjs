// Row 011-136: each run an edit's cancel cut in a backlog tier, file by file, from a store copy and the run
// logs copied with it, read only. Prints one JSON line per run, then a summary line.
// Usage: node cut.mjs <store copy> <hours> <runs snapshot> <end, ISO time>
// A picked file is one of: completed (in the report's completedFiles: ended before the cancel); endedWithheld
// (a MODULE line before the log's cancel note, not completed: the adapter withheld it); grace (a MODULE line
// after the note: ended in the grace, the report drops it), whole when every test it was to run has a PASS or
// FAIL line before the note; inFlight (named by a test or console line, no MODULE line: the forced cancel cut
// it); neverStarted (the log never names it, as waste.mjs counts it). Started and cut: grace plus inFlight.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const [, , path, hours, logs, endArg] = process.argv;
if (!endArg) throw new Error("usage: cut.mjs <store copy> <hours> <runs snapshot> <end>");
const db = new DatabaseSync(path, { readOnly: true });
const end = Date.parse(endArg), since = end - Number(hours) * 3600_000;
const CAUSE = "run cancelled: an edit arrived during a backlog tier";
const live = new Set(db.prepare("SELECT id FROM worktrees").all().map((w) => w.id));
const read = (dir, name) => { try { return readFileSync(`${logs}/${dir.split("/").pop()}/${name}`, "utf8"); } catch { return null; } };
const reportOf = (run) => { const t = read(run.log_dir, "report.json"); try { return t && JSON.parse(t).report; } catch { return null; } };
const id = (f) => f.project + "\0" + f.path;
const label = (k) => { const [p, f] = k.split("\0"); return p ? `[${p}] ${f}` : f; };
const storedOf = db.prepare("SELECT DISTINCT c.project p, c.test_path t FROM results r JOIN checks c ON c.id = r.check_id WHERE r.run_id = ?");
const all = db.prepare("SELECT * FROM runs ORDER BY started_at").all();
const byWorktree = new Map();
for (const r of all) { const l = byWorktree.get(r.worktree_id) ?? []; byWorktree.set(r.worktree_id, l); l.push(r); }
const picks = (r) => (r.picks ??= JSON.parse(r.test_files).map(id));
const revisionsOf = db.prepare("SELECT number, created_at, changes FROM revisions WHERE worktree_id = ? ORDER BY number");
// The log's labels by kind; the MODULE lines before and after the cancel note; per label the distinct test
// names, those with a PASS or FAIL line before the note, and those with a SKIP line.
const parse = (text) => {
  const named = new Set(), before = new Set(), after = new Set(), tests = new Map();
  let cancelled = false;
  const of = (l) => tests.get(l) ?? (tests.set(l, { all: new Set(), ran: new Set(), skip: new Set() }), tests.get(l));
  for (const line of text.split("\n")) {
    let m;
    if (line.startsWith("squeal: run cancelled")) cancelled = true;
    else if ((m = /^MODULE \S+ (.+)$/.exec(line))) { named.add(m[1]); (cancelled ? after : before).add(m[1]); }
    else if ((m = /^(PASS|FAIL|SKIP) (.+?) > (.+?)(?: \(\d+ ms\))?$/.exec(line))) {
      named.add(m[2]); const t = of(m[2]); t.all.add(m[3]);
      if (m[1] === "SKIP") t.skip.add(m[3]); else if (!cancelled) t.ran.add(m[3]);
    }
    else if ((m = /^\[\w+\] ("(?:[^"\\]|\\.)*"|.+?): /.exec(line))) named.add(m[1][0] === '"' ? JSON.parse(m[1]) : m[1]);
  }
  return { named, before, after, tests, noted: cancelled };
};
// The tests a later run of the worktree skipped in a module it ended before any cancel: declared skips.
const skipsLater = (run, k) => {
  for (const r of byWorktree.get(run.worktree_id) ?? []) {
    if (r.started_at <= run.started_at || !picks(r).includes(k)) continue;
    const log = parse(read(r.log_dir, "vitest.log") ?? "");
    if (log.before.has(label(k))) return log.tests.get(label(k))?.skip ?? new Set();
  }
  return null;
};
// A file's module duration in the nearest later run of the same worktree that reports one, else in any run.
const durationLater = (run, k) => {
  for (const r of byWorktree.get(run.worktree_id) ?? []) {
    if (r.started_at <= run.started_at || !picks(r).includes(k)) continue;
    const d = (reportOf(r)?.fileDurations ?? []).find((x) => id(x.testFile) === k);
    if (d) return d.durationMs / 1000;
  }
  return null;
};
const out = [];
for (const run of all) {
  if (run.started_at < since || run.started_at > end || run.ended_at === null) continue;
  const rep = reportOf(run);
  if (!String(rep?.failure ?? "").startsWith(CAUSE)) continue;
  const files = picks(run), wall = (run.ended_at - run.started_at) / 1000;
  const log = parse(read(run.log_dir, "vitest.log") ?? "");
  const completed = new Set((rep.completedFiles ?? []).map(id));
  const stored = new Set(storedOf.all(run.id).map((r) => r.p + "\0" + r.t));
  const scope = live.has(run.worktree_id) ? "live" : "removed";
  const list = byWorktree.get(run.worktree_id) ?? [];
  const later = list.filter((r) => r.started_at > run.started_at);
  const earlier = list.filter((r) => r.started_at < run.started_at);
  const c = { completed: 0, stored: 0, keptPruned: 0, endedWithheld: 0, grace: 0, graceWhole: 0, graceWholeUnsure: 0,
    inFlight: 0, neverStarted: 0, handedOver: 0, cutRerun: 0 };
  const cutFiles = [];
  const secs = { completed: 0, withheld: 0, grace: 0, graceWhole: 0, inFlight: 0, unknown: 0 };
  const durations = new Map((rep.fileDurations ?? []).map((d) => [id(d.testFile), d.durationMs / 1000]));
  // The cost of a started file the report did not complete: its later module duration, at most the run's wall.
  const costOf = (k) => { const d = durationLater(run, k); if (d === null) secs.unknown++; return d === null ? 0 : Math.min(d, wall); };
  for (const k of files) {
    const l = label(k);
    if (stored.has(k)) c.stored++;
    else if (scope === "removed" && completed.has(k)) c.keptPruned++;
    if (completed.has(k)) { c.completed++; secs.completed += durations.get(k) ?? 0; continue; }
    if (log.before.has(l) && !log.after.has(l)) { c.endedWithheld++; secs.withheld += costOf(k); continue; }
    if (!log.named.has(l)) { c.neverStarted++; if (later.some((r) => picks(r).includes(k))) c.handedOver++; continue; }
    const grace = log.after.has(l), s = costOf(k);
    const rerun = later.some((r) => picks(r).includes(k));
    if (rerun) c.cutRerun++;
    let whole = null;
    if (grace) {
      // Whole, as 011-137's rule reads it: every test it was to run reported before the cancel.
      const t = log.tests.get(l) ?? { all: new Set(), ran: new Set() }, declared = skipsLater(run, k);
      const toRun = [...t.all].filter((n) => !(declared ?? new Set()).has(n));
      whole = toRun.length > 0 && toRun.every((n) => t.ran.has(n));
      c.grace++; secs.grace += s;
      if (whole) { c.graceWhole++; secs.graceWhole += s; if (declared === null) c.graceWholeUnsure++; }
    } else { c.inFlight++; secs.inFlight += s; }
    cutFiles.push({ file: k.split("\0")[1], how: grace ? "grace" : "inFlight", whole, secs: +s.toFixed(1), rerun });
  }
  for (const x of Object.keys(secs)) secs[x] = +secs[x].toFixed(1);
  // The revisions around the run: exact in a live worktree; bounded by the runs' revisions in a removed one.
  const revs = revisionsOf.all(run.worktree_id);
  const atStart = revs.filter((r) => r.created_at <= run.started_at);
  const last = atStart.at(-1) ?? null;
  const during = revs.filter((r) => r.created_at > run.started_at && r.created_at <= run.ended_at);
  const firstAtRev = earlier.concat([run]).find((r) => r.revision === run.revision);
  const lastBelow = earlier.filter((r) => r.revision < run.revision).at(-1);
  const prev = earlier.at(-1) ?? null, next = later[0] ?? null;
  const prevRep = prev && reportOf(prev);
  const prevBacklogCancel = earlier.filter((r) => picks(r).length >= 13).at(-1) ?? null;
  const pbcRep = prevBacklogCancel && reportOf(prevBacklogCancel);
  out.push({
    run: run.id.slice(0, 8), worktree: run.worktree_id.slice(0, 8), scope, revision: run.revision,
    checkpoint: run.checkpoint_id ? run.checkpoint_id.slice(0, 8) : null,
    start: new Date(run.started_at).toISOString(), wall, durationMs: rep.durationMs, picked: files.length, ...c,
    secs,
    noted: log.noted, cutFiles,
    quiet: last
      ? { exact: true, lastRevision: last.number, sinceLastRevisionS: (run.started_at - last.created_at) / 1000,
          revisionsDuring: during.map((r) => ({ n: r.number, atS: (r.created_at - run.started_at) / 1000, paths: JSON.parse(r.changes).map((x) => x.path).slice(0, 6) })) }
      : { exact: false, sinceRevisionAtLeastS: firstAtRev ? (run.started_at - firstAtRev.started_at) / 1000 : null,
          sinceRevisionBelowS: lastBelow ? (run.started_at - lastBelow.started_at) / 1000 : null },
    prev: prev && { run: prev.id.slice(0, 8), revision: prev.revision, picked: picks(prev).length, checkpoint: !!prev.checkpoint_id,
      endedBeforeS: (run.started_at - prev.ended_at) / 1000, failure: String(prevRep?.failure ?? "").split("\n")[0] || null },
    prevLarge: prevBacklogCancel && { run: prevBacklogCancel.id.slice(0, 8), revision: prevBacklogCancel.revision, picked: picks(prevBacklogCancel).length,
      endedBeforeS: (run.started_at - prevBacklogCancel.ended_at) / 1000, failure: String(pbcRep?.failure ?? "").split("\n")[0] || null },
    next: next && { run: next.id.slice(0, 8), revision: next.revision, picked: picks(next).length, checkpoint: !!next.checkpoint_id,
      afterEndS: (next.started_at - run.ended_at) / 1000, files: picks(next).slice(0, 4).map((k) => k.split("\0")[1]) },
    runsInWorktree: list.length,
  });
}
for (const o of out) console.log(JSON.stringify(o));
const sum = (f) => out.reduce((a, o) => a + f(o), 0);
const keys = Object.keys(out[0] ?? {}).filter((x) => typeof out[0][x] === "number" && x !== "revision");
console.log(JSON.stringify({ summary: true, runs: out.length, ...Object.fromEntries(keys.map((x) => [x, +sum((o) => o[x]).toFixed(1)])),
  secs: Object.fromEntries(Object.keys(out[0]?.secs ?? {}).map((x) => [x, +sum((o) => o.secs[x]).toFixed(1)])) }));
