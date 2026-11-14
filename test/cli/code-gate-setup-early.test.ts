import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GateReport } from "../../src/core/code/gate/report.js";
import type { HostLoad } from "../../src/core/retry/load.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { QUIET } from "../code/gate/host-load.js";
import { result } from "../store/helpers.js";
import { code, edit, ownHomeAndTmp, repo, SLOW } from "./code-gate-fixture.js";

/*
 * Row 020-57 R1 (review 0.1.483 B1): a changed `setupFiles` entry has a
 * loader only when a file of its project still runs after the early stop,
 * or a record read from the stores measured it. Twenty test files, one at
 * a time, each stored at 20 s: 400 s fits the 600 s budget on a free host.
 * At four times the CPU count (through the gate's host-load seam, never
 * real load) it is 1600 s, at least twice what is left, so the gate stops
 * early before every file, none of which loads a changed function's path.
 */

const FILES = Array.from({ length: 20 }, (_, i) => `test/f${i}.test.ts`);

const SETUP_FILE = (body: string) =>
  `import { beforeEach } from "vitest";\n\nexport function resetEnv(): number {\n  return ${body};\n}\n\nbeforeEach(() => {\n  resetEnv();\n});\n`;

const FIXTURE: Readonly<Record<string, string>> = {
  "package.json": `${JSON.stringify({ name: "gate-setup-early", private: true, type: "module" })}\n`,
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\n\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"], maxWorkers: 1, setupFiles: ["./vitest.setup.ts"] } });\n`,
  "vitest.setup.ts": SETUP_FILE("0"),
  ...Object.fromEntries(
    FILES.map((path) => [
      path,
      `import { expect, it } from "vitest";\n\nit("ok", () => expect(1).toBe(1));\n`,
    ]),
  ),
};

/** Four times the CPU count: the 400 s estimate becomes 1600 s. */
const BUSY: HostLoad = { oneMinute: 96, cpus: 24 };

/** The fixture with only the setup file's function edited, every test file stored at 20 s at an older key. */
function setupEdited(): string {
  const root = repo(FIXTURE);
  const store = openStore(join(root, ".git") as AbsolutePath);
  if (isStoreOpenFailure(store)) throw new Error(store.reason);
  try {
    const checks = FILES.map((testPath) => ({ kind: "file", project: "", testPath }) as const);
    store.results.putMany(
      checks.map((c) => ({ ...result(c, "an-older-key"), durationMs: 20_000 })),
    );
  } finally {
    store.close();
  }
  edit(root, { "vitest.setup.ts": SETUP_FILE("1 - 1") });
  return root;
}

/** `squeal code --base main --json` in `root` at `load`, with `test` given to `--test`. */
async function gate(root: string, load: HostLoad, test?: string) {
  const argv =
    test === undefined
      ? ["--base", "main", "--timeout", "600", "--json"]
      : ["--base", "main", "--test", test, "--timeout", "600", "--json"];
  const ran = await code(root, argv, { hostLoad: () => load });
  const report = JSON.parse(ran.stdout) as GateReport;
  const lines = ran.stderr.split("\n").filter((line) => line !== "");
  const noLoader = lines.filter((line) =>
    line.startsWith("squeal code: no test Squeal runs loads vitest.setup.ts:"),
  );
  const fn = report.functions.find((f) => f.qualifiedName === "resetEnv");
  return { ran, report, lines, noLoader, state: [fn?.state, fn?.gap], run: report.runs[0] };
}

const STOPS_EARLY =
  /^squeal code: about 1600 s in all at the host's load, at least twice the \d+ s left of the budget, so the gate stops early: /;

describe("squeal code --base: a setup file change the early stop leaves unmeasured (row 020-57 R1)", () => {
  it(
    "keeps the true no-loader line when the early stop runs no file and none is read",
    SLOW,
    async () => {
      ownHomeAndTmp();
      const busy = await gate(setupEdited(), BUSY);

      expect(busy.lines).toContainEqual(expect.stringMatching(STOPS_EARLY));
      expect(busy.noLoader).toHaveLength(1);
      expect(busy.noLoader[0]).toContain(
        "Its 1 changed function will read incomplete (no-loader).",
      );
      // The selection line still counts every selected file.
      expect(busy.lines).toContainEqual(
        expect.stringMatching(
          /^squeal code: every Vitest test file depends on vitest\.setup\.ts \(setupFiles\), so all 20 of them are selected; the whole run takes about 1600 s at the host's load, over the \d+ s left of the budget$/,
        ),
      );
      expect(busy.run?.completed).toEqual([]);
      expect(busy.run?.overBudget).toHaveLength(20);
      expect(busy.state).toEqual(["incomplete", "no-loader"]);
      expect([busy.report.verdict, busy.ran.code]).toEqual(["incomplete", 3]);
    },
  );

  it("drops it when a --test file of the project still runs", SLOW, async () => {
    ownHomeAndTmp();
    const kept = await gate(setupEdited(), BUSY, "test/f0.test.ts");

    expect(kept.lines).toContainEqual(expect.stringMatching(STOPS_EARLY));
    expect(kept.noLoader).toEqual([]);
    expect(kept.run?.completed).toEqual(["test/f0.test.ts"]);
    expect(kept.state).toEqual(["pass", null]);
    // The other 19 did not run: the verdict stays incomplete, as the early stop's rule says.
    expect([kept.report.verdict, kept.ran.code]).toEqual(["incomplete", 3]);
  });

  it("drops it when the stores' records measured it, though nothing runs", SLOW, async () => {
    ownHomeAndTmp();
    const root = setupEdited();
    // On a free host every file runs, and the gate keeps each one at its key (D17.3).
    const free = await gate(root, QUIET);
    expect(free.noLoader).toEqual([]);
    expect(free.run?.completed).toHaveLength(20);
    expect([free.report.verdict, free.ran.code]).toEqual(["pass", 0]);

    const reused = await gate(root, BUSY);

    expect(Object.values(reused.run?.from ?? {})).toEqual(FILES.map(() => "store"));
    expect(reused.noLoader).toEqual([]);
    expect(reused.state).toEqual(["pass", null]);
    expect([reused.report.verdict, reused.ran.code]).toEqual(["pass", 0]);
  });
});
