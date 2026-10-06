import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import type { StatusResult, StatusSnapshot } from "../../src/core/types/index.js";
import { appendRevisions, fakeRepo, seedStore } from "./helpers.js";

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);
const SHA = "abc1234def5678abc1234def5678abc1234def56";
const OTHER_SHA = "0123456789abcdef0123456789abcdef01234567";

function snapshotOf(result: StatusResult): StatusSnapshot {
  if (!result.available) throw new Error(`unavailable: ${result.message}`);
  return result;
}

function write(path: string, text: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

describe("HEAD and dirty without a recorded revision", () => {
  it("reads HEAD through a loose ref and leaves dirty not known", () => {
    const repo = fakeRepo();
    seedStore(repo);
    write(join(repo.commonDir, "refs", "heads", "main"), `${SHA}\n`);

    const status = snapshotOf(readStatus(repo.main, { now: () => NOW }));

    expect(status).toMatchObject({ revision: 0, head: SHA, dirty: null });
    expect(formatStatus(status, NOW)).toContain(
      `\nWorktree: ${repo.main} (HEAD abc1234, dirty state not known: no daemon is validating)\n`,
    );
  });

  it("reads HEAD through packed-refs from a linked worktree's own HEAD", () => {
    const repo = fakeRepo();
    seedStore(repo);
    const b = repo.addWorktree("b");
    write(join(repo.commonDir, "worktrees", "b", "HEAD"), "ref: refs/heads/feature\n");
    write(
      join(repo.commonDir, "packed-refs"),
      `# pack-refs with: peeled fully-peeled sorted\n${OTHER_SHA} refs/heads/feature\n^${SHA}\n`,
    );

    expect(snapshotOf(readStatus(b.root, { now: () => NOW })).head).toBe(OTHER_SHA);
  });

  it("reads a detached HEAD, and an unborn one as no commit", () => {
    const repo = fakeRepo();
    seedStore(repo);
    const status = snapshotOf(readStatus(repo.main, { now: () => NOW }));
    expect(status).toMatchObject({ head: null, dirty: null });
    expect(formatStatus(status, NOW)).toContain(
      `\nWorktree: ${repo.main} (HEAD no commit, dirty state not known: no daemon is validating)\n`,
    );

    write(join(repo.commonDir, "HEAD"), `${SHA}\n`);
    expect(snapshotOf(readStatus(repo.main, { now: () => NOW })).head).toBe(SHA);
  });

  it("takes HEAD and dirty from the revision once one is recorded", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    write(join(repo.commonDir, "refs", "heads", "main"), `${OTHER_SHA}\n`);
    appendRevisions(store, repo.mainId, 1, { head: SHA, dirty: true });
    store.worktrees.upsert({
      id: repo.mainId,
      root: repo.main,
      commonDir: repo.commonDir,
      isMain: true,
      registeredAt: 1,
      daemon: {
        socketPath: "/run/squeal.sock",
        startedAt: 1,
        heartbeatAt: NOW - 1_000,
        heartbeatIntervalMs: 5_000,
        squealVersion: "0.0.0",
      },
    });

    expect(snapshotOf(readStatus(repo.main, { now: () => NOW }))).toMatchObject({
      head: SHA,
      dirty: true,
      dirtyObservedAt: 1,
    });
  });
});
