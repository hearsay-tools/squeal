import { describe, expect, it, vi } from "vitest";
import { waitForStatus } from "../../src/cli/status-wait.js";
import type { readHeader as ReadHeader } from "../../src/core/delivery/index.js";
import { buildSnapshot, readStatus } from "../../src/core/status/index.js";
import {
  isStoreOpenFailure,
  type openStore as OpenStore,
  openStore,
} from "../../src/core/store/index.js";
import type { StatusHeader, Store } from "../../src/core/types/index.js";
import { runHook } from "../../src/harness/claude-code/index.js";
import { recorded, squealRepo } from "../harness/helpers.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "./helpers.js";

/*
 * Lessons defect 23, task 001-116: a status read is one committed state of the
 * store. Every store the code under test opens runs `afterRead` once, right
 * after its next read of known states or test-file keys, so a test commits a
 * revision with its re-key between two reads of one status read.
 */

const hooks = vi.hoisted(() => ({
  afterRead: null as (() => void) | null,
  /** Becomes `afterRead` when the `--wait` or Stop poll next reads the header. */
  atPoll: null as (() => void) | null,
  headers: [] as StatusHeader[],
}));

function fire(): void {
  const hook = hooks.afterRead;
  hooks.afterRead = null;
  hook?.();
}

vi.mock("../../src/core/store/index.js", async (importOriginal) => {
  const original = await importOriginal<{ openStore: typeof OpenStore }>();
  const openStore: typeof OpenStore = (commonDir, options) => {
    const opened = original.openStore(commonDir, options);
    if (!("knownStates" in opened)) return opened;
    const store = opened as { -readonly [K in keyof Store]: Store[K] };
    const { knownStates, testFileKeys } = store;
    store.knownStates = { ...knownStates, list: (id) => after(knownStates.list(id)) };
    store.testFileKeys = { ...testFileKeys, list: (id) => after(testFileKeys.list(id)) };
    return store;
  };
  const after = <T>(value: T): T => {
    fire();
    return value;
  };
  return { ...original, openStore };
});

vi.mock("../../src/core/delivery/index.js", async (importOriginal) => {
  const original = await importOriginal<{ readHeader: typeof ReadHeader }>();
  const readHeader: typeof ReadHeader = (...args) => {
    hooks.afterRead ??= hooks.atPoll;
    hooks.atPoll = null;
    const header = original.readHeader(...args);
    hooks.headers.push(header);
    return header;
  };
  return { ...original, readHeader };
});

const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
const ADDS = check("src/a.test.ts", "adds");

/** Revision 3 with `adds` passing and a live daemon; `edit` commits revision 4 with `adds` pending. */
function calmRepo() {
  const repo = fakeRepo();
  const store = seedStore(repo);
  const id = repo.mainId;
  store.worktrees.upsert({
    id,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: {
      socketPath: "/tmp/squeal-test.sock",
      startedAt: NOW - 60_000,
      heartbeatAt: NOW - 1_000,
      heartbeatIntervalMs: 5_000,
      squealVersion: "0.0.0-test",
    },
  });
  appendRevisions(store, id, 3, { head: null, dirty: false });
  store.knownStates.upsertMany([state(id, ADDS, { observedAt: 3 })]);
  const edit = () =>
    store.transaction(() => {
      store.revisions.append({
        worktreeId: id,
        createdAt: 4,
        head: null,
        dirty: true,
        trigger: "watch",
        changes: [{ path: "src/a.ts", oldHash: "h3", newHash: "h4" }],
      });
      store.knownStates.upsertMany([
        state(id, ADDS, { validity: "pending", pendingPhase: "queued", observedAt: 3 }),
      ]);
    });
  return { repo, store, edit };
}

describe("status reads see one committed state (lessons defect 23)", () => {
  it("a snapshot never pairs the new revision with the previous states", () => {
    const { repo, edit } = calmRepo();
    hooks.afterRead = edit;

    const status = readStatus(repo.main, { now: () => NOW });

    expect(hooks.afterRead).toBeNull();
    expect(status).toMatchObject({ revision: 3, counts: { pending: 0, current: 1 } });
    expect(readStatus(repo.main, { now: () => NOW })).toMatchObject({
      revision: 4,
      counts: { pending: 1, current: 0 },
    });
  });

  it("a snapshot built from a wrapped store, as the e2e probe builds it, is one read too", () => {
    const { repo, edit } = calmRepo();
    const opened = openStore(repo.commonDir, { create: false });
    if (isStoreOpenFailure(opened)) throw new Error(opened.reason);
    const wrapped = new Proxy(opened, {});
    hooks.afterRead = edit;

    const status = buildSnapshot(wrapped, repo.main, NOW);

    opened.close();
    expect(hooks.afterRead).toBeNull();
    expect(status).toMatchObject({ revision: 3, counts: { pending: 0, current: 1 } });
  });

  it("a --wait poll that ends on quiet returns the snapshot it judged", async () => {
    const { repo, edit } = calmRepo();
    hooks.atPoll = edit;

    // No daemon can sync, so the first poll may decide quiet (lessons, defect 30).
    const sync = () => ({ current: () => ({ state: "unsupported" }) as const, stop: () => {} });
    const wait = await waitForStatus(repo.main, {
      timeoutMs: 2_000,
      settleMs: 0,
      now: () => NOW,
      sync,
    });

    expect(hooks.atPoll).toBeNull();
    expect(hooks.afterRead).toBeNull();
    expect(wait.outcome).toBe("quiet");
    expect(wait.result).toMatchObject({ revision: 3, counts: { pending: 0 } });
  });

  it("Stop's poll reads the header of one revision", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    await runHook("session-start", recorded("session-start", r.root), {
      env: {},
      ensureDaemon: async () => "alive",
    });
    r.policy({ stop: { waitMs: 300 } });
    hooks.headers.length = 0;
    hooks.atPoll = () => r.store.transaction(() => r.queue("k2"));

    await runHook("stop", recorded("stop", r.root), { env: {}, ensureDaemon: async () => "alive" });

    expect(hooks.atPoll).toBeNull();
    expect(hooks.afterRead).toBeNull();
    const [poll] = hooks.headers;
    expect(poll).toMatchObject({ revision: 1, counts: { pending: 0, current: 1 } });
  });
});
