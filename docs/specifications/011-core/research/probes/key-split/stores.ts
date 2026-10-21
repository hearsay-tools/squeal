// Throwaway probe for 011-81: whole-project re-keys in one store, read-only.
// Usage: node stores.ts <store.sqlite> <from-ms> <to-ms> <runner-files.json>
// runner-files.json: { "<project>": ["<runner file>", ...] }.
// An event is a revision whose changes hold an installed lockfile, a file
// under `patches/`, or a project's runner file. Its cost is the runs of that
// worktree from the event to the next event there, at most 4 hours.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [storePath, fromArg, toArg, runnerArg] = process.argv.slice(2);
const from = Number(fromArg);
const to = Number(toArg);
const runnerFiles: Record<string, string[]> = JSON.parse(readFileSync(runnerArg, "utf8"));
const db = new DatabaseSync(storePath, { readOnly: true });

const LOCKFILE = /(^|\/)node_modules\/(\.package-lock\.json|\.pnpm\/lock\.yaml|\.yarn-state\.yml|\.yarn-integrity)$/;
const WINDOW = 4 * 3600_000;

interface Change { path: string; oldHash: string | null; newHash: string | null }
const roots = new Map<string, string>();
for (const w of db.prepare("select id, root from worktrees").all() as { id: string; root: string }[]) {
  roots.set(w.id, w.root);
}

const revisions = db
  .prepare("select worktree_id, number, created_at, trigger, changes from revisions where created_at between ? and ? order by created_at")
  .all(from, to) as { worktree_id: string; number: number; created_at: number; trigger: string; changes: string }[];

/** The last non-null installed-lockfile hash of a worktree before a revision, from all its revisions. */
const lockHistory = db
  .prepare("select worktree_id, number, changes from revisions where changes like '%node_modules/%' order by number")
  .all() as { worktree_id: string; number: number; changes: string }[];
function previousLockfile(worktree: string, before: number): string | null {
  let last: string | null = null;
  for (const r of lockHistory) {
    if (r.worktree_id !== worktree || r.number >= before) continue;
    for (const c of JSON.parse(r.changes) as Change[]) {
      if (LOCKFILE.test(c.path)) last = c.newHash?.slice(0, 10) ?? c.oldHash?.slice(0, 10) ?? last;
    }
  }
  return last;
}

interface Event { lockfile: string[]; previousLockfile: string | null; worktree: string; revision: number; at: number; trigger: string; cause: string; projects: string[]; paths: string[] }
const events: Event[] = [];
for (const r of revisions) {
  const changes: Change[] = JSON.parse(r.changes);
  const lock = changes.filter((c) => LOCKFILE.test(c.path) || c.path.startsWith("patches/"));
  const runner = changes.filter((c) => Object.values(runnerFiles).some((files) => files.includes(c.path)));
  if (lock.length === 0 && runner.length === 0) continue;
  const projects = new Set<string>();
  if (lock.length > 0) for (const p of Object.keys(runnerFiles)) projects.add(p);
  for (const c of runner) {
    for (const [p, files] of Object.entries(runnerFiles)) if (files.includes(c.path)) projects.add(p);
  }
  const lockOnly = lock.filter((c) => c.oldHash !== null && c.newHash !== null);
  const cause =
    lock.length > 0
      ? lockOnly.length > 0 ? "installed lockfile changed" : "installed lockfile added or removed"
      : "runner file changed";
  events.push({
    worktree: r.worktree_id, revision: r.number, at: r.created_at, trigger: r.trigger, cause,
    projects: [...projects].sort(), paths: [...lock, ...runner].map((c) => c.path),
    lockfile: lock.map((c) => `${c.path} ${c.oldHash?.slice(0, 10) ?? "-"}>${c.newHash?.slice(0, 10) ?? "-"}`),
    previousLockfile: previousLockfile(r.worktree_id, r.number),
  });
}

const runs = db
  .prepare("select worktree_id, started_at, ended_at, test_files from runs where started_at between ? and ?")
  .all(from, to + WINDOW) as { worktree_id: string; started_at: number; ended_at: number | null; test_files: string }[];

const rows = events.map((e, i) => {
  const next = events.slice(i + 1).find((n) => n.worktree === e.worktree);
  const end = Math.min(next?.at ?? Infinity, e.at + WINDOW);
  const after = runs.filter((r) => r.worktree_id === e.worktree && r.started_at >= e.at && r.started_at < end);
  const files = new Set<string>();
  let picked = 0;
  let ms = 0;
  for (const r of after) {
    const list = JSON.parse(r.test_files) as { project: string; path: string }[];
    picked += list.length;
    for (const f of list) if (e.projects.includes(f.project)) files.add(`${f.project}\0${f.path}`);
    if (r.ended_at !== null) ms += r.ended_at - r.started_at;
  }
  return {
    ...e,
    root: roots.get(e.worktree)?.split("/").pop()?.slice(0, 8) ?? e.worktree,
    at: new Date(e.at).toISOString(),
    windowMinutes: Math.round((end - e.at) / 60000),
    runs: after.length,
    filesPicked: picked,
    distinctFilesOfProjects: files.size,
    runHours: Math.round((ms / 3600_000) * 100) / 100,
  };
});

const total = db
  .prepare("select count(*) n, sum(coalesce(ended_at, started_at) - started_at) ms from runs where started_at between ? and ?")
  .get(from, to) as { n: number; ms: number };
const testFiles = db.prepare("select project, count(*) n from test_files group by project").all();
console.log(JSON.stringify({ storePath, from: new Date(from).toISOString(), to: new Date(to).toISOString(),
  runsInWindow: total.n, runHoursInWindow: Math.round((total.ms / 3600_000) * 10) / 10, testFiles, events: rows }, null, 1));
