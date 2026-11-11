import { describe, expect, it } from "vitest";
import type { GateReport } from "../../src/core/code/gate/report.js";
import {
  BASE,
  edit,
  noEstimate,
  ownHomeAndTmp,
  repo,
  SLOW,
  toldBefore,
} from "./code-gate-fixture.js";

/*
 * Spec 020 D14.4 (row 020-15b, which carries 020-16a): `squeal code --base`
 * tells its selection on stderr after selection and before the first run.
 * Each fixture's first setup or test writes a marker file, so a line told
 * while the marker is absent was told before any setup or test ran.
 */

const MARKER = "ran.txt";

const MARK = 'import { writeFileSync } from "node:fs";\n';
const markAt = (from: string) =>
  `writeFileSync(new URL("${from}${MARKER}", import.meta.url), "ran\\n");\n`;

/** `squeal code <args>` in `root`: each stderr line, and whether the marker was there when it came. */
const gate = (root: string, args: readonly string[]) => toldBefore(root, args, MARKER);

/** BASE with a root global setup beside two projects, and a `browser` group manual at the base. */
const PROJECTS: Readonly<Record<string, string>> = {
  ...BASE,
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\n\nexport default defineConfig({\n  test: {\n    globalSetup: ["./setup/root.ts"],\n    projects: [\n      { test: { name: "server", include: ["test/**/*.test.ts"] } },\n      { test: { name: "browser", include: ["e2e/**/*.test.ts"], globalSetup: ["./setup/browser.ts"] } },\n    ],\n  },\n});\n`,
  "setup/root.ts": `${MARK}\nexport default function setup() {\n  ${markAt("../")}}\n`,
  "setup/browser.ts": `${MARK}\nexport default function setup() {\n  ${markAt("../")}}\n`,
  "e2e/helper.ts": `import { double } from "../src/math";\n\nexport const four = () => double(2);\n`,
  "e2e/page.test.ts": `import { expect, it } from "vitest";\nimport { four } from "./helper";\n\nit("shows four", () => expect(four()).toBe(4));\n`,
  "squeal.config.json": `${JSON.stringify({ checks: [{ name: "browser", runner: "vitest", project: "browser", at: "manual" }] })}\n`,
};

const DOUBLED = "export function double(x: number): number {\n  return x + x;\n}\n";

/** A node:test project: `unit` lists `test/unit`; `test/e2e/x.test.mjs` holds a helper no runner lists. */
function nodeTest(config: Record<string, unknown>): Record<string, string> {
  return {
    "package.json": `${JSON.stringify({ name: "gate-prerun", private: true, type: "module" })}\n`,
    "squeal.config.json": `${JSON.stringify({ nodeTest: [{ name: "unit", include: ["test/unit/*.test.mjs"] }], ...config })}\n`,
    "src/a.mjs": "export function inc(n) {\n  return n + 1;\n}\n",
    "test/unit/a.test.mjs": `import test from "node:test";\nimport assert from "node:assert/strict";\n${MARK}import { inc } from "../../src/a.mjs";\n\n${markAt("../../")}\ntest("inc", () => assert.equal(inc(1), 2));\n`,
    "test/e2e/x.test.mjs": `import test from "node:test";\n\nexport function verify(name) {\n  return name.length > 0;\n}\n\ntest("verifies", () => verify("x"));\n`,
  };
}

/** The head's edits: both functions. */
const NODE_EDITS = {
  "src/a.mjs": "export function inc(n) {\n  return 1 + n;\n}\n",
  "test/e2e/x.test.mjs": `import test from "node:test";\n\nexport function verify(name) {\n  return name !== "";\n}\n\ntest("verifies", () => verify("x"));\n`,
};

const UNLOADED =
  "squeal code: no test Squeal runs loads test/e2e/x.test.mjs: no Vitest or node:test project lists it, and no listed test file imports it. Its 1 changed function will read incomplete (no-loader). To measure it, give it to a runner (a nodeTest entry, with prepare when it needs a build); to skip its coverage, name it in coverage.exclude at the base.";

describe("squeal code --base: the selection before the first run (spec 020 D14.4)", () => {
  it(
    "tells the files to run, the left-out group and the root's global setup before it runs",
    SLOW,
    async () => {
      ownHomeAndTmp();
      const root = repo(PROJECTS);
      edit(root, { "src/math.ts": DOUBLED });

      const ran = await gate(root, ["--base", "main", "--json"]);

      expect(ran.code).toBe(0);
      expect(ran.marked).toBe(true);
      expect(ran.before).toEqual([
        "squeal code: Vitest: 1 test file to run (tests 1)",
        "squeal code: browser (manual) is left out: 1 of its 1 test file loads changed code; add --group browser to run it",
        "squeal code: global setup runs for: the root project (any selection)",
        // D17.1: no store, so the time is unknown.
        noEstimate("Vitest", 1).trimEnd(),
      ]);
      expect(ran.lines).toEqual(ran.before);
      const report = JSON.parse(ran.stdout) as GateReport;
      expect(report.runs.flatMap((r) => r.completed)).toEqual(["test/math.test.ts"]);
    },
  );

  it(
    "names a changed path no runner can load, with the ways out, before any run (020-16a)",
    SLOW,
    async () => {
      ownHomeAndTmp();
      const root = repo(nodeTest({}));
      edit(root, NODE_EDITS);

      const ran = await gate(root, ["--base", "main"]);

      expect(ran.code).toBe(3);
      expect(ran.marked).toBe(true);
      // node:test has no global setup: no setup line, and no error.
      expect(ran.before).toEqual([
        "squeal code: node:test: 1 test file to run (tests 1)",
        UNLOADED,
        noEstimate("node:test", 1).trimEnd(),
      ]);
      expect(ran.stdout).toContain(
        "  test/e2e/x.test.mjs:3  verify  CC 1: incomplete: no test Squeal runs loads its file\n",
      );
    },
  );

  it("names no path coverage.exclude matches at the base", SLOW, async () => {
    ownHomeAndTmp();
    const root = repo(nodeTest({ coverage: { exclude: ["test/e2e/**"] } }));
    edit(root, NODE_EDITS);

    const ran = await gate(root, ["--base", "main"]);

    expect(ran.code).toBe(0);
    expect(ran.lines).toEqual([
      "squeal code: node:test: 1 test file to run (tests 1)",
      noEstimate("node:test", 1).trimEnd(),
    ]);
  });
});
