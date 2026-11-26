import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CliIo } from "../../src/cli/main.js";
import { retryCommand } from "../../src/cli/retry.js";
import { appendNote } from "../../src/core/notes.js";
import { readRetries } from "../../src/core/retry/records.js";
import { recordRefinedApplied } from "../../src/core/scheduler/refined.js";
import { writeRemoteSummary } from "../../src/core/status/remote-status.js";
import type { EpochMs, RevisionNumber, WorktreeId } from "../../src/core/types/common.js";
import type { CheckKey } from "../../src/core/types/keys.js";
import type { Store } from "../../src/core/types/store.js";
import { fakeRepo, seedStore } from "../status/helpers.js";

/*
 * Row 026-31 (gh-278): `squeal retry` on a file the worktree has not listed
 * while a recorded remote outage under `whenLost: "not-run"` keeps its test
 * files from being listed names the remote, its reason and time, the policy
 * and the recovery, exit 3, queuing nothing. Under `whenLost: "local"`, with
 * no outage, once the revision is listed, and for a path no runner lists,
 * every reply stays as before (`retry-unlisted.test.ts`).
 */

const KEYED = "test/a.test.ts";
const NEW = "test/new.test.ts";
const SINCE = "2026-11-24T20:06:21.678Z";
const SUMMARY =
  "command cmd:lan-1: unreachable (the host ended); background and edit runs of vitest; planning remote; environment match-local";

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

/** Revisions 1 to `latest`, the runner part applied up to `refined` (recorded at `listedAt`), one keyed file. */
function worktree(latest: number, refined: number, listedAt: number, keyed = true) {
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
  store.transaction(() => {
    for (let n = 1; n <= latest; n++) {
      store.revisions.append({
        worktreeId: id,
        createdAt: n === refined ? listedAt : n,
        head: "0000000000000000000000000000000000000000",
        dirty: true,
        trigger: "watch",
        changes: [{ path: "src/a.ts", oldHash: null, newHash: `h${n}` }],
      });
    }
  });
  recordRefinedApplied(store, id, refined);
  store.testFileKeys.upsertMany(
    keyed
      ? [
          {
            worktreeId: id,
            testFile: { project: "", path: KEYED as never },
            key: "key-a" as CheckKey,
            revision: refined as RevisionNumber,
            pending: null,
          },
        ]
      : [],
  );
  const write = (path: string, text = "") => {
    mkdirSync(dirname(join(repo.main, path)), { recursive: true });
    writeFileSync(join(repo.main, path), text);
  };
  return { root: repo.main, store, id, write };
}

/** The lane's note and summary: `then` is `N files not run` under not-run, `running here` under local. */
function remoteDown(store: Store, id: WorktreeId, then: string) {
  writeRemoteSummary(store, id, SUMMARY);
  appendNote(store, id, {
    at: 1 as EpochMs,
    revision: 4 as RevisionNumber,
    text: `remote cmd:lan-1 unreachable since ${SINCE} (the host ended); ${then}`,
    topic: "remote-lane",
  });
}

async function retry(argv: string[], cwd: string) {
  let stdout = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: () => {},
    cwd,
    env: { CLAUDE_CODE_SESSION_ID: "s1" },
  };
  const code = await retryCommand(argv, io, { hostLoad: () => ({ oneMinute: 1, cpus: 8 }) });
  return { code, stdout };
}

describe("squeal retry names a recorded remote outage that keeps the listing (row 026-31)", () => {
  it("before the listing, under whenLost not-run: the remote, reason, time, policy and recovery, exit 3", async () => {
    const w = worktree(4, 3, 3);
    w.write(NEW);
    const before = await retry([NEW], w.root);
    remoteDown(w.store, w.id, "2 files not run");

    const out = await retry([NEW], w.root);

    expect(out).toEqual({
      code: 3,
      stdout:
        `Not listed yet: ${NEW} has no key because remote cmd:lan-1 unreachable since ${SINCE} (the host ended); ` +
        'nothing runs here in its place (whenLost "not-run"), so it has nothing to retry; ' +
        `check \`squeal status\`; once the remote is ready, \`squeal status --wait 60000 ${NEW}\` waits for the listing and the result.\n`,
    });
    expect(before.code).toBe(3);
    expect(before.stdout).not.toContain("remote");
    expect(readRetries(w.store)).toEqual([]);
  });

  it("before the listing, under whenLost local: the reply is as before", async () => {
    const w = worktree(4, 3, 3);
    w.write(NEW);
    const before = await retry([NEW], w.root);
    remoteDown(w.store, w.id, "running here");
    expect(await retry([NEW], w.root)).toEqual(before);
  });

  it("a worktree that keyed nothing: the outage replaces the generic not-listed line", async () => {
    const w = worktree(3, 3, Date.now() + 60_000, false);
    w.write(NEW);
    const before = await retry([NEW], w.root);
    expect(before.stdout).toMatch(
      new RegExp(
        `^Not listed yet: ${NEW} has no key because the daemon has not listed this worktree's test files yet`,
      ),
    );
    remoteDown(w.store, w.id, "3 files not run");
    const out = await retry([NEW], w.root);
    expect(out.code).toBe(3);
    expect(out.stdout).toMatch(
      new RegExp(
        `^Not listed yet: ${NEW} has no key because remote cmd:lan-1 unreachable since ${SINCE} \\(the host ended\\); nothing runs here in its place \\(whenLost "not-run"\\)`,
      ),
    );
    // Under whenLost local the reply is as before.
    remoteDown(w.store, w.id, "running here");
    expect(await retry([NEW], w.root)).toEqual(before);
  });

  it("after the listing, and for a path no runner lists: the refusal stands under either policy", async () => {
    const w = worktree(3, 3, Date.now() + 60_000);
    w.write(NEW);
    w.write("src/x.py");
    const before = await retry([NEW], w.root);
    const other = await retry(["src/x.py"], w.root);
    remoteDown(w.store, w.id, "2 files not run");
    expect(await retry([NEW], w.root)).toEqual(before);
    expect(await retry(["src/x.py"], w.root)).toEqual(other);
    expect(before.stdout).toBe(
      `Not retried: ${NEW} is not a test file Squeal has keyed in this worktree.\n`,
    );
  });
});
