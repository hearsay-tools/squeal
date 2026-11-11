import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { storedFiles } from "../../src/cli/code-gate-stored.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import { type FixtureRepo, waitFor } from "../daemon/helpers.js";
import { featureRepo, hasRecord, keepPolicy, runIdsAt } from "./code-gate-keep-kit.js";

/*
 * Spec 020 D17.3 (row 020-17c): the gate writes a file only after its
 * runner's run ended, each file as its record and then its results in one
 * transaction. A gate stopped mid-run, as Ctrl-C stops it (SIGINT to its
 * process group), leaves no entry of the file it never finished, and no
 * entry that holds results without a record or a record without results.
 * The CLI runs from source through tsx, so its own relaunch is real.
 */

const SLOW = { timeout: 240_000 } as const;

const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const CLI = resolve(import.meta.dirname, "../../src/cli/index.ts");

/** Each test writes a mark into `$GATE_MARKS` once it ran; `late` then sleeps past any wait here. */
const mark = (name: string) =>
  `writeFileSync(join(process.env.GATE_MARKS ?? "", ${JSON.stringify(name)}), "")`;
const FEATURE: Readonly<Record<string, string>> = {
  "src/keep.ts":
    "export const quick = (x: number) => (x > 0 ? 1 : 0);\nexport const late = (x: number) => (x > 0 ? 2 : 0);\n",
  "test/quick.test.ts": `import { writeFileSync } from "node:fs";\nimport { join } from "node:path";\nimport { expect, it } from "vitest";\nimport { quick } from "../src/keep.ts";\n\nit("quick", () => {\n  expect(quick(1)).toBe(1);\n  ${mark("quick")};\n});\n`,
  "test/late.test.ts": `import { writeFileSync } from "node:fs";\nimport { join } from "node:path";\nimport { expect, it } from "vitest";\nimport { late } from "../src/keep.ts";\n\nit("late", async () => {\n  ${mark("late")};\n  await new Promise((done) => setTimeout(done, 600_000));\n  expect(late(1)).toBe(2);\n});\n`,
};

const QUICK: TestFileRef = { project: "", path: "test/quick.test.ts" };
const LATE: TestFileRef = { project: "", path: "test/late.test.ts" };

describe("squeal code --base stopped mid-run (spec 020 D17.3)", () => {
  let repo: FixtureRepo;
  let scratch: string;

  beforeAll(() => {
    repo = featureRepo(keepPolicy("lookup-only"), FEATURE);
    scratch = mkdtempSync(join(tmpdir(), "squeal-gate-stop-"));
  });

  afterAll(() => {
    repo?.cleanup();
    if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
  });

  it("leaves no partial entry when SIGINT stops it while a file still runs", SLOW, async () => {
    const marks = join(scratch, "marks");
    const temp = join(scratch, "tmp");
    mkdirSync(marks);
    mkdirSync(temp);
    const flags = ["--disable-warning=ExperimentalWarning", "--import", TSX, CLI];
    const args = ["code", "--base", "main", "src/keep.ts", "--json"];
    const child = spawn(process.execPath, [...flags, ...args], {
      cwd: repo.root,
      env: { ...repo.env, GATE_MARKS: marks, TMPDIR: temp },
      // Its own process group, as a terminal's foreground job, so Ctrl-C reaches every process of it.
      detached: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const exited = new Promise<number | null>((done) => child.once("exit", (code) => done(code)));
    const group = child.pid as number;
    try {
      await waitFor(
        () => existsSync(join(marks, "quick")) && existsSync(join(marks, "late")),
        180_000,
        "both tests running",
      );
      process.kill(-group, "SIGINT");
      await Promise.race([exited, new Promise((done) => setTimeout(done, 30_000))]);
    } catch (error) {
      throw new Error(`${String(error)}; the gate's stderr: ${stderr}`);
    } finally {
      try {
        process.kill(-group, "SIGKILL");
      } catch {
        // The group is gone: every process of it ended.
      }
    }

    const stored = storedFiles(repo.root, repo.env, () => {});
    let keys: ReadonlyMap<TestFileRef, CheckKey | null> | undefined;
    try {
      keys = await stored?.keys([QUICK, LATE]);
    } finally {
      await stored?.close();
    }
    const quick = keys?.get(QUICK) as CheckKey;
    const late = keys?.get(LATE) as CheckKey;
    expect(quick).toBeTypeOf("string");
    expect([runIdsAt(repo, late), hasRecord(repo, late)]).toEqual([[], false]);
    // Whatever the stop let it write of the file that completed, it is whole.
    expect(hasRecord(repo, quick)).toBe(runIdsAt(repo, quick).length > 0);
  });
});
