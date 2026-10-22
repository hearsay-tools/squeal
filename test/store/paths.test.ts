import { describe, expect, it } from "vitest";
import { socketNameFor, socketWorktreeId } from "../../src/core/daemon/paths.js";
import { lockFileFor, storePaths } from "../../src/core/store/index.js";
import { lockFileParts, lockFileWorktreeId } from "../../src/core/store/paths.js";

describe("storePaths (spec 001 D1)", () => {
  it("lays the store out under <common-dir>/squeal/", () => {
    expect(storePaths("/r/.git")).toEqual({
      dir: "/r/.git/squeal",
      database: "/r/.git/squeal/store.sqlite",
      runsDir: "/r/.git/squeal/runs",
      locksDir: "/r/.git/squeal/locks",
    });
    expect(lockFileFor("/r/.git", "0123456789abcdef")).toBe(
      "/r/.git/squeal/locks/0123456789abcdef.sqlite",
    );
  });
});

/* Row 014-43 (c, d): `squeal ps` reads these names back through the code that makes them. */
describe("the lock and socket names, read back", () => {
  const id = "0123456789abcdef";

  it("gives the worktree id and common dir of a lock file, and nothing for a waiter's", () => {
    expect(lockFileParts(lockFileFor("/r/.git", id))).toEqual({
      commonDir: "/r/.git",
      worktreeId: id,
    });
    expect(lockFileWorktreeId(`${id}.sqlite`)).toBe(id);
    expect(lockFileWorktreeId(`waiter-${id}.sqlite`)).toBeNull();
    expect(lockFileParts(`/r/.git/squeal/locks/waiter-${id}.sqlite`)).toBeNull();
    expect(lockFileParts(`/r/.git/squeal/runs/${id}.sqlite`)).toBeNull();
    expect(lockFileParts(`/r/.git/squeal/locks/${id}.sqlite (deleted)`)).toBeNull();
  });

  it("gives the worktree id of a socket name, and nothing for another file", () => {
    expect(socketWorktreeId(socketNameFor(id))).toBe(id);
    expect(socketWorktreeId(`squeal-${id}.sock.old`)).toBeNull();
    expect(socketWorktreeId("squeal-1000")).toBeNull();
  });
});
