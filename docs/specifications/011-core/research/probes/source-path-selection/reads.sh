#!/bin/sh
# Throwaway, read-only. What source paths select in this worktree, by the state of the selected
# files, and the 65 test files that import `main` from src/cli/main.ts (which imports start.ts)
# named by their own paths. Prints one line per read.
here=$(cd "$(dirname "$0")" && pwd)
cd "$(git -C "$here" rev-parse --show-toplevel)" || exit 1
read_one() {
  env -u PLUGIN_ROOT -u PLUGIN_DATA timeout 60 squeal status --json "$@" 2>/dev/null | node -e '
const j = JSON.parse(require("fs").readFileSync(0, "utf8"));
const st = {};
for (const f of j.selection.testFiles ?? []) st[f.state] = (st[f.state] ?? 0) + 1;
const p = j.selection.paths;
const named = p.filter((x) => x.kind === "test-file").length;
const src = p.filter((x) => x.kind !== "test-file").map((x) => `${x.path}=${x.selects}`).join(" ");
console.log(`${new Date().toISOString()} rev=${j.revision?.number ?? j.revision} worktree=${JSON.stringify(j.testFileCounts)} named-test-files=${named} ${src} selected-by-state=${JSON.stringify(st)}`);'
}
for p in src/core/types/index.ts src/core/keys/index.ts src/cli/main.ts src/cli/start.ts; do read_one "$p"; done
read_one $(cat "$here/results/main-importers.txt") src/cli/main.ts src/cli/start.ts
