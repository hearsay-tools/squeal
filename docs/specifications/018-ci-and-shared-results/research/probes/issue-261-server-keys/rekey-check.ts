// Throwaway (row 018-72). For exported files matching a regex: is the export's key proven
// (D11), does this store's closure hold every exported path, and which closure reproduces
// the worktree's own key? Reads squawk's store read-only and `git ls-tree` of the commit.
// Usage: tsx rekey-check.ts <export.json> <worktreeId> <path-regex>
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { keyOver, commitSegments, NO_PARTS } from "../../../../../../src/core/store/transfer-rekey.ts";
import { isClosurePath } from "../../../../../../src/core/keys/closure.ts";

const [file, worktree, re] = process.argv.slice(2);
const e = JSON.parse(readFileSync(file, "utf8"));
const repo = `${process.env.HOME}/projects/cezar`;
const db = new DatabaseSync(`${repo}/.git/squeal/store.sqlite`, { readOnly: true });
db.exec("PRAGMA query_only = 1");
const blobs = new Map<string, string>();
for (const line of execFileSync("git", ["-C", repo, "ls-tree", "-r", e.header.commit], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n")) {
  const m = /^\d+ blob ([0-9a-f]+)\t(.*)$/.exec(line);
  if (m) blobs.set(m[2], m[1]);
}
const at = commitSegments(blobs as never);
const envs = new Map(e.environments.map((x: { project: string; hash: string }) => [x.project, x.hash]));
const localEnv = new Map((db.prepare("select project, hash from worktree_environment_hashes where worktree_id = ?").all(worktree) as { project: string; hash: string }[]).map((r) => [r.project, r.hash]));
const meta = (k: string) => { const r = db.prepare("select value from meta where key = ?").get(k) as { value: string } | undefined; return r ? JSON.parse(r.value) : {}; };
const shared: Record<string, Record<string, Record<string, string[]>>> = {};
const of = (map: string, project: string, path: string): string[] => ((shared[`${map}.${project}`] ??= meta(`${map}.${project}`))[path] ?? []);
for (const f of e.testFiles.filter((f: { path: string }) => new RegExp(re).test(f.path))) {
  const ref = { project: f.project, path: f.path };
  const parts = f.keyParts ?? NO_PARTS;
  const proven = keyOver(envs.get(f.project) as never, ref as never, f.closure.paths, at, parts) === f.key;
  const stored: string[] = JSON.parse((db.prepare("select closure_paths c from test_files where project=? and path=?").get(f.project, f.path) as { c: string }).c);
  const local = [...new Set([...stored, ...of("observed", f.project, f.path).filter(isClosurePath)])].sort();
  const withModules = [...new Set([...local, ...of("observedModules", f.project, f.path)])].sort();
  const own = (db.prepare("select key, pending from test_file_keys where worktree_id=? and project=? and path=?").get(worktree, f.project, f.path) as { key: string; pending: string | null } | undefined);
  const env = localEnv.get(f.project) as never;
  const held = new Set(local);
  console.log(JSON.stringify({
    path: f.path, proven, exportedPaths: f.closure.paths.length, localPaths: local.length,
    missingHere: f.closure.paths.filter((p: string) => !held.has(p)).length,
    ownKeyIsLocalClosure: own?.key === keyOver(env, ref as never, local, at, parts),
    ownKeyIsLocalPlusModules: own?.key === keyOver(env, ref as never, withModules, at, parts),
    ownKeyIsExportClosure: own?.key === keyOver(env, ref as never, f.closure.paths, at, parts),
    pending: own?.pending ?? null,
  }));
}
