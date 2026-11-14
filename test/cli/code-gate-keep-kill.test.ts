import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GateReport } from "../../src/core/code/gate/report.js";
import { storePaths } from "../../src/core/store/paths.js";
import { type FixtureRepo, waitFor } from "../daemon/helpers.js";
import { featureRepo, keepPolicy } from "./code-gate-keep-kit.js";

/*
 * Spec 020 D17.5 as amended by row 020-59 (#216): a gate killed mid-run,
 * as a reboot or `kill -9` ends it, keeps the files it wrote while its
 * runs went on, and the next gate reads them from the stores. With
 * `runner.tierSize` 1, node:test runs one process at a time, so a chunk
 * holds `MIN_CHUNK` (8) files: the eight quick files are the first chunk,
 * and `z-late`, which never ends, is the second. The CLI runs from source
 * through tsx, so its own `--json` relaunch is real.
 */

const SLOW = { timeout: 240_000 } as const;

const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const CLI = resolve(import.meta.dirname, "../../src/cli/index.ts");

const QUICK = ["a", "b", "c", "d", "e", "f", "g", "h"].map((n) => `test/${n}.test.mjs`);
const LATE = "test/z-late.test.mjs";

const quick = `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { one } from "../src/keep.mjs";\n\ntest("quick", () => assert.equal(one(1), 1));\n`;
const late = `import { writeFileSync } from "node:fs";\nimport { join } from "node:path";\nimport test from "node:test";\nimport assert from "node:assert/strict";\nimport { one } from "../src/keep.mjs";\n\ntest("late", async () => {\n  writeFileSync(join(process.env.GATE_MARKS ?? "", "late"), "");\n  await new Promise((done) => setTimeout(done, 600_000));\n  assert.equal(one(1), 1);\n});\n`;

const FEATURE: Readonly<Record<string, string>> = {
  "src/keep.mjs": "export const one = (x) => (x > 0 ? 1 : 0);\n",
  ...Object.fromEntries(QUICK.map((path) => [path, quick])),
  [LATE]: late,
};

/** How many keys hold results in `repo`'s store. */
function keptKeys(repo: FixtureRepo): number {
  const database = storePaths(repo.commonDir).database;
  if (!existsSync(database)) return 0;
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    return Number(db.prepare("SELECT count(DISTINCT key) AS n FROM results").get()?.n);
  } finally {
    db.close();
  }
}

describe("squeal code --base killed mid-run (row 020-59, #216)", () => {
  let repo: FixtureRepo;
  let scratch: string;

  beforeAll(() => {
    const policy = keepPolicy("lookup-only", {
      nodeTest: [{ name: "t", include: ["test/*.test.mjs"] }],
      runner: { tierSize: 1 },
    });
    repo = featureRepo(policy, FEATURE);
    scratch = mkdtempSync(join(tmpdir(), "squeal-gate-kill-"));
  });

  afterAll(() => {
    repo?.cleanup();
    if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
  });

  it(
    "keeps the files its first chunk completed, and the next gate reads them from the stores",
    SLOW,
    async () => {
      const marks = join(scratch, "marks");
      const temp = join(scratch, "tmp");
      mkdirSync(marks);
      mkdirSync(temp);
      const flags = ["--disable-warning=ExperimentalWarning", "--import", TSX, CLI];
      const args = ["code", "--base", "main", "--json"];
      const env = { ...repo.env, GATE_MARKS: marks, TMPDIR: temp };
      const child = spawn(process.execPath, [...flags, ...args], {
        cwd: repo.root,
        env,
        detached: true,
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      const exited = new Promise<void>((done) => child.once("exit", () => done()));
      const group = child.pid as number;
      try {
        await waitFor(
          () => existsSync(join(marks, "late")) && keptKeys(repo) >= QUICK.length,
          180_000,
          "the first chunk kept and the late file running",
        );
        // As a reboot ends it: no signal handler runs, no report, no flush.
        process.kill(-group, "SIGKILL");
        await Promise.race([exited, new Promise((done) => setTimeout(done, 30_000))]);
      } catch (error) {
        throw new Error(`${String(error)}; the gate's stderr: ${stderr}`);
      } finally {
        try {
          process.kill(-group, "SIGKILL");
        } catch {
          // The group is gone.
        }
      }

      // The next gate, with a short budget: the late file runs again and does not finish.
      const next = spawnSync(process.execPath, [...flags, ...args, "--timeout", "15"], {
        cwd: repo.root,
        env,
        encoding: "utf8",
        timeout: 120_000,
      });
      const report = JSON.parse(next.stdout) as GateReport;
      const from = Object.fromEntries(report.runs.flatMap((run) => Object.entries(run.from ?? {})));
      expect(
        Object.entries(from)
          .filter(([, where]) => where === "store")
          .map(([path]) => path)
          .sort(),
      ).toEqual(QUICK);
      expect(from[LATE]).not.toBe("store");
    },
  );
});
