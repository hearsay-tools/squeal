// Task 001-105 measurement, not product code. After a Squeal daemon validated worktree <a> and
// another bootstrapped worktree <b> of the same repository, counts the test files whose key <b>
// shares with <a>, and how many of them reach `child_process` per <closures.json>, written by
// `measure-cezar.mts`. Run from the Squeal worktree root:
//   npx tsx docs/specifications/001-core-loop/tasks/001-105/compare-worktrees.mts <a> <b> <closures.json>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { worktreeIdFor } from "../../../../../src/core/fs/index.js";
import { isStoreOpenFailure, openStore } from "../../../../../src/core/store/index.js";
import type { RunnerClosure } from "../../../../../src/core/types/index.js";

const [a, b, closuresFile] = process.argv.slice(2);
if (a === undefined || b === undefined || closuresFile === undefined) throw new Error("usage: <a> <b> <closures.json>");
const store = openStore(join(a, ".git"), { busyTimeoutMs: 10_000 });
if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
const keysOf = (root: string) =>
  new Map(store.testFileKeys.list(worktreeIdFor(root)).map((row) => [`${row.testFile.project}:${row.testFile.path}`, row]));
const first = keysOf(a);
const second = keysOf(b);
const { closures } = JSON.parse(readFileSync(closuresFile, "utf8")) as { closures: RunnerClosure[] };
const childProcess = new Set(
  closures.filter((c) => c.packages?.builtins.includes("child_process")).map((c) => `${c.testFile.project}:${c.testFile.path}`),
);
const kept = [...second].filter(([id, row]) => row.key !== null && first.get(id)?.key === row.key).map(([id]) => id);
console.log(
  JSON.stringify(
    {
      filesA: first.size,
      filesB: second.size,
      keyedB: [...second.values()].filter((row) => row.key !== null).length,
      kept: kept.length,
      keptReachingChildProcess: kept.filter((id) => childProcess.has(id)).length,
      pendingB: [...second.values()].filter((row) => row.pending !== null).length,
    },
    null,
    2,
  ),
);
store.close();
