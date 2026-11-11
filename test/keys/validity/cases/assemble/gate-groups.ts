import type { Case } from "../../case.js";

/*
 * Spec 020 D14.1 (row 020-15a, its case from row 020-15a+16b I):
 * `gate.groups` names the check groups whose test files only
 * `squeal code --base` runs; the daemon has no scope (D14.6), so it is in no
 * key. The last release reads `gate` as an unknown key; this tree checks
 * its type. A repository that sets it keys as one that does not. The two
 * cases reach both sides of the key's check: a list of names, a group that
 * does not exist among them (the gate's problem, not the loader's), and a
 * value of the wrong type, left out with one problem.
 */

const FAST = "test/fast.test.ts";
const E2E = "test/e2e/app.test.ts";

const CHECKS = [{ name: "e2e", runner: "vitest", tests: ["test/e2e/**"], at: "manual" }];

const files = (groups: unknown) => ({
  "squeal.config.json": `${JSON.stringify({ checks: CHECKS, gate: { groups } })}\n`,
  "src/app.ts": "export const app = 1;\n",
  [FAST]: "import '../src/app';\n",
  [E2E]: "import '../../src/app';\n",
});

const closures = [
  { path: FAST, imports: ["src/app.ts"] },
  { path: E2E, imports: ["src/app.ts"] },
];

const WHY =
  "020-15a: the gate's scope is in no key, so the keys equal the last release's, which reads gate as an unknown key";

export const GATE_GROUPS: readonly Case[] = [
  {
    kind: "assemble",
    name: "a repository whose gate.groups lists check groups",
    why: WHY,
    input: { files: files(["tests", "e2e", "nowhere"]), closures },
  },
  {
    kind: "assemble",
    name: "a repository whose gate.groups has the wrong type",
    why: WHY,
    input: { files: files("tests"), closures },
  },
];
