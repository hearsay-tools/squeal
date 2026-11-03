import type { Case } from "../../case.js";

/*
 * Spec 019 D1, D4 step 3 (row 019-07): `checks` and `stop.maxHolds` decide
 * when a check runs, never what its key is, so a repository that sets them
 * keys as one that does not. The last release reads both as unknown keys
 * and applies neither; this tree loads them, and nothing reads them yet.
 * The groups reach each rule of the loader: a full test group, lint groups
 * by name and all, and one group for each way a group is left out.
 */

const FAST = "test/fast.test.ts";
const SLOW = "test/slow/app.test.ts";

const CHECKS = [
  {
    name: "unit",
    runner: "vitest",
    tests: ["test/**"],
    at: "edit",
    quietMs: 0,
    limits: {
      maxParallel: 1,
      maxWorkers: 2,
      priority: "low",
      deferUnderLoad: { maxLoadPerCpu: 1, maxDeferMs: 1_000 },
    },
  },
  { name: "e2e", runner: "vitest", project: "e2e", at: "stop", after: ["unit", "tests"] },
  { name: "lint", lint: ["eslint"], at: "commit", after: ["unit"] },
  { name: "lint-all", lint: true, at: "commit" },
  // Each left out: a project no pytest entry has, an unknown name, a later moment, a cycle.
  { name: "api", runner: "pytest", project: "api", at: "pause" },
  { name: "late", runner: "vitest", at: "edit", after: ["nowhere"] },
  { name: "early", runner: "vitest", at: "edit", after: ["lint-all"] },
  { name: "x", runner: "vitest", at: "edit", after: ["y"] },
  { name: "y", runner: "vitest", at: "edit", after: ["x"] },
  // Each left out by the leaf: a default's name, a repeated name, an unknown runner, not an
  // object, a lint group with a project, no name, an unknown key.
  { name: "slow", runner: "vitest", at: "edit" },
  { name: "unit", runner: "vitest", at: "stop" },
  { name: "bad", runner: "jest", at: "edit" },
  "oops",
  { name: "lp", lint: true, at: "edit", project: "e2e" },
  { runner: "vitest", at: "edit" },
  { name: "uk", runner: "vitest", at: "edit", tset: [] },
];

const files = (policy: Record<string, unknown>) => ({
  "squeal.config.json": `${JSON.stringify({ slow: { include: ["test/slow/**"] }, ...policy })}\n`,
  "src/app.ts": "export const app = 1;\n",
  [SLOW]: "import '../../src/app';\n",
  [FAST]: "import '../src/app';\n",
});

const closures = [
  { path: SLOW, imports: ["src/app.ts"] },
  { path: FAST, imports: ["src/app.ts"] },
];

export const CHECK_GROUPS: readonly Case[] = [
  {
    kind: "assemble",
    name: "a repository with check groups and stop.maxHolds",
    why: "019-07: a group's moment is not in a key, so the keys equal the last release's, which ignores both keys",
    input: { files: files({ checks: CHECKS, stop: { maxHolds: 2 } }), closures },
  },
];
