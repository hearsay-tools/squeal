import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { appendNote } from "../../src/core/notes.js";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import {
  type CheckKey,
  type DaemonRecord,
  refinedMetaKey,
  type StatusSnapshot,
} from "../../src/core/types/index.js";
import { appendRevisions, check, fakeRepo, fileCheck, seedStore, state } from "./helpers.js";

/*
 * Row 011-29 (011 C6 as amended 2026-10-20; `tasks/011-24/design.md` 1.1,
 * 1.2 and R4): `squeal status` leads with its verdict, outstanding work and
 * a `More:` line; `--full` adds the detail block, and nothing an agent acts
 * on moves behind it.
 */

const NOW = Date.UTC(2026, 9, 19, 16, 15, 0);
const HEAD = "64cf3a8f00000000000000000000000000000000";
const LIVE: DaemonRecord = {
  socketPath: "/tmp/squeal-default-text.sock",
  startedAt: NOW - 60_000,
  heartbeatAt: NOW - 2_000,
  heartbeatIntervalMs: 5_000,
  squealVersion: "0.0.0-test",
  token: "live",
};

const path = (n: number) => `test/f${String(n).padStart(2, "0")}.test.mjs`;

/**
 * gh-44 E1's worktree at revision 1: `test/f01.test.mjs` passed (2 tests
 * and its file-level check), 24 more never run at their inputs under a
 * lookup-only baseline, and one daemon note.
 */
function gh44() {
  const repo = fakeRepo();
  const store = seedStore(repo);
  const wt = repo.mainId;
  writeFileSync(
    join(repo.main, "squeal.config.json"),
    JSON.stringify({ baseline: { onStart: "lookup-only" } }),
  );
  store.worktrees.upsert({
    id: wt,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: LIVE,
  });
  appendRevisions(store, wt, 1, { head: HEAD, dirty: true });
  store.meta.set(refinedMetaKey(wt), "1");
  store.testFileKeys.upsertMany(
    Array.from({ length: 25 }, (_, i) => ({
      worktreeId: wt,
      testFile: { project: "", path: path(i + 1) as never },
      key: `k-${path(i + 1)}` as CheckKey,
      revision: 1,
      pending: null,
    })),
  );
  store.knownStates.upsertMany([
    state(wt, check(path(1), "a")),
    state(wt, check(path(1), "b")),
    state(wt, fileCheck(path(1))),
  ]);
  appendNote(store, wt, {
    at: NOW - 60_000,
    revision: 0,
    text: 'node-test project "unit": 1 test file(s) loaded nothing beyond themselves; declare their inputs in squeal.config.json',
  });
  return { repo, store, wt };
}

function snapshotOf(root: string): StatusSnapshot {
  const status = readStatus(root, { now: () => NOW });
  if (!status.available) throw new Error(status.message);
  return status;
}

async function cli(cwd: string, args: readonly string[]) {
  let out = "";
  const io: CliIo = {
    stdout: (t) => {
      out += t;
    },
    stderr: () => {},
    cwd,
    now: () => NOW,
    env: {},
  };
  const code = await main([...args], io);
  return { code, out };
}

const lines = (text: string) => text.trimEnd().split("\n");

describe("squeal status leads with its verdict (011-29)", () => {
  it("gh-44 E1: the worktree prints 7 lines", async () => {
    const { repo } = gh44();

    const { code, out } = await cli(repo.main, ["status"]);

    expect(code).toBe(0);
    expect(lines(out)).toEqual([
      "Revision: 1 · 64cf3a8f + 1, dirty",
      "Known failures: 0; not current: 24 of 25 test files (24 unknown)",
      "Affected checks: 3 passed (2 tests, 1 test file loaded), 0 running, 0 queued",
      "Full-suite checkpoint: none completed at any revision (the counts are for revision 1; `squeal run --all` requests one)",
      "Outstanding:",
      "  24 test files never run at their inputs, nothing queued them (the baseline is lookup-only): test/f02.test.mjs, test/f03.test.mjs, test/f04.test.mjs and 21 more; `squeal retry <test file>...` runs each once, `squeal run --all --wait` runs all 24 test files not current here",
      "More: `squeal status --full` adds the worktree and daemon, the 24 test files without a result one by one and 1 note",
    ]);
  });

  it("gh-44 E1: --full prints the default text, then today's detail block", async () => {
    const { repo } = gh44();

    const short = lines((await cli(repo.main, ["status"])).out);
    const full = lines((await cli(repo.main, ["status", "--full"])).out);

    expect(full.slice(0, short.length - 1)).toEqual(short.slice(0, -1));
    expect(full.slice(short.length - 1)).toEqual([
      "",
      `Worktree: ${repo.main} (HEAD 64cf3a8, dirty at revision 1)`,
      "Daemon: running, last heartbeat 2 s ago",
      "Inherited from other worktrees: none (every current result here was run in this worktree)",
      "Test files without checks: 0 pending, 24 unknown",
      "Test files without a result: 24 (nothing current at their inputs, none queued)",
      ...Array.from(
        { length: 20 },
        (_, i) =>
          `  ${path(i + 2)}: no result: never run at this key: the baseline is lookup-only, so nothing queued it`,
      ),
      "  and 4 more test files",
      "Closure method: static imports plus declared inputs",
      "Store schema: 1",
      "Notes:",
      '  2026-10-19T16:14:00.000Z, revision 0: node-test project "unit": 1 test file(s) loaded nothing beyond themselves; declare their inputs in squeal.config.json',
    ]);
    expect(full).toHaveLength(37);
  });

  it("--json gives every outstanding group with each of its files", async () => {
    const { repo } = gh44();

    const json = JSON.parse((await cli(repo.main, ["status", "--json"])).out) as StatusSnapshot;

    expect(json.outstanding).toEqual([
      {
        standing: { kind: "never-run", lookupOnly: true, notCurrent: 24 },
        files: Array.from({ length: 24 }, (_, i) => ({ project: "", path: path(i + 2) })),
      },
    ]);
  });

  it("a command names its paths from the directory status ran in", async () => {
    const { repo, store, wt } = gh44();
    store.knownStates.upsertMany(
      Array.from({ length: 22 }, (_, i) => state(wt, fileCheck(path(i + 4)))),
    );

    mkdirSync(join(repo.main, "test"));

    const { out } = await cli(join(repo.main, "test"), ["status"]);

    expect(lines(out)).toContain(
      "  2 test files never run at their inputs, nothing queued them (the baseline is lookup-only): test/f02.test.mjs, test/f03.test.mjs; `squeal retry f02.test.mjs f03.test.mjs` runs each once",
    );
  });

  it("--notes is --full with every note in full, as before", async () => {
    const { repo } = gh44();
    const full = (await cli(repo.main, ["status", "--full"])).out;

    const notes = (await cli(repo.main, ["status", "--notes"])).out;

    expect(notes).toBe(full);
    expect(formatStatus(snapshotOf(repo.main), NOW, "squeal", { allNotes: true })).toBe(full);
  });
});
