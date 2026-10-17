import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { readFailures, readStatus, readWhy } from "../../src/core/status/index.js";
import { storePaths } from "../../src/core/store/index.js";
import { fakeRepo, seedStore } from "./helpers.js";
import { holdLock } from "./hold-lock.js";
import { LOGIN, reportOf, seedLogin } from "./why-seed.js";

/** A partial name, so `why` resolves it through the held keys (`why.ts` `held`). */
const PARTIAL = "auth > login";

function seeded() {
  const repo = fakeRepo();
  const store = seedStore(repo);
  const b = seedLogin(repo, store);
  // `seedLogin` stored a result under `k1`; a current key there, so the partial-name lookup reads results by key.
  store.testFileKeys.upsertMany([
    {
      worktreeId: b.id,
      testFile: { project: "", path: LOGIN.testPath },
      key: "k1",
      revision: 2,
      pending: null,
    },
  ]);
  store.close();
  return { repo, b, database: storePaths(repo.commonDir).database };
}

function cli(argv: string[], cwd: string) {
  let stdout = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: () => {},
    cwd,
    env: {},
  };
  return { code: main(argv, io), stdout };
}

/** Row 011-01, issues 7 and 8: a CLI read never fails or lies because another process writes. */
describe("CLI reads beside a store writer (011 C6, C7, C13)", () => {
  it("returns the stored evidence of a partial-name `why` while a second process holds the write lock", async () => {
    const { b, database } = seeded();
    const holder = await holdLock(database, "immediate", 3_000);
    try {
      const started = Date.now();
      const why = reportOf(readWhy(b.root, PARTIAL, { busyTimeoutMs: 1_000 }));

      expect(why.check).toEqual(LOGIN);
      // Issue 7: the upgrade failed in 0 ms; a read that takes no write never waits for a writer.
      expect(Date.now() - started).toBeLessThan(1_000);
    } finally {
      holder.child.kill();
      await holder.released;
    }
  });

  it("never fails `status`, `failures` or `why` through the CLI beside an ordinary WAL writer", async () => {
    const { b, database } = seeded();
    const holder = await holdLock(database, "immediate", 3_000);
    try {
      expect(readStatus(b.root).available).toBe(true);
      expect(readFailures(b.root).available).toBe(true);
      const why = cli(["why", PARTIAL], b.root);
      expect(why).toMatchObject({ code: 0 });
      expect(why.stdout).toContain("auth > login");
      expect(cli(["status"], b.root).code).toBe(0);
      expect(cli(["failures"], b.root).code).toBe(0);
    } finally {
      holder.child.kill();
      await holder.released;
    }
  });

  it("waits out a reader-blocking lock released within the bound", async () => {
    const { b, database } = seeded();
    const holder = await holdLock(database, "exclusive-locking", 600);
    try {
      const why = readWhy(b.root, PARTIAL, { busyTimeoutMs: 100, busyRetryMs: 5_000 });

      expect(reportOf(why).check).toEqual(LOGIN);
    } finally {
      await holder.released;
    }
  });

  it.each([
    ["why", PARTIAL],
    ["status", "--json"],
    ["failures", "--json"],
  ])(
    "retries `squeal %s` past one busy timeout while a reader-blocking lock frees",
    async (...argv) => {
      const { b, database } = seeded();
      // Longer than the 1,000 ms busy timeout of one attempt, shorter than `CLI_READ_RETRY_MS`.
      const holder = await holdLock(database, "exclusive-locking", 1_500);
      try {
        expect(cli(argv, b.root).code).toBe(0);
      } finally {
        await holder.released;
      }
    },
  );

  it("says how long it waited and promises no wait that would end at the same lock, when the lock outlasts the bound", async () => {
    const { b, database } = seeded();
    const holder = await holdLock(database, "exclusive-locking", 5_000);
    try {
      const started = Date.now();
      const why = readWhy(b.root, PARTIAL, { busyTimeoutMs: 100, busyRetryMs: 400 });
      const waited = Date.now() - started;

      expect(why).toMatchObject({ available: false, reason: "timeout" });
      if (why.available) throw new Error("expected unavailable");
      const ms = Number(/store busy, waited (\d+) ms/.exec(why.message)?.[1]);
      expect(ms).toBeGreaterThanOrEqual(400);
      expect(ms).toBeLessThanOrEqual(waited);
      // `status --wait` ends at its first unavailable read (review 011-core wave-1), so naming it would promise a wait.
      expect(why.message).toContain("run the command again once it is released");
      expect(why.message).not.toContain("status --wait");
    } finally {
      holder.child.kill();
      await holder.released;
    }
  });
});
