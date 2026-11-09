// Throwaway (row 018-08): per Vitest project, the D5 import counts of one clone's worktree,
// computed by Squeal 0.1.418's own `readImports` on that project's key rows and states only,
// plus each project's files by class and origin. Reads the clone's own store; writes nothing.
// Run from a `git archive squeal--v0.1.418 src` tree with node_modules linked:
//   node_modules/.bin/tsx <this file> <clone root>
import { resolve } from "node:path";
import { resolveCommonDir, worktreeIdFor } from "./src/core/fs/git-layout.js";
import { readImports } from "./src/core/status/imports.js";
import { isStoreOpenFailure, openStore } from "./src/core/store/open.js";
import type { AbsolutePath } from "./src/core/types/common.js";

const root = resolve(process.argv[2] ?? ".") as AbsolutePath;
const commonDir = resolveCommonDir(root);
if (commonDir === null) throw new Error(`no git dir for ${root}`);
const store = openStore(commonDir, { create: false, busyTimeoutMs: 5_000 });
if (isStoreOpenFailure(store)) throw new Error(`store: ${store.reason}`);
const id = worktreeIdFor(root);
const keys = store.testFileKeys.list(id);
const states = store.knownStates.list(id);
const projects = [...new Set(keys.map((k) => k.testFile.project))].sort();
const out: Record<string, unknown> = {};
for (const project of projects) {
  const pk = keys.filter((k) => k.testFile.project === project);
  const ps = states.filter((s) => s.check.project === project);
  const byFile = new Map<string, typeof ps>();
  for (const s of ps) {
    if (s.check.kind === "setup") continue;
    const f = s.check.testPath;
    byFile.set(f, [...(byFile.get(f) ?? []), s]);
  }
  const classes = { current: 0, noState: 0, notCurrent: 0, keyNull: 0 };
  const origins: Record<string, number> = {};
  for (const k of pk) {
    if (k.key === null) classes.keyNull++;
    const list = byFile.get(k.testFile.path) ?? [];
    if (list.length === 0) classes.noState++;
    else if (list.every((s) => s.validity === "current")) {
      classes.current++;
      const kinds = [...new Set(list.map((s) => s.origin?.kind ?? "none"))].sort().join("+");
      origins[kinds] = (origins[kinds] ?? 0) + 1;
    } else classes.notCurrent++;
  }
  const imports = readImports(store, id, pk, ps).map((i) => ({
    source: i.source,
    testFiles: i.testFiles,
    currentFiles: i.currentFiles,
    notCurrent: i.notCurrent,
    environmentDifferences: i.environmentDifferences,
  }));
  out[project || "(default)"] = { listed: pk.length, classes, currentByOrigin: origins, imports };
}
const all = readImports(store, id, keys, states);
console.log(JSON.stringify({ root, worktreeId: id, listed: keys.length, perProject: out, all }, null, 2));
store.close();
