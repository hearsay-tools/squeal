import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type ObservedSeen, startTimers } from "../../src/core/daemon/lifecycle.js";
import { storePaths } from "../../src/core/store/index.js";
import {
  type DaemonExitReason,
  DEFAULT_POLICY,
  type NodeTestProject,
  nodeTestObservedMetaKey,
  nodeTestObservedPreloadsMetaKey,
  type Store,
} from "../../src/core/types/index.js";
import { fakeCommonDir, open } from "../store/helpers.js";
import { delay, waitFor } from "./helpers.js";

/*
 * Task 003-26: the daemon reads the shared node:test observed keys on a
 * timer and asks for a runner-only refinement when another worktree changed
 * one. Spec 001 D10, as the coordinator put it: the timer never keeps the
 * process alive or delays an exit, stops with the others, and what it queues
 * is no activity that holds off the idle exit.
 */

const WT = "0123456789abcdef";
const PROJECT: NodeTestProject = {
  name: "unit",
  argv: [],
  env: {},
  include: ["test/*.test.mjs"],
};

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

interface Timed {
  readonly store: Store;
  readonly shutdowns: DaemonExitReason[];
  /** Calls of `observedChanged`. */
  readonly changed: () => number;
  /** `observedChanged` answers this: false while no scheduler takes it. */
  accept: boolean;
  advance(ms: number): void;
  stop(): void;
}

function timed(
  options: { projects?: readonly NodeTestProject[]; store?: Store; seen?: ObservedSeen } = {},
): Timed {
  const commonDir = fakeCommonDir();
  const store = options.store ?? open(commonDir);
  mkdirSync(storePaths(commonDir).locksDir, { recursive: true });
  let clock = 1_000_000;
  let changed = 0;
  const shutdowns: DaemonExitReason[] = [];
  const t: Timed = {
    store,
    shutdowns,
    changed: () => changed,
    accept: true,
    advance: (ms) => {
      clock += ms;
    },
    stop: () => {},
  };
  const startedAt = clock;
  const stop = startTimers({
    root: dirname(commonDir),
    worktreeId: WT,
    commonDir,
    store,
    policy: {
      ...DEFAULT_POLICY,
      daemon: { ...DEFAULT_POLICY.daemon, idleExitMinutes: 1 },
      nodeTest: options.projects ?? [PROJECT],
    },
    now: () => clock,
    linkedDir: null,
    timings: { checkMs: 10, presenceMs: 10, observedMs: 10 },
    heartbeatMs: 60 * 60_000,
    presence: { since: clock, lastPresentAt: null },
    lastActive: () => startedAt,
    active: () => {
      throw new Error("no activity is expected");
    },
    ...(options.seen ? { observedSeen: options.seen } : {}),
    observedChanged: () => {
      if (t.accept) changed += 1;
      return t.accept;
    },
    note: () => {},
    log: () => {},
    shutdown: (reason) => shutdowns.push(reason),
  });
  stops.push(stop);
  t.stop = stop;
  return t;
}

const observe = (store: Store, value: object) =>
  store.meta.set(nodeTestObservedMetaKey(PROJECT.name), JSON.stringify(value));

describe("observed timer (task 003-26)", () => {
  it("asks nothing while no observed key changes", async () => {
    const t = timed();
    await delay(150);
    expect(t.changed()).toBe(0);
  });

  it("asks once per change of either key, and keeps asking until it is taken", async () => {
    const t = timed();
    await delay(60);
    expect(t.changed()).toBe(0);
    observe(t.store, { "test/a.test.mjs": ["src/hidden.mjs"] });
    await waitFor(() => t.changed() === 1, 2_000, "the observed change");
    t.store.meta.set(nodeTestObservedPreloadsMetaKey(PROJECT.name), '["scripts/x.mjs"]');
    await waitFor(() => t.changed() === 2, 2_000, "the preload change");
    await delay(60);
    expect(t.changed()).toBe(2);
    // No scheduler yet: the change stays unread until one takes it.
    t.accept = false;
    observe(t.store, { "test/a.test.mjs": ["src/hidden.mjs", "src/more.mjs"] });
    await delay(60);
    t.accept = true;
    await waitFor(() => t.changed() === 3, 2_000, "the change taken");
  });

  it("is not activity: the idle exit comes on time while changes keep arriving", async () => {
    const t = timed();
    for (let i = 0; i < 6; i += 1) {
      observe(t.store, { "test/a.test.mjs": [`src/${i}.mjs`] });
      await waitFor(() => t.changed() === i + 1, 2_000, `change ${i}`);
      t.advance(9_000);
    }
    expect(t.shutdowns).toEqual([]);
    t.advance(6_000);
    await waitFor(() => t.shutdowns.length > 0, 2_000, "the idle exit");
    expect(t.shutdowns).toEqual(["idle"]);
  });

  it("notices a change written between its last tick and a restart (task 003-42)", async () => {
    // The daemon keeps the snapshot, so a policy reload's new timer starts from it.
    const seen: ObservedSeen = {};
    const before = timed({ seen });
    await delay(60);
    before.stop();
    expect(before.changed()).toBe(0);
    observe(before.store, { "test/a.test.mjs": ["src/hidden.mjs"] });
    const after = timed({ store: before.store, seen });
    await waitFor(() => after.changed() === 1, 2_000, "the change written before the reload");
    await delay(60);
    expect(after.changed()).toBe(1);
  });

  it("stops with the other timers, and has none without a node:test project", async () => {
    const t = timed();
    t.stop();
    observe(t.store, { "test/a.test.mjs": ["src/hidden.mjs"] });
    await delay(60);
    expect(t.changed()).toBe(0);

    const none = timed({ projects: [] });
    observe(none.store, { "test/a.test.mjs": ["src/hidden.mjs"] });
    await delay(60);
    expect(none.changed()).toBe(0);
  });
});
