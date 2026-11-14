import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GateReport } from "../../src/core/code/gate/report.js";
import { BASE, code, edit, ownHomeAndTmp, repo, SLOW, toldBefore } from "./code-gate-fixture.js";

/*
 * Review 0.1.495 B2 (row 020-60, spec 020 D14.4): with
 * `--rerun-stored-failures`, a stored failure runs once more, so the
 * selection told before the first run counts it with the files to run,
 * names it apart, and names the global setups it starts: its project's
 * and the root's. It stays out of the estimate (D3.4). Each global setup
 * appends its name to `setup-runs.txt`, so a line told while that file is
 * absent was told before any setup ran. The fixtures pin the host's load
 * quiet, so no rerun under load mixes in.
 */

const SETUPS = "setup-runs.txt";

const setup = (name: string) =>
  `import { appendFileSync } from "node:fs";\n\nexport default function setup() {\n  appendFileSync(new URL("../${SETUPS}", import.meta.url), "${name}\\n");\n}\n`;

/** Two projects with a global setup each, beside the root's: `browser`'s one test always fails. */
const PROJECTS: Readonly<Record<string, string>> = {
  ...BASE,
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\n\nexport default defineConfig({\n  test: {\n    globalSetup: ["./setup/root.ts"],\n    projects: [\n      { test: { name: "server", include: ["test/**/*.test.ts"] } },\n      { test: { name: "browser", include: ["e2e/**/*.test.ts"], globalSetup: ["./setup/browser.ts"] } },\n    ],\n  },\n});\n`,
  "setup/root.ts": setup("root"),
  "setup/browser.ts": setup("browser"),
  "test/other.test.ts": `import { expect, it } from "vitest";\nimport { double } from "../src/math";\n\nit("doubles three", () => expect(double(3)).toBe(6));\n`,
  "e2e/page.test.ts": `import { expect, it } from "vitest";\nimport { double } from "../src/math";\n\nit("shows five", () => expect(double(2)).toBe(5));\n`,
};

const DOUBLED = "export function double(x: number): number {\n  return x + x;\n}\n";

const SETUP_LINE = "squeal code: global setup runs for: the root project (any selection), browser";

/** The fixture with `double` changed, after a first gate stored every file: the `browser` one failed. */
async function storedOnce(): Promise<string> {
  ownHomeAndTmp();
  const root = repo(PROJECTS);
  edit(root, { "src/math.ts": DOUBLED });
  const first = await code(root, ["--base", "main", "--json"]);
  expect(first.code).toBe(3);
  rmSync(join(root, SETUPS), { force: true });
  return root;
}

/** The gate with the flag: its stderr lines, those before any setup, and its report. */
async function rerun(root: string) {
  const ran = await toldBefore(
    root,
    ["--base", "main", "--json", "--rerun-stored-failures"],
    SETUPS,
  );
  const report = JSON.parse(ran.stdout) as GateReport;
  const vitest = report.runs.find((r) => r.runner === "vitest");
  const setups = readFileSync(join(root, SETUPS), "utf8").split("\n").filter(Boolean).sort();
  return { ...ran, vitest, setups };
}

describe("squeal code --base --rerun-stored-failures: the selection before the run (review 0.1.495 B2)", () => {
  it("counts a stored-only rerun as a file to run, and names its global setups", SLOW, async () => {
    const root = await storedOnce();

    const ran = await rerun(root);

    expect(ran.vitest?.storedRerun).toEqual({ "e2e/page.test.ts": { outcome: "failed" } });
    expect(ran.vitest?.completed).toContain("e2e/page.test.ts");
    expect(ran.setups).toEqual(["browser", "root"]);
    expect(ran.marked).toBe(true);
    expect(ran.before).toEqual([
      "squeal code: Vitest: 3 test files selected (tests 3): 1 to run (1 once more after a stored failure), 2 read from the stores",
      SETUP_LINE,
    ]);
    // D3.4: a stored rerun is outside the estimate, so with no other file to run there is none.
    expect(ran.vitest?.estimate).toBeUndefined();
    expect(ran.lines.some((line) => line.includes("to run here"))).toBe(false);
  });

  it(
    "counts a stored rerun beside an ordinary file; the estimate holds only that file",
    SLOW,
    async () => {
      const root = await storedOnce();
      // A new key for `test/other.test.ts`: it runs as an ordinary first run.
      edit(root, {
        "test/other.test.ts": `import { expect, it } from "vitest";\nimport { double } from "../src/math";\n\nit("doubles four", () => expect(double(4)).toBe(8));\n`,
      });

      const ran = await rerun(root);

      expect(ran.vitest?.from).toEqual({
        "e2e/page.test.ts": "run",
        "test/math.test.ts": "store",
        "test/other.test.ts": "run",
      });
      expect(ran.vitest?.storedRerun).toEqual({ "e2e/page.test.ts": { outcome: "failed" } });
      expect(ran.setups).toEqual(["browser", "root"]);
      expect(ran.before.slice(0, 2)).toEqual([
        "squeal code: Vitest: 3 test files selected (tests 3): 2 to run (1 once more after a stored failure), 1 read from the stores",
        SETUP_LINE,
      ]);
      expect(ran.vitest?.estimate?.files).toBe(1);
      expect(ran.before.filter((line) => line.includes("to run here"))).toEqual([
        expect.stringMatching(/^squeal code: Vitest: 1 test file to run here/),
      ]);
    },
  );

  it(
    "without the flag, a stored failure is read, as before: none to run, no setup",
    SLOW,
    async () => {
      const root = await storedOnce();

      const ran = await toldBefore(root, ["--base", "main", "--json"], SETUPS);

      expect(ran.marked).toBe(false);
      expect(ran.lines[0]).toBe(
        "squeal code: Vitest: 3 test files selected (tests 3): none to run, 3 read from the stores",
      );
      expect(ran.lines.some((line) => line.includes("global setup"))).toBe(false);
    },
  );
});
