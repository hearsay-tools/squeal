import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { loadPolicy } from "../../src/core/daemon/policy.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function load(runtimeFiles: unknown) {
  const root = mkdtempSync(join(tmpdir(), "sq-runtime-policy-"));
  roots.push(root);
  writeFileSync(join(root, "squeal.config.json"), JSON.stringify({ runtimeFiles }));
  return loadPolicy(root);
}
const rule = { project: "", tests: ["test/**/*.test.ts"], paths: ["./.runtime\\port.json"] };
it("normalizes literal file paths and keeps valid rules beside malformed rules", () => {
  const loaded = load([rule, { ...rule, project: 1 }, { ...rule, typo: [] }]);
  expect(loaded.policy.runtimeFiles).toEqual([{ ...rule, paths: [".runtime/port.json"] }]);
  expect(loaded.problems).toHaveLength(2);
});
it.each([
  "/abs",
  "C:\\abs",
  "../escape",
  "x/../escape",
  "x/",
  "x/*",
  "x/?",
  "x/{a,b}",
  "x/[a]",
  ".git/config",
  "x/node_modules/a",
  "x\0y",
  ".",
])("rejects unsafe exact path %j", (path) => {
  const loaded = load([{ ...rule, paths: [path] }]);
  expect(loaded.policy.runtimeFiles).toEqual([]);
  expect(loaded.problems).toHaveLength(1);
});
it.each([
  { tests: [] },
  { paths: [] },
  { tests: ["!test/**"] },
  { tests: ["["] },
  { project: undefined },
  { paths: undefined },
])("rejects malformed selection %j", (bad) => {
  const loaded = load([{ ...rule, ...bad }]);
  expect(loaded.policy.runtimeFiles).toEqual([]);
  expect(loaded.problems).toHaveLength(1);
});
