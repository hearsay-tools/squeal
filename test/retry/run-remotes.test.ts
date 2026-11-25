import { describe, expect, it } from "vitest";
import {
  keptRemote,
  RUN_REMOTES_KEPT,
  RUN_REMOTES_META_KEY,
  readRunRemotes,
  recordRunRemote,
} from "../../src/core/retry/remote.js";
import { freshStore } from "../state/helpers.js";

/*
 * Row 026-28 (spec 026 D12): `failed-run-remotes` keeps, per run that
 * stored a failure, the remote of each failing file that ran remotely, for
 * the newest `RUN_REMOTES_KEPT` runs, as `failed-run-loads` keeps loads.
 */

const A = { project: "", path: "test/a.test.ts" };
const B = { project: "", path: "test/b.test.ts" };

describe("failed-run-remotes (row 026-28)", () => {
  it("keeps each file's remote within its run, and none for a file not kept", () => {
    const store = freshStore();
    recordRunRemote(store, "run-1", A, "vm-1");
    recordRunRemote(store, "run-1", B, "vm-1");
    recordRunRemote(store, "run-2", A, "vm-2");
    const remotes = readRunRemotes(store);
    expect([...remotes.keys()]).toEqual(["run-1", "run-2"]);
    expect(keptRemote(remotes, "run-1", B)).toBe("vm-1");
    expect(keptRemote(remotes, "run-2", A)).toBe("vm-2");
    expect(keptRemote(remotes, "run-2", B)).toBeUndefined();
    expect(keptRemote(remotes, "run-3", A)).toBeUndefined();
  });

  it("keeps the newest runs only", () => {
    const store = freshStore();
    for (let i = 0; i <= RUN_REMOTES_KEPT; i++) recordRunRemote(store, `run-${i}`, A, "vm");
    const remotes = readRunRemotes(store);
    expect(remotes.size).toBe(RUN_REMOTES_KEPT);
    expect(remotes.has("run-0")).toBe(false);
    expect(remotes.has(`run-${RUN_REMOTES_KEPT}`)).toBe(true);
  });

  it("reads a row that does not parse, or holds no remotes, as none", () => {
    const store = freshStore();
    store.meta.set(RUN_REMOTES_META_KEY, "{");
    expect(readRunRemotes(store).size).toBe(0);
    store.meta.set(RUN_REMOTES_META_KEY, JSON.stringify({ "run-1": 3, "run-2": { a: 1 } }));
    expect([...readRunRemotes(store)]).toEqual([["run-2", {}]]);
  });
});
