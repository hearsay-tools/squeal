// Throwaway source-level probe. No runner, daemon, real store or test execution.
import assert from "node:assert/strict";
import { relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { selectNarrow } from "../../../../../../src/core/scheduler/narrow-run.ts";
import { selectNamedFiles, worktreePath } from "../../../../../../src/cli/named-selection.ts";
import { DEFAULT_POLICY } from "../../../../../../src/core/types/policy.ts";
import { testFileId } from "../../../../../../src/core/keys/reverse-index.ts";

const root = process.cwd();
const folder = relative(root, dirname(fileURLToPath(import.meta.url)));
const refs = ["a.parity.test.ts", "b.parity.test.ts"].map((name) => ({
  project: "fixture", path: `${folder}/${name}`,
}));
const policy = { ...DEFAULT_POLICY, checks: [
  { name: "run-loop", runner: "vitest", tests: [`${folder}/**`], at: "pause" },
] };
const calls = [];
const context = {
  policy,
  runner: { affected: async (paths) => {
    calls.push(paths);
    return { direct: [], transitive: [] };
  } },
  keys: { index: { reverse: { referencing: () => [] } } },
  wakes: {
    slot: () => ({ after() {}, drop() {} }),
    waitFor: (_reason, promise) => promise,
  },
  note: (message) => { throw new Error(message); },
};
const ledger = {
  files: new Map(refs.map((ref) => [testFileId(ref), { id: testFileId(ref), ref }])),
  recentOf: () => new Set(),
};
const store = {
  testFileKeys: { list: () => refs.map((testFile) => ({ testFile })) },
  revisions: { latest: () => null },
  meta: { get: () => null },
};
const compact = (selection) => ({
  selected: [...selection.selected].map(([group, ids]) => ({ group, count: ids.size })),
  unmatched: selection.unmatched,
});
const path = worktreePath(root, root, `${folder}/`);
const narrowFolder = await selectNarrow(context, ledger, [path]);
const namedFolder = selectNamedFiles(store, "fixture", root, root, [`${folder}/`]);
const narrowFiles = await selectNarrow(context, ledger, refs.map((ref) => ref.path));
assert.equal(narrowFolder.selected.size, 0);
assert.deepEqual(narrowFolder.unmatched, [folder]);
assert.equal(namedFolder.files.length, 2);
assert.equal(namedFolder.paths[0].kind, "directory");
assert.equal(narrowFiles.selected.get("run-loop").size, 2);
console.log(JSON.stringify({
  narrowFolder: compact(narrowFolder),
  statusFolder: namedFolder.paths,
  narrowFiles: compact(narrowFiles),
  runnerAffectedCalls: calls,
}, null, 2));
