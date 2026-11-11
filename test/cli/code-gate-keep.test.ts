import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { storedFiles } from "../../src/cli/code-gate-stored.js";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import { acquireDaemonLock } from "../../src/core/daemon/lock.js";
import { lockFileFor, storePaths } from "../../src/core/store/paths.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import { createFixtureRepo, type FixtureRepo, waitFor, withStore } from "../daemon/helpers.js";
import { git } from "../hash/git-repo.js";
import { daemonRuns, gate, hasRecord, runIdsAt } from "./code-gate-keep-kit.js";

/*
 * Spec 020 D17.3 (row 020-17c): the gate writes each test file it ran to
 * completion, with its results and coverage record, at the key a daemon
 * in the worktree gives it, through the daemon's write path and under its
 * lock. A second run on the same bytes reads that file from the stores and
 * runs only the other; a changed byte runs it again; a file stopped by the
 * budget is never written; a daemon started afterwards reads the gate's
 * results as current and does not run the file again.
 */

const SLOW = { timeout: 240_000 } as const;

/** Room for a loaded host to start Vitest and run the quick file; the late one never ends. */
const BUDGET = "30";

const POLICY = `${JSON.stringify({
  complexity: { enabled: true },
  coverage: { enabled: true },
  baseline: { onStart: "lookup-only" },
})}\n`;

/** The feature branch: `src/keep.ts` and two tests of it, one quick and one that never ends. */
const FEATURE: Readonly<Record<string, string>> = {
  "src/keep.ts":
    "export const quick = (x: number) => (x > 0 ? 1 : 0);\nexport const late = (x: number) => (x > 0 ? 2 : 0);\n",
  "test/quick.test.ts": `import { expect, it } from "vitest";\nimport { quick } from "../src/keep.ts";\n\nit("quick", () => {\n  expect(quick(1)).toBe(1);\n});\n`,
  "test/late.test.ts": `import { expect, it } from "vitest";\nimport { late } from "../src/keep.ts";\n\n// Never ends inside the budget: a deterministic sleep, not load.\nit("late", async () => {\n  await new Promise((done) => setTimeout(done, 600_000));\n  expect(late(1)).toBe(2);\n});\n`,
};

const QUICK: TestFileRef = { project: "", path: "test/quick.test.ts" };
const LATE: TestFileRef = { project: "", path: "test/late.test.ts" };

/** Each file's key as the worktree's daemon would give it now. */
async function keysNow(repo: FixtureRepo, refs: readonly TestFileRef[]): Promise<CheckKey[]> {
  const stored = storedFiles(repo.root, repo.env, () => {});
  if (stored === null) throw new Error("no keys: coverage is off");
  try {
    const keys = await stored.keys(refs);
    return refs.map((ref) => {
      const key = keys.get(ref);
      if (key == null) throw new Error(`no key for ${ref.path}`);
      return key;
    });
  } finally {
    await stored.close();
  }
}

describe("squeal code --base keeps its completed files (spec 020 D17.3)", () => {
  let repo: FixtureRepo;

  beforeAll(() => {
    repo = createFixtureRepo({ files: { "squeal.config.json": POLICY } });
    git(repo.root, ["checkout", "-q", "-b", "feature"]);
    for (const [path, text] of Object.entries(FEATURE)) {
      mkdirSync(dirname(join(repo.root, path)), { recursive: true });
      writeFileSync(join(repo.root, path), text);
    }
    git(repo.root, ["add", "-A"]);
    git(repo.root, ["commit", "-qm", "feature"]);
  });

  afterAll(() => repo?.cleanup());

  it("writes the file that completed and never the one the budget stopped", SLOW, async () => {
    const first = await gate(repo, ["src/keep.ts", "--timeout", BUDGET]);

    expect([...first.ran].sort()).toEqual([LATE.path, QUICK.path]);
    expect(first.code).toBe(3);
    const [run] = first.report.runs;
    expect([run?.completed, run?.notFinished, run?.from]).toEqual([
      [QUICK.path],
      [LATE.path],
      undefined,
    ]);
    const [quick, late] = await keysNow(repo, [QUICK, LATE]);
    const ids = runIdsAt(repo, quick as CheckKey);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(/^gate-/);
    expect(hasRecord(repo, quick as CheckKey)).toBe(true);
    expect(runIdsAt(repo, late as CheckKey)).toEqual([]);
    expect(hasRecord(repo, late as CheckKey)).toBe(false);
    expect(first.leftInTmp).toEqual([]);
  });

  it("reads the written file on the next run and runs only the other", SLOW, async () => {
    const second = await gate(repo, ["src/keep.ts", "--timeout", BUDGET]);

    expect(second.ran).toEqual([LATE.path]);
    expect(second.stderr).toContain(
      "squeal code: 1 of 2 selected test files read from the stores\n",
    );
    const [run] = second.report.runs;
    expect([run?.completed, run?.notFinished, run?.from]).toEqual([
      [QUICK.path],
      [LATE.path],
      { [LATE.path]: "run", [QUICK.path]: "store" },
    ]);
    const quick = second.report.functions.find((f) => f.qualifiedName === "quick");
    expect(quick?.loaders.measured).toEqual([QUICK.path]);
  });

  it("runs the file again once a byte of it changed", SLOW, async () => {
    const [before] = await keysNow(repo, [QUICK]);
    writeFileSync(
      join(repo.root, QUICK.path),
      (FEATURE[QUICK.path] as string).replace('it("quick"', 'it("quick one"'),
    );
    const [after] = await keysNow(repo, [QUICK]);
    expect(after).not.toBe(before);

    const third = await gate(repo, ["src/keep.ts", "--timeout", BUDGET]);

    expect([...third.ran].sort()).toEqual([LATE.path, QUICK.path]);
    expect(third.report.runs[0]?.from).toBeUndefined();
    expect(runIdsAt(repo, after as CheckKey)).toHaveLength(1);
    expect(hasRecord(repo, after as CheckKey)).toBe(true);
  });

  it("is read as current by a daemon started afterwards, which does not run it", SLOW, async () => {
    const [key] = await keysNow(repo, [QUICK]);
    const ids = runIdsAt(repo, key as CheckKey);
    expect(ids).toHaveLength(1);

    const daemon = await startDaemon({ root: repo.root, env: repo.env });
    if ("reason" in daemon) throw new Error(daemon.message);
    try {
      await daemon.ready;
      const states = await waitFor(
        () =>
          withStore(repo, (store) => {
            const found = store.knownStates.list(repo.worktreeId, [QUICK]);
            return found.length > 0 && found.every((s) => s.validity === "current") ? found : null;
          }),
        120_000,
        "current states of the kept file",
      );
      expect(states.map((s) => [s.check.kind, s.outcome, s.origin?.kind])).toEqual(
        expect.arrayContaining([
          ["file", "pass", "own"],
          ["test", "pass", "own"],
        ]),
      );
      expect(daemonRuns(repo).filter((files) => files.includes(QUICK.path))).toEqual([]);
    } finally {
      await daemon.stop("stop-requested");
    }
    expect(runIdsAt(repo, key as CheckKey)).toEqual(ids);
  });

  it("writes nothing, with one note, while a daemon holds the worktree's lock", SLOW, async () => {
    const [math] = await keysNow(repo, [{ project: "", path: "test/math.test.ts" }]);
    expect(runIdsAt(repo, math as CheckKey)).toEqual([]);
    writeFileSync(
      join(repo.root, "src/math.ts"),
      "export const add = (a: number, b: number) => b + a;\n",
    );
    const [edited] = await keysNow(repo, [{ project: "", path: "test/math.test.ts" }]);

    const lock = acquireDaemonLock(lockFileFor(repo.commonDir, repo.worktreeId));
    if (lock === null) throw new Error("the daemon's lock is held");
    let held: Awaited<ReturnType<typeof gate>>;
    try {
      held = await gate(repo, ["src/math.ts"]);
    } finally {
      lock.release();
    }

    expect(held.ran).toEqual(["test/math.test.ts"]);
    expect(held.code).toBe(0);
    expect(held.stderr.match(/a daemon runs in this worktree/g)).toHaveLength(1);
    expect(runIdsAt(repo, edited as CheckKey)).toEqual([]);

    const free = await gate(repo, ["src/math.ts"]);
    expect(free.stderr).not.toContain("a daemon runs in this worktree");
    expect(runIdsAt(repo, edited as CheckKey)).toHaveLength(1);
  });

  it("runs a file again whose record a stop left without its results", SLOW, async () => {
    const [math] = await keysNow(repo, [{ project: "", path: "test/math.test.ts" }]);
    expect(hasRecord(repo, math as CheckKey)).toBe(true);
    // What a stop between a file's two writes leaves: its record, and no results at its key.
    const db = new DatabaseSync(storePaths(repo.commonDir).database);
    db.prepare("DELETE FROM results WHERE key = ?").run(math as CheckKey);
    db.close();

    const again = await gate(repo, ["src/math.ts"]);

    expect(again.ran).toEqual(["test/math.test.ts"]);
    expect(again.report.runs[0]?.from).toBeUndefined();
    expect(runIdsAt(repo, math as CheckKey)).toHaveLength(1);
  });
});
