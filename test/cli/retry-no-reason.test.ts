import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CliIo } from "../../src/cli/main.js";
import { retryCommand } from "../../src/cli/retry.js";
import { readRetries } from "../../src/core/retry/index.js";
import { recordUnknownFiles } from "../../src/core/scheduler/unknown-files.js";
import type { CheckKey, EpochMs, RevisionNumber } from "../../src/core/types/index.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "../status/helpers.js";

/*
 * Row 011-27 (011 C5 as amended 2026-10-20, design 011-24 Q3 option 1):
 * `squeal retry <file>` without `--reason` runs once a file with no result at
 * its key, stale, never run or timed out, and is refused on a counted failure,
 * whose retry still needs the cause outside the code.
 */

const STALE = "test/stale.test.ts";
const NEVER = "test/never.test.ts";
const TIMED = "test/timed.test.ts";
const FAILS = "test/fails.test.ts";
const ref = (path: string) => ({ project: "", path: path as never });
const keyOf = (path: string) => `key-${path}` as CheckKey;

const saved = { ...process.env };
let runtimeDir: string;
beforeEach(() => {
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
});
afterEach(() => {
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

/** A worktree with no daemon: one file of each kind at revision 3. */
function worktree() {
  const repo = fakeRepo();
  const store = seedStore(repo);
  const id = repo.mainId;
  store.worktrees.upsert({
    id,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  appendRevisions(store, id, 3, { head: null, dirty: false });
  store.testFileKeys.upsertMany(
    [STALE, NEVER, TIMED, FAILS].map((path) => ({
      worktreeId: id,
      testFile: ref(path),
      key: keyOf(path),
      revision: 3 as RevisionNumber,
      pending: null,
    })),
  );
  store.knownStates.upsertMany([
    state(id, check(STALE, "works"), { validity: "stale", observedAt: 2 }),
    state(id, check(FAILS, "works"), { outcome: "fail", observedAt: 3 }),
  ]);
  store.transaction(() =>
    recordUnknownFiles(
      store,
      id,
      [
        {
          testFile: ref(TIMED),
          key: keyOf(TIMED),
          reason: "timed out after 600 s",
          ran: false,
          samples: [],
          revision: 3 as RevisionNumber,
          at: Date.now() as EpochMs,
          cause: "timeout",
        },
      ],
      () => true,
    ),
  );
  return { root: repo.main, store };
}

async function retry(argv: string[], cwd: string) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd,
    env: { CLAUDE_CODE_SESSION_ID: "s1" },
  };
  const code = await retryCommand(argv, io, { hostLoad: () => ({ oneMinute: 1, cpus: 8 }) });
  return { code, stdout, stderr };
}

describe("squeal retry without --reason (011-27, 011 C5 as amended)", () => {
  it("runs once a stale, a never-run and a timed-out file, naming no reason", async () => {
    const { root, store } = worktree();

    const out = await retry([STALE, NEVER, TIMED], root);

    expect(out.code).toBe(0);
    expect(out.stderr).toBe("");
    const lines = out.stdout.split("\n");
    expect(lines.slice(0, 3)).toEqual([
      expect.stringMatching(
        /^Run queued: test\/stale\.test\.ts has no result at its inputs \(stale: its last result is at other inputs\)\. It runs once now at its normal priority; that is its one run/,
      ),
      expect.stringMatching(
        /^Run queued: test\/never\.test\.ts has no result at its inputs \(unknown: never run at this key: the baseline is lookup-only, so nothing queued it\)\. It runs once now/,
      ),
      expect.stringMatching(
        /^Run queued: test\/timed\.test\.ts has no result at its inputs \(unknown: timed out after 600 s\)\. It runs once now/,
      ),
    ]);
    expect(out.stdout).not.toContain("whatever the reason");
    expect(readRetries(store)).toMatchObject(
      [STALE, NEVER, TIMED].map((path) => ({ testFile: ref(path), noResult: true, end: null })),
    );
  });

  it("is refused on a counted failure, which still needs --reason", async () => {
    const { root, store } = worktree();

    const out = await retry([FAILS], root);

    expect(out.code).toBe(1);
    expect(out.stdout).toBe(
      "Not retried: test/fails.test.ts has a known failure at its inputs; a retry of it needs --reason load or --reason environment, the cause outside the code.\n",
    );
    expect(readRetries(store)).toEqual([]);
  });

  it("takes the files it can and refuses the rest in one call, exiting 1", async () => {
    const { root, store } = worktree();

    const out = await retry([NEVER, FAILS], root);

    expect(out.code).toBe(1);
    expect(out.stdout).toMatch(/^Run queued: test\/never\.test\.ts /);
    expect(out.stdout).toContain("Not retried: test/fails.test.ts has a known failure");
    expect(readRetries(store)).toHaveLength(1);
  });
});
