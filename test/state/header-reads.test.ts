import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { publishNarrowAsks } from "../../src/core/scheduler/narrow-asks-row.js";
import { groupTiersMetaKey, publishGroupActivity } from "../../src/core/slow/state.js";
import { readHeader } from "../../src/core/state/header.js";
import type { EpochMs } from "../../src/core/types/common.js";
import { worktreeMetaKey } from "../../src/core/types/store.js";
import { inTurn, keys, NOW, type Seeded, seed, states } from "../status/slow-tier-seed.js";

/*
 * Row 011-427 (review 0.1.650 S1, 0.1.652-r2): with a held group, one
 * header read reads the published lane requests, the groups' activity and
 * the worktree row once each, and the on-request files and the group lines
 * share them. A new header read reads them again, so a request published
 * between two reads shows in the second.
 */

let runtime: string;
beforeEach(() => {
  runtime = mkdtempSync(join(tmpdir(), "squeal-header-reads-"));
  vi.stubEnv("XDG_RUNTIME_DIR", runtime);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(runtime, { recursive: true, force: true });
});

const POLICY = {
  checks: [{ name: "browser", runner: "vitest", tests: ["test/browser/**"], at: "manual" }],
};
const FILES = ["test/browser/a.test.ts", "test/browser/b.test.ts", "test/browser/c.test.ts"];

function held(): Seeded {
  const s = seed(POLICY, { revisions: 2 });
  keys(s.store, s.repo, Object.fromEntries(FILES.map((path) => [path, "queued" as const])));
  states(
    s.store,
    s.repo,
    FILES.map(() => ({ validity: "pending" as const })),
    FILES,
  );
  inTurn(s);
  return s;
}

/** The asked key of each of `paths`, as the daemon publishes a narrow ask for it. */
function ask({ store, repo }: Seeded, paths: readonly string[]): void {
  const rows = store.testFileKeys.list(repo.mainId);
  const asks = paths.map((path) => {
    const row = rows.find((r) => r.testFile.path === path);
    if (row?.key == null) throw new Error(`no key for ${path}`);
    return [testFileId(row.testFile), row.key] as const;
  });
  publishNarrowAsks(store, repo.mainId, asks, (NOW - 1_000) as EpochMs);
}

/** Counts `meta.get` by key and `worktrees.get` while `read` runs. */
function counted<T>({ store }: Seeded, read: () => T) {
  const meta = vi.spyOn(store.meta, "get");
  const worktrees = vi.spyOn(store.worktrees, "get");
  try {
    const value = read();
    const keys = meta.mock.calls.map(([key]) => key);
    const reads = (key: string) => keys.filter((k) => k === key).length;
    return { value, reads, worktrees: worktrees.mock.calls.length };
  } finally {
    meta.mockRestore();
    worktrees.mockRestore();
  }
}

describe("one request and activity read per header read (row 011-427)", () => {
  it("reads the lane requests, the group activity and the worktree once per header read", () => {
    const s = held();
    const id = s.repo.mainId;
    ask(s, [FILES[0] as string]);
    publishGroupActivity(s.store, id, "browser", {
      kind: "running",
      path: FILES[0] as string,
      since: NOW - 500,
      lastDurationMs: null,
    });
    const { value, reads, worktrees } = counted(s, () => readHeader(s.store, id));
    expect(reads(worktreeMetaKey("narrowAsks", id))).toBe(1);
    expect(reads(groupTiersMetaKey(id))).toBe(1);
    expect(worktrees).toBe(1);
    // Both readers saw the one read: the asked file is requested and not on request.
    expect(value.groupTiers?.[0]?.requested).toBe(1);
    expect(value.testFilesByPhase?.onRequest).toBe(2);
  });

  it("reads them fresh on the next header read: a new request shows", () => {
    const s = held();
    const id = s.repo.mainId;
    const first = readHeader(s.store, id);
    expect(first.groupTiers?.[0]?.requested).toBeUndefined();
    expect(first.testFilesByPhase?.onRequest).toBe(3);
    ask(s, [FILES[0] as string, FILES[1] as string]);
    const second = readHeader(s.store, id);
    expect(second.groupTiers?.[0]?.requested).toBe(2);
    expect(second.testFilesByPhase?.onRequest).toBe(1);
  });
});
