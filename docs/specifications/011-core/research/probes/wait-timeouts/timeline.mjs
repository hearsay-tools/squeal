// Q3: rebuild where each timed-out named wait's 60 s went, from store copies. Throwaway, read only.
// Usage: node timeline.mjs CLS.jsonl SCRATCH_DIR OUT.jsonl [all]
// With `all`, every named wait is split over its own wall (at most 60 s), not only the timed-out ones.
// CLS from classify.py. SCRATCH_DIR holds <project>/store.sqlite copies. For each timed-out wait whose named
// paths include test files: the worktree id (sha256 of the root, src/core/fs/git-layout.ts worktreeIdOfRealPath),
// the runs of that worktree around the wait, and a split of the wait's first 60 s into
//   covered: a run holding a named test file is running
//   other:   only runs holding none of the named test files are running in the worktree
//            (`baseline`: the part of `other` when one of them is a restart baseline's run)
//   idle:    no run of the worktree is running
// (seconds), plus the revision rows in the window, and when the named files' first run that ends after the wait start ended
// ("answered at"). A run row has no cancel flag, so a cancelled tier shows as a run that ends early.
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
const [, , clsPath, scratch, outPath, mode] = process.argv;
const dbs = {};
const db = (p) => (dbs[p] ??= new DatabaseSync(`${scratch}/${p}/store.sqlite`, { readOnly: true }));
const rootOf = (cwd) => {
  const m = cwd.match(/^(\/home\/agent\/projects\/([^/]+)(?:\/\.ai\/cezar\/worktrees\/[^/]+)?)/);
  return m ? { root: m[1], project: m[2] } : null;
};
const out = [];
for (const line of readFileSync(clsPath, "utf8").split("\n")) {
  if (!line) continue;
  const w = JSON.parse(line);
  if ((!w.timedOut && mode !== "all") || !w.cwd) continue;
  const r = rootOf(w.cwd);
  if (!r) continue;
  const wt = createHash("sha256").update(r.root).digest("hex").slice(0, 16);
  const tests = w.paths.filter((p) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(p)).map((p) => {
    const sub = w.cwd.slice(r.root.length).replace(/^\//, "");
    return sub && !p.startsWith(sub) ? `${sub}/${p}` : p;
  });
  const s = Date.parse(w.start), e = s + Math.min(60, Math.max(0.1, w.wall)) * 1000;
  let d;
  try { d = db(r.project); } catch { continue; }
  const runs = d.prepare("SELECT r.id, r.revision, r.test_files, r.checkpoint_id, c.kind cpkind, r.started_at, r.ended_at, r.end_state FROM runs r LEFT JOIN checkpoints c ON c.id = r.checkpoint_id WHERE r.worktree_id = ? AND r.started_at < ? AND coalesce(r.ended_at, r.started_at) > ? ORDER BY r.started_at")
    .all(wt, e + 900_000, s - 900_000)
    .map((x) => {
      const files = JSON.parse(x.test_files).map((f) => f.path);
      return { id: x.id, rev: x.revision, n: files.length, cp: x.checkpoint_id ? (x.cpkind ?? "gone") : null, start: x.started_at, end: x.ended_at ?? x.started_at,
        named: tests.filter((t) => files.includes(t)).length };
    });
  const revs = d.prepare("SELECT number, created_at, trigger FROM revisions WHERE worktree_id = ? AND created_at BETWEEN ? AND ? ORDER BY number").all(wt, s - 300_000, e + 300_000);
  const anyRun = d.prepare("SELECT count(*) n FROM runs WHERE worktree_id = ?").get(wt).n;
  // Split [s, e] by 0.1 s steps.
  let covered = 0, other = 0, idle = 0, baseline = 0;
  for (let t = s; t < e; t += 100) {
    const live = runs.filter((x) => x.start <= t && t < x.end);
    if (live.some((x) => x.named > 0)) covered++;
    else if (live.length) {
      other++;
      if (live.some((x) => x.cp === "baseline" || x.cp === "gone")) baseline++;
    }
    else idle++;
  }
  const ans = tests.length ? runs.filter((x) => x.named > 0 && x.end > s) : [];
  const firstNamedStart = ans.length ? Math.min(...ans.map((x) => x.start)) : null;
  // When every named test file has a run ending after s: the latest of each file's first such end.
  let answeredAt = null;
  if (tests.length) {
    const ends = tests.map((t) => {
      const hits = runs.filter((x) => x.end > s && x.named > 0 && d.prepare("SELECT 1 FROM runs WHERE id = ? AND test_files LIKE ?").get(x.id, `%"${t}"%`));
      return hits.length ? Math.min(...hits.map((x) => x.end)) : null;
    });
    answeredAt = ends.every((x) => x !== null) ? Math.max(...ends) : null;
  }
  out.push({ start: w.start, wall: w.wall, timedOut: w.timedOut, project: r.project, wt, band: w.band, busy: w.busy, primary: w.primary, nTests: tests.length, sources: w.sources,
    storeHasWorktree: anyRun > 0, runsInWindow: runs.filter((x) => x.start < e && x.end > s).length,
    covered: covered / 10, other: other / 10, idle: idle / 10, baseline: baseline / 10,
    firstNamedStartAfter: firstNamedStart === null ? null : (firstNamedStart - s) / 1000,
    answeredAfter: answeredAt === null ? null : (answeredAt - s) / 1000,
    revisions: revs.map((v) => ({ n: v.number, at: (v.created_at - s) / 1000, trigger: v.trigger })),
    runs: runs.filter((x) => x.start < e + 600_000 && x.end > s - 120_000).map((x) => ({ rev: x.rev, n: x.n, named: x.named, cp: x.cp, start: (x.start - s) / 1000, end: (x.end - s) / 1000 })) });
}
writeFileSync(outPath, out.map((x) => JSON.stringify(x)).join("\n") + "\n");
console.log("waits", out.length, "with runs of the worktree in the store", out.filter((x) => x.storeHasWorktree).length);
