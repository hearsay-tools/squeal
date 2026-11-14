import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GateReport } from "../../src/core/code/gate/report.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { AT, OVER } from "../code/gate/host-load.js";
import { result } from "../store/helpers.js";
import {
  BASE,
  code,
  edit,
  noEstimate,
  ownHomeAndTmp,
  repo,
  SLOW,
  toldBefore,
  VITEST_WIDTH,
} from "./code-gate-fixture.js";

/*
 * Row 020-57 (#212): the gate's early lines on a change to a shared Vitest
 * setup file, and on a busy host. A `setupFiles` entry runs before each
 * test file, so each completed file measures its functions: no "no-loader"
 * line for it, and one line says the change selects every test file. A
 * global setup runs in Vitest's own process, so its no-loader line is
 * true and stays. Above one one-minute load per CPU, given through the
 * gate's host-load seam (never real load), the estimate is scaled and
 * says so; the verdict and the exit code do not change.
 */

const MARKER = "ran.txt";

/** BASE with a setup file every test file runs, which writes the marker when it loads, and a global setup. */
const SETUP: Readonly<Record<string, string>> = {
  ...BASE,
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\n\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"], setupFiles: ["./vitest.setup.ts"], globalSetup: ["./global-setup.ts"] } });\n`,
  "vitest.setup.ts": `import { writeFileSync } from "node:fs";\nimport { beforeEach } from "vitest";\n\nwriteFileSync(new URL("./${MARKER}", import.meta.url), "ran\\n");\n\nexport function resetEnv(): number {\n  return 0;\n}\n\nbeforeEach(() => {\n  resetEnv();\n});\n`,
  "global-setup.ts": "export default function setup(): void {\n  return;\n}\n",
  "test/other.test.ts": `import { expect, it } from "vitest";\n\nit("adds", () => expect(1 + 1).toBe(2));\n`,
};

const SETUP_EDIT = {
  "vitest.setup.ts": SETUP["vitest.setup.ts"]?.replace("return 0;", "return 1 - 1;") ?? "",
};

/** `squeal code <args>` in `root`: each stderr line, and whether the marker was there when it came. */
const gate = (root: string, args: readonly string[]) => toldBefore(root, args, MARKER);

const states = (report: GateReport) =>
  report.functions.map((f) => [f.path, f.qualifiedName, f.state, f.gap]);

describe("squeal code --base: a setup file change (row 020-57)", () => {
  it(
    "prints no no-loader line for a setupFiles entry, and one line naming the files it selects",
    SLOW,
    async () => {
      ownHomeAndTmp();
      const root = repo(SETUP);
      edit(root, SETUP_EDIT);

      const ran = await gate(root, ["--base", "main", "--json"]);

      expect(ran.before).toEqual([
        "squeal code: Vitest: 2 test files to run (tests 2)",
        "squeal code: global setup runs for: the root project (any selection)",
        "squeal code: every Vitest test file depends on vitest.setup.ts (setupFiles), so all 2 of them are selected; the whole run's time is unknown: no stored duration",
        noEstimate("Vitest", 2).trimEnd(),
      ]);
      expect(ran.lines.some((line) => line.includes("no-loader"))).toBe(false);
      // The verdict as before: each completed file measured the setup function.
      const report = JSON.parse(ran.stdout) as GateReport;
      expect(states(report)).toEqual([["vitest.setup.ts", "resetEnv", "pass", null]]);
      expect(report.verdict).toBe("pass");
      expect(ran.code).toBe(0);
    },
  );

  it(
    "keeps the true no-loader line for a global setup, which no test file's run loads",
    SLOW,
    async () => {
      ownHomeAndTmp();
      const root = repo(SETUP);
      edit(root, {
        "global-setup.ts": "export default function setup(): void {\n  return undefined;\n}\n",
      });

      const ran = await gate(root, ["--base", "main"]);

      expect(ran.before).toContain(
        "squeal code: every Vitest test file depends on global-setup.ts, so all 2 of them are selected; the whole run's time is unknown: no stored duration",
      );
      // The line as `code-gate-prerun.test.ts` pins it; matched here without its runner hint.
      expect(ran.before).toContainEqual(
        expect.stringMatching(
          /^squeal code: no test Squeal runs loads global-setup\.ts: .* Its 1 changed function will read incomplete \(no-loader\)\. /,
        ),
      );
      expect(ran.stdout).toMatch(/^Code gate: incomplete\./);
      expect(ran.code).toBe(3);
    },
  );
});

/** The repository's main store, with `test/math.test.ts`'s file check at `seconds`, at a key of its own. */
function seed(root: string, seconds: number): void {
  const store = openStore(join(root, ".git") as AbsolutePath);
  if (isStoreOpenFailure(store)) throw new Error(store.reason);
  try {
    const check = { kind: "file", project: "", testPath: "test/math.test.ts" } as const;
    store.results.putMany([{ ...result(check, "an-older-key"), durationMs: seconds * 1000 }]);
  } finally {
    store.close();
  }
}

const DOUBLED = "export function double(x: number): number {\n  return x + x;\n}\n";

describe("squeal code --base: the estimate on a busy host (row 020-57)", () => {
  it(
    "at twice the CPU count, scales the estimate, says so, and names the rerun; at the CPU count, does not",
    SLOW,
    async () => {
      ownHomeAndTmp();
      const run = async (load: typeof AT) => {
        const root = repo(BASE);
        seed(root, 41.2);
        edit(root, { "src/math.ts": DOUBLED });
        const ran = await code(root, ["--base", "main", "--timeout", "70", "--json"], {
          hostLoad: () => load,
        });
        const lines = ran.stderr.split("\n").filter((l) => l !== "");
        return { ran, lines, report: JSON.parse(ran.stdout) as GateReport };
      };
      const line = `squeal code: Vitest: 1 test file to run here, up to ${VITEST_WIDTH} at once: about`;

      // At the CPU count: 42 s, which fits; no rerun.
      const at = await run(AT);
      expect(at.lines).toContain(`${line} 42 s from its stored duration`);
      expect(at.report.runs[0]?.estimate).toEqual({
        seconds: 42,
        files: 1,
        known: 1,
        width: VITEST_WIDTH,
      });
      expect(at.report.budget.rerun).toBeUndefined();

      // At twice the CPU count: 84 s, over what is left, so a rerun that fits twice it.
      const over = await run(OVER);
      expect(over.lines).toContainEqual(
        expect.stringMatching(
          new RegExp(
            `^${line} 84 s from its stored duration, scaled by the host's load \\(42 s times 2, its one-minute load per CPU\\), over the \\d+ s left of the budget\\. To fit it: `,
          ),
        ),
      );
      const rerun = over.report.budget.rerun;
      expect(over.lines).toContainEqual(
        expect.stringMatching(
          /^squeal code: about 84 s in all at the host's load, over the \d+ s left of the budget\. A rerun that fits: /,
        ),
      );
      expect(rerun?.seconds).toBeGreaterThanOrEqual(2 * 84);
      expect(over.report.runs[0]?.estimate).toEqual({
        seconds: 84,
        files: 1,
        known: 1,
        width: VITEST_WIDTH,
        load: { perCpu: 2, unscaled: 42 },
      });
      // The verdict and the exit code do not change.
      for (const { ran, report } of [at, over]) {
        expect(report.verdict).toBe("pass");
        expect(ran.code).toBe(0);
      }
    },
  );
});
