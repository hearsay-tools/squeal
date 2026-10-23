import { describe, expect, it } from "vitest";
import {
  type DaemonRecord,
  daemonIncarnation,
  worktreeMetaKey,
} from "../../src/core/types/index.js";
import { fakeCommonDir, open, worktree } from "./helpers.js";

/*
 * Review wave 13ae (task 001-270): a daemon's incarnation holds a random
 * start token, written beside its registration, so two daemons of one
 * version that start in one millisecond are two incarnations. A token
 * counts only while the registration is the one it was drawn with: a
 * release before it writes none and leaves the last one in place. Row
 * 011-140: the token row keeps the executable the daemon runs.
 */

const record = (startedAt: number, token?: string): DaemonRecord => ({
  socketPath: "/tmp/squeal-wt-1.sock" as never,
  startedAt,
  heartbeatAt: startedAt,
  heartbeatIntervalMs: 5_000,
  squealVersion: "0.1.117",
  ...(token === undefined ? {} : { token }),
});

function registered() {
  const store = open(fakeCommonDir());
  store.worktrees.upsert(worktree("wt-1", "/repo", { isMain: true }));
  const incarnation = () => daemonIncarnation(store.worktrees.get("wt-1")?.daemon ?? null);
  return { store, incarnation };
}

describe("a daemon's start token (task 001-270)", () => {
  it("tells apart two daemons of one version registered at one start time", () => {
    const { store, incarnation } = registered();
    store.worktrees.setDaemon("wt-1", record(10, "first"));
    const first = incarnation();
    store.worktrees.setDaemon("wt-1", record(10, "second"));
    expect(first).toBe("0.1.117@10#first");
    expect(incarnation()).toBe("0.1.117@10#second");
  });

  it("row 011-140: keeps the executable beside the version, and none for a daemon that names none", () => {
    const { store } = registered();
    const cli = "/data/versions/0.1.117/dist/cli/squeal.mjs";
    store.worktrees.setDaemon("wt-1", { ...record(10, "first"), executable: cli });
    expect(store.worktrees.get("wt-1")?.daemon).toMatchObject({ token: "first", executable: cli });
    store.worktrees.setDaemon("wt-1", record(11, "second"));
    expect(store.worktrees.get("wt-1")?.daemon).toEqual(record(11, "second"));
  });

  it("is kept with the identity on a clean exit, for the next daemon's first commit", () => {
    const { store } = registered();
    store.worktrees.setDaemon("wt-1", record(10, "first"));
    store.worktrees.setDaemon("wt-1", null);
    expect(store.worktrees.lastDaemon("wt-1")).toEqual({
      startedAt: 10,
      squealVersion: "0.1.117",
      token: "first",
    });
  });

  it("names no daemon registered without one, even where an earlier one is left", () => {
    const { store, incarnation } = registered();
    store.worktrees.setDaemon("wt-1", record(10, "first"));
    const key = worktreeMetaKey("daemonToken", "wt-1");
    const left = store.meta.get(key);
    // A release before the token registers at another start time, or at the same one, and
    // leaves the row as it was.
    for (const startedAt of [11, 10]) {
      store.worktrees.setDaemon("wt-1", {
        ...record(startedAt),
        squealVersion: startedAt === 10 ? "0.1.116" : "0.1.117",
      });
      store.meta.set(key, left ?? "");
      expect(incarnation(), String(startedAt)).toBeNull();
      expect(store.worktrees.lastDaemon("wt-1")).not.toHaveProperty("token");
    }
  });

  it("goes with its worktree", () => {
    const { store } = registered();
    store.worktrees.setDaemon("wt-1", record(10, "first"));
    store.worktrees.remove("wt-1");
    expect(store.meta.get(worktreeMetaKey("daemonToken", "wt-1"))).toBeNull();
  });
});
