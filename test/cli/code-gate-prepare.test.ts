import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { GateReport } from "../../src/core/code/gate/report.js";
import { code, edit, ownHomeAndTmp, repo, SLOW } from "./code-gate-fixture.js";

/*
 * Spec 020 D15 (row 020-16b): `squeal code --base` runs a node:test
 * entry's `prepare` as the merge base declares it. The project is the
 * build-wrapper probe's: `test/e2e/bin.test.mjs` holds `verify()`, which
 * starts the built `dist/tool.mjs`. The head edits `verify()`.
 */

const FIXTURE = resolve(import.meta.dirname, "../fixtures/code/gate/prepare");
const E2E = "test/e2e/bin.test.mjs";

/** The fixture's files, by path, with `squeal.config.json` as `config` gives it. */
function files(config: unknown): Record<string, string> {
  const all: Record<string, string> = {};
  for (const path of readdirSync(FIXTURE, { recursive: true, encoding: "utf8" })) {
    const absolute = join(FIXTURE, path);
    if (!/\.(mjs|json)$|\.gitignore$/.test(path)) continue;
    all[relative(FIXTURE, absolute)] = readFileSync(absolute, "utf8");
  }
  return { ...all, "squeal.config.json": `${JSON.stringify(config, null, 2)}\n` };
}

const BUILD = { command: ["node", "scripts/build.mjs"] };
const config = (prepare?: unknown) => ({
  nodeTest: [
    { name: "unit", include: ["test/unit/*.test.mjs"] },
    {
      name: "package",
      include: ["test/e2e/*.test.mjs"],
      ...(prepare === undefined ? {} : { prepare }),
    },
  ],
});

/** The head's edit of `verify()`: one more branch. */
function editVerify(root: string): void {
  const text = readFileSync(join(root, E2E), "utf8").replace(
    "  if (rebrand) assert.match",
    '  if (name === "") throw new Error("empty");\n  if (rebrand) assert.match',
  );
  edit(root, { [E2E]: text });
}

describe("squeal code --base with a node:test entry's prepare (spec 020 D15)", () => {
  it(
    "runs the base's prepare, not the head's, and measures the helper behind the build",
    SLOW,
    async () => {
      const leftInTmp = ownHomeAndTmp();
      const root = repo(files(config(BUILD)));
      editVerify(root);
      // The branch changes the command; the base's still runs.
      edit(root, {
        "squeal.config.json": JSON.stringify(
          config({ command: ["node", "-e", "process.exit(7)"] }),
        ),
      });
      const ran = await code(root, ["--base", "main", "--json"]);
      expect(ran.stderr).toContain(
        'squeal code: node:test entry "package": prepare: node scripts/build.mjs\n',
      );
      expect(ran.code).toBe(0);
      const report = JSON.parse(ran.stdout) as GateReport;
      expect(report.versions.qualityPolicy).toBe(4);
      // The test callback did not change: `verify` alone is judged (D2).
      expect(report.functions.map((f) => [f.qualifiedName, f.state])).toEqual([["verify", "pass"]]);
      const run = report.runs.find((r) => r.runner === "node-test");
      expect(run?.completed).toEqual([E2E]);
      expect(run?.prepare).toEqual([
        {
          project: "package",
          command: ["node", "scripts/build.mjs"],
          outcome: "passed",
          exit: 0,
          durationMs: expect.any(Number),
          notRun: [],
        },
      ]);
      expect(leftInTmp()).toEqual([]);
    },
  );

  it(
    "does not run a prepare only the head declares: the files read not-prepared, with the note",
    SLOW,
    async () => {
      ownHomeAndTmp();
      const root = repo(files(config()));
      editVerify(root);
      edit(root, { "squeal.config.json": JSON.stringify(config(BUILD)) });
      const ran = await code(root, ["--base", "main"]);
      expect(ran.code).toBe(3);
      expect(ran.stderr).toContain(
        'squeal code: node:test entry "package" declares a prepare command that the base does not, so it does not run and its 1 selected test file does not run. Land the declaration on the base branch first',
      );
      const lines = ran.stdout.split("\n");
      expect(lines[0]).toMatch(/^Code gate: incomplete\. 1 changed function .*: 1 incomplete\.$/);
      expect(lines).toContain(
        '  node:test entry "package": prepare is declared only at the head, so it did not run; land the declaration on the base branch first: 1 test file did not run',
      );
      expect(
        lines.filter((l) => l.includes("incomplete: a test file that loads it did not run")),
      ).toHaveLength(1);
      // Nothing ran it: no build.
      expect(readdirSync(root)).not.toContain("dist");
    },
  );
});
