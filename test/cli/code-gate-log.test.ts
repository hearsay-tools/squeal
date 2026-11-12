import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { keptLogsLine, runLogKeeper } from "../../src/cli/code-gate-log.js";
import type { RunLog } from "../../src/core/code/gate/evidence.js";
import type { GateRunReport } from "../../src/core/code/gate/report.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { Store } from "../../src/core/types/store.js";
import { initRepo } from "../hash/git-repo.js";
import { code, edit, keptLogs, ownHomeAndTmp, repo, SLOW } from "./code-gate-fixture.js";

/*
 * #197 (row 020-40): a gate run with a failed or unfinished file keeps its
 * log folder where a daemon keeps its runs' logs, `<store>/runs/<run-id>`,
 * named by a finished `runs` row, so the store's prune (spec 001 D8)
 * removes it as it removes a daemon run's log.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The line's words where no daemon registered the worktree, as in these fixtures. */
const NEXT_PRUNE =
  "kept until the next prune, within about 1 h while a daemon of this repository runs (none serves this worktree)";
const NOW = 1_800_000_000_000;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A git repository, and a run's log folder as Vitest writes one, outside it. */
function setUp(): { root: string; run: RunLog } {
  const root = join(scratch("squeal-gate-log-"), "repo");
  initRepo(root, { "src/a.ts": "export const a = 1;\n" });
  const logDir = join(scratch("squeal-gate-log-tmp-"), "runs", "0");
  mkdirSync(logDir, { recursive: true });
  writeFileSync(join(logDir, "vitest.log"), "FAIL test/a.test.ts > adds\n  expected 2 to be 3\n");
  const run: RunLog = {
    runner: "vitest",
    files: [{ project: "", path: "test/a.test.ts" }],
    logDir,
    report: { end: "completed", durationMs: 1500 } as RunLog["report"],
  };
  return { root, run };
}

function store(root: string): Store {
  const opened = openStore(join(root, ".git"));
  if (isStoreOpenFailure(opened)) throw new Error(opened.reason);
  cleanups.push(() => opened.close());
  return opened;
}

describe("runLogKeeper: the log of a failed run (#197)", () => {
  it("copies the log folder under the store's runs folder, named by a finished run", async () => {
    const { root, run } = setUp();
    const notes: string[] = [];

    const keeper = runLogKeeper(root, { note: (t) => notes.push(t), now: () => NOW });
    const path = await keeper.keep(run);

    expect(notes).toEqual([]);
    // No daemon registered this worktree: any daemon of the repository prunes it next.
    expect(keeper.retention()).toBe("next-prune");
    expect(path).toMatch(/\.git\/squeal\/runs\/gate-[0-9a-f-]{36}$/);
    expect(readFileSync(join(path ?? "", "vitest.log"), "utf8")).toContain("expected 2 to be 3");
    expect(store(root).runs.get(basename(path ?? ""))).toEqual({
      id: basename(path ?? ""),
      worktreeId: worktreeIdFor(root),
      revision: 0,
      testFiles: run.files,
      checkpointId: null,
      logDir: path,
      startedAt: NOW - 1500,
      endedAt: NOW,
      end: "completed",
    });
  });

  it("is pruned with a daemon run's log: after the retention days in a registered worktree", async () => {
    const { root, run } = setUp();
    const opened = store(root);
    const commonDir = join(root, ".git");
    const registration = { root, commonDir, isMain: true, registeredAt: NOW, daemon: null };
    opened.worktrees.upsert({ id: worktreeIdFor(root), ...registration });
    const keeper = runLogKeeper(root, { note: () => {}, now: () => NOW });
    const path = await keeper.keep(run);
    expect(keeper.retention()).toEqual({ days: 7 });

    opened.prune({ now: NOW + 6 * DAY_MS, retentionDays: 7, maxSizeMb: null });
    expect(keptLogs(root)).toEqual([path]);

    opened.prune({ now: NOW + 8 * DAY_MS, retentionDays: 7, maxSizeMb: null });
    expect(keptLogs(root)).toEqual([]);
    expect(opened.runs.get(basename(path ?? ""))).toBeNull();
  });

  it("is pruned at the next prune where no daemon registered the worktree", async () => {
    const { root, run } = setUp();
    await runLogKeeper(root, { note: () => {}, now: () => NOW }).keep(run);

    store(root).prune({ now: NOW, retentionDays: 7, maxSizeMb: null });

    expect(keptLogs(root)).toEqual([]);
  });

  it("keeps nothing, and says why, when the store stays busy past its wait", async () => {
    const { root, run } = setUp();
    const holder = connectionOf(store(root));
    holder.db.exec("BEGIN IMMEDIATE");
    cleanups.unshift(() => holder.db.exec("ROLLBACK"));
    const notes: string[] = [];

    const keeper = runLogKeeper(root, { note: (t) => notes.push(t), busyTimeoutMs: 50 });
    const path = await keeper.keep(run);

    expect(path).toBeNull();
    expect(keeper.retention()).toBeNull();
    expect(notes).toEqual([
      expect.stringMatching(/^Vitest run: its log was not kept: the store did not take its run: /),
    ]);
    // The row comes first: no folder is left that no row names, which no prune would remove.
    expect(keptLogs(root)).toEqual([]);
  });
});

describe("keptLogsLine: the stderr line after the verdict (#197)", () => {
  const run = (runner: GateRunReport["runner"], log?: string): GateRunReport => ({
    runner,
    selected: [],
    completed: [],
    notFinished: [],
    failed: [],
    ...(log === undefined ? {} : { log }),
    durationMs: 1,
  });

  it("names each kept log by runner, in the report's order, and is absent with none", () => {
    expect(keptLogsLine([run("vitest"), run("node-test")], null)).toBeNull();
    expect(keptLogsLine([run("vitest", "/r/runs/gate-1"), run("node-test")], { days: 7 })).toBe(
      "squeal code: log of the failed or unfinished test files, kept 7 days (store.retentionDays): Vitest /r/runs/gate-1\n",
    );
    const both = [run("vitest", "/r/runs/gate-1"), run("node-test", "/r/runs/gate-2")];
    expect(keptLogsLine(both, { days: 1 })).toBe(
      "squeal code: logs of the failed or unfinished test files, kept 1 day (store.retentionDays): Vitest /r/runs/gate-1; node:test /r/runs/gate-2\n",
    );
  });

  it("says the next prune removes them where no daemon serves the worktree", () => {
    expect(keptLogsLine([run("vitest", "/r/runs/gate-1")], "next-prune")).toBe(
      `squeal code: log of the failed or unfinished test files, ${NEXT_PRUNE}: Vitest /r/runs/gate-1\n`,
    );
  });
});

describe("squeal code --base: the plain report and the kept log (#197)", () => {
  it(
    "names the kept log on stderr after the verdict, and the verdict and exit stay",
    SLOW,
    async () => {
      ownHomeAndTmp();
      const root = repo();
      edit(root, {
        "src/math.ts": "export function double(x: number): number {\n  return x;\n}\n",
      });
      const writes: string[] = [];

      const ran = await code(root, ["--base", "main"], {
        stdout: (text) => writes.push(`stdout ${text}`),
        stderr: (text) => writes.push(`stderr ${text}`),
      });

      expect(ran.code).toBe(3);
      expect(ran.stdout).toContain("Code gate: incomplete.");
      const [log] = keptLogs(root);
      expect(readFileSync(join(log ?? "", "vitest.log"), "utf8")).toContain("expected 2 to be 4");
      // The report first, then the one line that names the log, last.
      expect(writes.at(-2)?.startsWith("stdout ")).toBe(true);
      expect(writes.at(-1)).toBe(
        `stderr squeal code: log of the failed or unfinished test files, ${NEXT_PRUNE}: Vitest ${log}\n`,
      );
    },
  );
});
