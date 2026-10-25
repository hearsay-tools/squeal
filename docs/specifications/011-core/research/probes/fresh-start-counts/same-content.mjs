// 011-223 probe, question 3: for each live worktree registered in the window, whether some worktree had
// already listed at its start commit (exact), or at a commit whose test-relevant content is equal.
// Evidence that worktree Y listed at commit C before time t (store copy and git reflogs, read only):
//   rev: a revision row of Y with head C created before t (a daemon recorded it);
//   res: a clean result of Y recorded at commit C before t (a run, so a listing, happened there);
//   ref: Y's reflog put HEAD at C after Y's registration and before t (no proof a daemon ran then).
// Test-relevant content equal: `git diff --name-only` between the two commits names no path in any stored
// closure list or observed set, no test file, no config, lockfile or squeal.config.json.
// usage: node same-content.mjs <store copy> <git common dir> <copy epoch ms> [hours=72]
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
const [file, gitDir, copyMs, hours = "72"] = process.argv.slice(2);
const db = new DatabaseSync(file, { readOnly: true });
const since = Number(copyMs) - Number(hours) * 3600_000;
const git = (...args) => execFileSync("git", ["--git-dir", gitDir, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });

// Paths whose change can move some key: every stored closure path, every observed path, test files, configs.
const relevant = new Set();
for (const { closure_paths } of db.prepare("select closure_paths from test_files").all()) {
  for (const p of JSON.parse(closure_paths)) relevant.add(typeof p === "string" ? p : p.path);
}
for (const { value } of db.prepare("select value from meta where key like 'observed.%'").all()) {
  try { for (const p of JSON.parse(value)) relevant.add(typeof p === "string" ? p : p.path); } catch {}
}
const isRelevant = (p) => relevant.has(p) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || /(^|\/)(vitest|vite)\.(config|workspace)\./.test(p)
  || /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|squeal\.config\.json|tsconfig[^/]*\.json)$/.test(p);
// One signature per commit: the blob ids of every relevant path in its tree (one ls-tree per commit).
const signatures = new Map();
const signature = (commit) => {
  if (!signatures.has(commit)) {
    let sig;
    try {
      sig = git("ls-tree", "-r", "--full-tree", commit).split("\n").filter(Boolean)
        .map((line) => { const tab = line.indexOf("\t"); return [line.slice(tab + 1), line.slice(0, tab).split(" ")[2]]; })
        .filter(([path]) => isRelevant(path)).map(([path, blob]) => `${path} ${blob}`).join("\n");
    } catch { sig = null; }
    signatures.set(commit, sig);
  }
  return signatures.get(commit);
};
const contentEqual = (a, b) => a === b || (signature(a) !== null && signature(a) === signature(b));

const worktrees = db.prepare("select id, root, is_main, registered_at from worktrees").all();
const reflog = (w) => {
  const path = w.is_main ? join(gitDir, "logs/HEAD") : join(gitDir, "worktrees", basename(w.root), "logs/HEAD");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => {
    const [, to, ...rest] = line.split(" ");
    const m = line.match(/> (\d+) [+-]\d{4}/);
    return { to, at: m ? Number(m[1]) * 1000 : 0 };
  });
};
const headAt = (log, t) => { let h = null; for (const e of log) { if (e.at <= t) h = e.to; else break; } return h ?? log[0]?.to ?? null; };

// Evidence list: { wt, commit, at, kind }
const evidence = [];
for (const r of db.prepare("select worktree_id wt, head AS sha, min(created_at) AS t0 from revisions where head is not null group by worktree_id, head").all()) evidence.push({ wt: r.wt, commit: r.sha, at: r.t0, kind: "rev" });
for (const r of db.prepare("select worktree_id wt, commit_sha AS sha, min(recorded_at) AS t0 from results where dirty = 0 and commit_sha is not null and recorded_at > ? group by worktree_id, commit_sha").all(since - 7 * 86400_000)) evidence.push({ wt: r.wt, commit: r.sha, at: r.t0, kind: "res" });
const logs = new Map(worktrees.map((w) => [w.id, reflog(w)]));
for (const w of worktrees) for (const e of logs.get(w.id)) evidence.push({ wt: w.id, commit: e.to, at: Math.max(e.at, w.registered_at), kind: "ref" });

const rows = [];
for (const w of worktrees.filter((w) => w.registered_at > since && !w.is_main).sort((a, b) => a.registered_at - b.registered_at)) {
  const t = w.registered_at;
  const commit = headAt(logs.get(w.id), t);
  if (commit === null) { rows.push({ wt: w.id.slice(0, 8), commit: null }); continue; }
  const before = evidence.filter((e) => e.wt !== w.id && e.at < t && e.at > since - 86400_000);
  const exact = before.filter((e) => e.commit === commit);
  const exactProven = exact.filter((e) => e.kind !== "ref");
  const equal = before.filter((e) => e.commit !== commit && contentEqual(commit, e.commit));
  const equalProven = equal.filter((e) => e.kind !== "ref");
  const row = {
    wt: w.id.slice(0, 8), at: new Date(t).toISOString().slice(5, 19), commit: commit.slice(0, 9),
    exactProven: exactProven.length > 0, exactAny: exact.length > 0, equalProven: equalProven.length > 0, equalAny: equal.length > 0,
    newestProvenAgoMin: [...exactProven, ...equalProven].length ? Math.round((t - Math.max(...[...exactProven, ...equalProven].map((e) => e.at))) / 60000) : null,
  };
  rows.push(row);
  console.log(JSON.stringify(row));
}
const n = rows.filter((r) => r.commit !== null).length;
const count = (k) => rows.filter((r) => r[k]).length;
const either = (a, b) => rows.filter((r) => r[a] || r[b]).length;
console.log(`starts=${n} exactProven=${count("exactProven")} exact(any evidence)=${count("exactAny")} exactOrEqualProven=${either("exactProven", "equalProven")} exactOrEqual(any)=${either("exactAny", "equalAny")} relevantPaths=${relevant.size}`);
