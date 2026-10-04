import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenedDaemon } from "../../src/core/daemon/open.js";
import type { DaemonExit } from "../../src/core/types/index.js";
import { createFixtureRepo, type FixtureRepo } from "./helpers.js";

const integrityChecks = vi.hoisted(() => ({ count: 0 }));

vi.mock("../../src/core/store/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/store/index.js")>();
  return {
    ...actual,
    openStore: ((...args: Parameters<typeof actual.openStore>) => {
      if (args[1]?.checkIntegrity === true) integrityChecks.count++;
      return actual.openStore(...args);
    }) as typeof actual.openStore,
  };
});

const { openDaemon } = await import("../../src/core/daemon/open.js");

const repos: FixtureRepo[] = [];
const opened: OpenedDaemon[] = [];
afterEach(() => {
  for (const daemon of opened.splice(0)) {
    daemon.store.close();
    daemon.lock.release();
  }
  for (const repo of repos.splice(0)) repo.cleanup();
  integrityChecks.count = 0;
});

describe("openDaemon: lock before store (spec 001 D10, review S8)", () => {
  it("five concurrent starts run integrity_check once: losers never open the store", async () => {
    const repo = createFixtureRepo();
    repos.push(repo);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => openDaemon(repo.root, Date.now)),
    );
    const winners = results.filter((r): r is OpenedDaemon => !("reason" in r));
    opened.push(...winners);
    const losers = results.filter((r): r is DaemonExit => "reason" in r);
    expect(winners).toHaveLength(1);
    expect(losers.map((exit) => exit.reason)).toEqual(Array(4).fill("lost-lock"));
    expect(integrityChecks.count).toBe(1);
  });

  it("releases the lock when the store cannot be opened, so the next start can try", async () => {
    const repo = createFixtureRepo();
    repos.push(repo);
    const { storePaths } = await import("../../src/core/store/index.js");
    const { mkdirSync } = await import("node:fs");
    // A directory where the database file belongs: openStore fails.
    mkdirSync(storePaths(repo.commonDir).database, { recursive: true });
    const first = await openDaemon(repo.root, Date.now);
    expect(first).toMatchObject({ reason: "store-unusable", code: 1 });
    const { acquireDaemonLock } = await import("../../src/core/daemon/lock.js");
    const { lockFileFor } = await import("../../src/core/store/index.js");
    const lock = acquireDaemonLock(lockFileFor(repo.commonDir, repo.worktreeId));
    expect(lock).not.toBeNull();
    lock?.release();
  });
});
