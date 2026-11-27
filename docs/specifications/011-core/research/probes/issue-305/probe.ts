// Throwaway synthetic probe. No daemon, test runner, store, files or HOME changes.
import assert from "node:assert/strict";
import { selectNarrow } from "../../../../../../src/core/scheduler/narrow-run.js";
import { narrowAnswer } from "../../../../../../src/cli/run-group-narrow.js";
import { groupView } from "../../../../../../src/core/scheduler/slow.js";
import { DEFAULT_POLICY } from "../../../../../../src/core/types/policy.js";
import { testFileId } from "../../../../../../src/core/keys/reverse-index.js";

const path = "packages/web/src/components/page-shell/page-shell.test.tsx";
let affectedCalls = 0;
const context = {
  policy: DEFAULT_POLICY,
  runner: { affected: async () => { affectedCalls++; return { direct: [], transitive: [] }; } },
  keys: { index: { reverse: { referencing: () => [] } } },
  wakes: {
    slot: () => ({ after() {}, drop() {} }),
    waitFor: (_reason: unknown, promise: Promise<unknown>) => promise,
  },
  note: (message: string) => { throw new Error(message); },
};
const files = new Map();
const ledger = { files, recentOf: () => new Set() };
const missing = await selectNarrow(context as never, ledger as never, [path] as never);
assert.deepEqual(missing.unmatched, [path]);
assert.equal(missing.selected.size, 0);
console.log(JSON.stringify({ inventory: "missing", selected: missing.selected.size,
  unmatched: missing.unmatched, affectedCalls }));

const output: string[] = [];
const group = groupView(DEFAULT_POLICY).groups.find((entry) => entry.name === "tests")!;
const code = await narrowAnswer({ taken: {
  root: "/synthetic", socketPath: "/synthetic.sock", deadline: Date.now() + 30_000,
  requested: { revision: 1, queued: 0 },
  narrow: { selected: [], current: 0, notRun: [], reached: 0, others: [], unmatched: missing.unmatched },
  files: { kind: "list", files: [] }, covered: null,
} } as never, { group, waitMs: 30_000, base: null }, {
  stdout: (text: string) => output.push(text), stderr: (text: string) => { throw new Error(text); },
} as never);
assert.equal(code, 3);
assert.match(output.join(""), /selects no test file of any group/);
console.log(JSON.stringify({ waitMs: 30_000, code, output: output.join("") }));

const ref = { project: "web", path };
files.set(testFileId(ref as never), { id: testFileId(ref as never), ref });
const listed = await selectNarrow(context as never, ledger as never, [path] as never);
assert.deepEqual(listed.unmatched, []);
assert.equal(listed.selected.get("tests")?.size, 1);
assert.equal(affectedCalls, 1);
console.log(JSON.stringify({ inventory: "listed", selected: listed.selected.get("tests")?.size,
  unmatched: listed.unmatched, affectedCalls }));
