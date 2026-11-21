// Throwaway (row 018-72). Squeal's D5 reason per exported file, per worktree, on squawk's
// store opened read-only (query_only): readImports' counts plus the same rule per file.
// Usage: tsx d5.ts <worktreeId>... ; writes JSON lines to stdout.
import { DatabaseSync } from "node:sqlite";
import { Connection } from "../../../../../../src/core/store/connection.ts";
import { createStore } from "../../../../../../src/core/store/store.ts";
import { storePaths } from "../../../../../../src/core/store/paths.ts";
import { readImports } from "../../../../../../src/core/status/imports.ts";
import { importFiles, listImports } from "../../../../../../src/core/store/imports.ts";
import { worktreeEnvironments } from "../../../../../../src/core/store/environments.ts";
import { readSharedEntries, observedMetaKey, observedDirectMetaKey } from "../../../../../../src/core/keys/observed.ts";
import { observedModulesMetaKey } from "../../../../../../src/core/keys/modules.ts";
import { listHash, staticListHash, observedHash, STATIC_LIST, OBSERVED_MAPS } from "../../../../../../src/core/store/transfer-bundle.ts";

const common = `${process.env.HOME}/projects/cezar/.git`;
const db = new DatabaseSync(`${common}/squeal/store.sqlite`, { readOnly: true });
db.exec("PRAGMA query_only = 1");
db.exec("PRAGMA busy_timeout = 5000");
const store = createStore(new Connection(db), 1, storePaths(common as never));
const MAP_KEY = { observed: observedMetaKey, observedDirect: observedDirectMetaKey, observedModules: observedModulesMetaKey } as const;
const entries = new Map<string, Record<string, string[]>>();
const ent = (map: keyof typeof MAP_KEY, project: string) => {
  const k = MAP_KEY[map](project as never);
  if (!entries.has(k)) entries.set(k, readSharedEntries(store, k) as never);
  return entries.get(k)!;
};
const onlyImport = process.env.IMPORT;
for (const w of process.argv.slice(2)) {
  const keys = store.testFileKeys.list(w as never);
  const states = store.knownStates.list(w as never);
  const counts = readImports(store, w as never, keys, states).filter((i) => !onlyImport || i.importId === onlyImport);
  console.log(JSON.stringify({ worktree: w, counts: counts.map(({ importId, commit, testFiles, currentFiles, notCurrent, environmentDifferences }) => ({ importId, commit: commit.slice(0, 8), testFiles, currentFiles, notCurrent, environmentDifferences })) }));
  const byId = new Map(keys.map((k) => [`${k.testFile.project}\0${k.testFile.path}`, k]));
  const env = new Map(worktreeEnvironments(store, w as never).map((e) => [e.project, e.hash]));
  for (const imp of listImports(store)) {
    if (onlyImport && imp.id !== onlyImport) continue;
    if (!counts.some((c) => c.importId === imp.id)) continue;
    for (const f of importFiles(store, imp.id)) {
      const here = byId.get(`${f.project}\0${f.path}`);
      if (!here) continue;
      let reason: string;
      const rec = store.testFiles.get(f as never);
      const closure = rec === null ? null : !f.closure.startsWith(STATIC_LIST) ? listHash(rec.closure.paths) : staticListHash(rec.closure.paths, ent("observed", f.project)[f.path] as never);
      const obs: Record<string, string[]> = {};
      for (const m of OBSERVED_MAPS) { const p = ent(m, f.project)[f.path]; if (p !== undefined) obs[m] = p; }
      if (here.key === f.key) reason = "sameKey";
      else if (env.get(f.project) !== undefined && env.get(f.project) !== f.environment) reason = "environment";
      else if (closure !== null && f.closure !== "" && closure !== f.closure) reason = "closure";
      else if (observedHash(obs as never) !== f.observed) reason = "observed";
      else if (here.key == null) reason = "noKey";
      else reason = "content";
      console.log(JSON.stringify({ w, imp: imp.id, project: f.project, path: f.path, reason, rekeyed: f.environment === env.get(f.project), pending: here.pending ?? null }));
    }
  }
}
