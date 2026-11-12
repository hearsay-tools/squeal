// Throwaway probe (row 018-39). Status's own D5 counts (`readImports`) for
// every worktree that ran a daemon after the first import, over a store
// opened read-only (`openReadOnly`: a write would throw). `byKey(key, 0)`
// moves no `last_used_at`.
// Usage (from the repository root): pnpm exec tsx <this file> <git-common-dir>
import { readImports } from "../../../../../../src/core/status/imports.js";
import { Connection } from "../../../../../../src/core/store/connection.js";
import { openReadOnly } from "../../../../../../src/core/store/open.js";
import { storePaths } from "../../../../../../src/core/store/paths.js";
import { SCHEMA_VERSION } from "../../../../../../src/core/store/schema.js";
import { createStore } from "../../../../../../src/core/store/store.js";
import type { AbsolutePath, WorktreeId } from "../../../../../../src/core/types/common.js";

const commonDir = process.argv[2] as AbsolutePath;
const paths = storePaths(commonDir);
const db = openReadOnly(paths.database, SCHEMA_VERSION);
if (db === null || db === "missing") throw new Error(`no readable store: ${String(db)}`);
const store = createStore(new Connection(db), SCHEMA_VERSION, paths);
const FIRST_IMPORT = Date.parse("2026-11-10T21:49:00Z");
const total: Record<string, number> = {};
const newestTotal: Record<string, number> = {};
const bestTotal: Record<string, number> = {};
const add = (t: Record<string, number>, k: string, n: number) => {
  t[k] = (t[k] ?? 0) + n;
};
for (const w of store.worktrees.list()) {
  const hb = w.daemon?.heartbeatAt ?? w.lastHeartbeatAt ?? 0;
  if (hb < FIRST_IMPORT) continue;
  const id = w.id as WorktreeId;
  const imports = readImports(store, id, store.testFileKeys.list(id), store.knownStates.list(id));
  if (imports.length === 0) {
    console.log(`${id.slice(0, 8)}\tno import lists a file of this worktree`);
    continue;
  }
  // Per worktree: the newest import (what default status speaks of) and the
  // best one (most files current here).
  const newest = imports[0]!;
  const best = [...imports].sort((a, b) => b.currentFiles - a.currentFiles)[0]!;
  const fmt = (i: (typeof imports)[number]) =>
    `${i.commit.slice(0, 8)} current ${i.currentFiles}/${i.testFiles} ` +
    Object.entries(i.notCurrent)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k} ${n}`)
      .join(", ");
  console.log(`${id.slice(0, 8)}\tnewest: ${fmt(newest)}\n\t\tbest:   ${fmt(best)}`);
  add(bestTotal, "testFiles", best.testFiles);
  add(bestTotal, "current", best.currentFiles);
  for (const [k, n] of Object.entries(best.notCurrent)) add(bestTotal, k, n);
  add(newestTotal, "testFiles", newest.testFiles);
  add(newestTotal, "current", newest.currentFiles);
  for (const [k, n] of Object.entries(newest.notCurrent)) add(newestTotal, k, n);
  for (const i of imports) {
    add(total, "testFiles", i.testFiles);
    add(total, "current", i.currentFiles);
    for (const [k, n] of Object.entries(i.notCurrent)) add(total, k, n);
  }
}
console.log("BEST per worktree, summed:", JSON.stringify(bestTotal));
console.log("NEWEST per worktree, summed:", JSON.stringify(newestTotal));
console.log("ALL imports x worktrees, summed:", JSON.stringify(total));
store.close();
