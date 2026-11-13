import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { runWait } from "../../../src/cli/wait/wait.js";
import {
  isLintStoreOpenFailure,
  lintStorePath,
  openLintStore,
} from "../../../src/core/lint/store/open.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";
import { squealRepo } from "../../harness/helpers.js";
import { closeLoopFixtures, socketPath, steppedClock } from "./fixture.js";

/*
 * Rows 011-326 and 011-327: the lint group wait's loop rows, over a scratch
 * repository's lint store and a stepped clock. Review 0.1.474 B1: a busy
 * lint store, held by a second connection's exclusive lock, is read again
 * until the deadline's read, as the worktree store is; a damaged one still
 * ends the wait as unread.
 */

const locks: DatabaseSync[] = [];

afterEach(() => {
  for (const db of locks.splice(0)) db.close();
  closeLoopFixtures();
});

/** Takes the lint store of `commonDir` with an exclusive lock until `release` (or the test's end). */
function lockLint(commonDir: string): { readonly release: () => void } {
  const db = new DatabaseSync(lintStorePath(commonDir as never));
  db.exec("PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE");
  db.prepare("SELECT count(*) FROM sqlite_schema").get();
  locks.push(db);
  return {
    release: () => {
      const at = locks.indexOf(db);
      if (at !== -1) locks.splice(at, 1);
      db.close();
    },
  };
}

/** A lint group `lint` of eslint at `at` with `states`; lint off without them. */
function lintWait(
  deadlineIn: number,
  states: Record<string, "pass" | "pending"> | "off",
  at: "commit" | "stop" = "commit",
) {
  const r = squealRepo();
  if (states !== "off") {
    writeFileSync(
      join(r.root, "squeal.config.json"),
      JSON.stringify({
        lint: { enabled: true, tools: ["eslint"] },
        checks: [{ name: "lint", lint: true, at }],
      }),
    );
    const lint = { ...DEFAULT_POLICY.lint, enabled: true };
    const store = openLintStore(r.repo.commonDir, { lint }, { busyTimeoutMs: 5_000 });
    if (isLintStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
    for (const [path, outcome] of Object.entries(states)) {
      store.states.upsertMany([
        {
          worktreeId: r.worktreeId,
          check: { kind: "lint", path, tool: "eslint" },
          outcome,
          judged: null,
          stale: false,
          reason: null,
          changedAt: 1,
        },
      ]);
    }
    store.close();
  }
  const clock = steppedClock();
  const ask = {
    wait: "lint group",
    root: r.root,
    socketPath: socketPath(),
    deadline: clock.start + deadlineIn,
    files: { kind: "group", group: "lint" },
  } as const;
  return { r, clock, ask };
}

describe("the lint group wait's loop (rows 011-326 and 011-327)", () => {
  it("stopped: squeal stop ends the wait at its next read and names it, read in the worktree's store (011-327)", async () => {
    const { r, clock, ask } = lintWait(60_000, { "src/a.js": "pending" }, "stop");
    clock.onPause((n) => {
      if (n === 1) r.daemon("none");
    });
    expect(await runWait(ask, clock.ports)).toMatchObject({
      kind: "stopped",
      daemon: { state: "down", reason: "stopped" },
    });
    expect(clock.pauses).toEqual([1_000]);
  });

  it("ended: nothing left to lint before the deadline", async () => {
    const { clock, ask } = lintWait(60_000, { "src/a.js": "pass" });
    expect(await runWait(ask, clock.ports)).toMatchObject({
      kind: "ended",
      counts: { files: 1, linting: 0 },
    });
  });

  it("ended at the deadline's read with nothing left to lint: the verdict (011-327: was deadline)", async () => {
    const { clock, ask } = lintWait(0, { "src/a.js": "pass" });
    expect(await runWait(ask, clock.ports)).toMatchObject({
      kind: "ended",
      counts: { files: 1, linting: 0 },
    });
  });

  it("off: lint is off", async () => {
    const { clock, ask } = lintWait(60_000, "off");
    expect(await runWait(ask, clock.ports)).toEqual({ kind: "off" });
  });

  it("a busy lint store is read again: released at the first pause, the next read gives the verdict (011-327, review 0.1.474 B1)", async () => {
    const { r, clock, ask } = lintWait(60_000, { "src/a.js": "pass" });
    const lock = lockLint(r.repo.commonDir);
    clock.onPause((n) => {
      if (n === 1) lock.release();
    });
    expect(await runWait(ask, clock.ports)).toMatchObject({
      kind: "ended",
      counts: { files: 1, linting: 0 },
    });
    expect(clock.pauses).toEqual([1_000]);
  });

  it("a lint store busy through the deadline: the deadline's read ends the wait with why (011-327, review 0.1.474 B1)", async () => {
    const { r, clock, ask } = lintWait(100, { "src/a.js": "pass" });
    lockLint(r.repo.commonDir);
    expect(await runWait(ask, clock.ports)).toEqual({
      kind: "unopened",
      unavailable: expect.stringMatching(
        /^lint store busy, waited \d+ ms: another process holds the lint store's lock; run the command again once it is released$/,
      ),
    });
    expect(clock.pauses).toEqual([100]);
  });

  it("a damaged lint store still ends the wait as unread (011-327)", async () => {
    const { r, clock, ask } = lintWait(60_000, { "src/a.js": "pass" });
    writeFileSync(
      lintStorePath(r.repo.commonDir),
      "this is not a SQLite database, at all.".repeat(40),
    );
    expect(await runWait(ask, clock.ports)).toEqual({ kind: "unread" });
    expect(clock.pauses).toEqual([]);
  });
});
