import { beforeEach, describe, expect, it } from "vitest";
import {
  createDelivery,
  otherSessionVersions,
  versionMetaKey,
} from "../../src/core/delivery/index.js";
import type { Consumer, Store } from "../../src/core/types/index.js";
import { freshStore, WT } from "../state/helpers.js";
import { fixedStatus, liveDaemon } from "./fakes.js";

/*
 * Task 001-130, review wave 12b B1: each registration records the hook's
 * Squeal version beside the consumer, so a hook can tell whether a session
 * of an older plugin is still registered before it asks a daemon to step
 * down. A registration without a version (every hook before this row) reads
 * as `null`.
 */

const consumer = (sessionId: string, agentId = "main"): Consumer => ({
  worktreeId: WT,
  sessionId,
  agentId,
});

let store: Store;
beforeEach(() => {
  store = freshStore();
  liveDaemon(store, WT);
});

const register = (c: Consumer, squealVersion?: string) =>
  createDelivery(store, {
    status: fixedStatus(),
    ...(squealVersion === undefined ? {} : { squealVersion }),
  }).register(c);

describe("the consumer version record", () => {
  it("lists the other sessions' versions, null for a registration without one", async () => {
    await register(consumer("old"));
    await register(consumer("new"), "0.1.34");
    await register(consumer("me"), "0.1.34");
    await register(consumer("me", "sub"));
    expect(otherSessionVersions(store, consumer("me")).sort()).toEqual(["0.1.34", null]);
  });

  it("leaves out the asking session's own consumers, whatever they recorded", async () => {
    await register(consumer("me"));
    await register(consumer("me", "sub"), "0.1.0");
    expect(otherSessionVersions(store, consumer("me"))).toEqual([]);
  });

  it("is forgotten when the consumer unregisters, and replaced by a later registration", async () => {
    const delivery = createDelivery(store, { status: fixedStatus(), squealVersion: "0.1.34" });
    await register(consumer("old"), "0.1.31");
    await register(consumer("old"), "0.1.34");
    expect(otherSessionVersions(store, consumer("me"))).toEqual(["0.1.34"]);
    await delivery.unregister(consumer("old"));
    expect(otherSessionVersions(store, consumer("me"))).toEqual([]);
    expect(store.meta.get(versionMetaKey(WT))).toBe("{}");
  });
});
