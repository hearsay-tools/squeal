import { describe, expect, it, vi } from "vitest";
import type { openStore as OpenStore } from "../../src/core/store/index.js";
import { DEFAULT_POLICY, type Store } from "../../src/core/types/index.js";
import { runHook } from "../../src/harness/claude-code/index.js";
import { runCodexHook } from "../../src/harness/codex/index.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { codexRecorded } from "./codex/helpers.js";
import { FILE, recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Spec 004 D7, review wave 2 B3: `stop.requireSlowSuite` decides on one
 * snapshot. Every store a hook opens runs `afterRead` once, right after its
 * `n`-th read of known states or test-file keys outside a write transaction,
 * where the test commits the daemon's next revision from its own connection:
 * the slow file queued under a new key, its check pending. Whatever read the
 * commit follows, Stop blocks at that revision, never ending the turn on the
 * old revision's current states beside the new queued key.
 */

const hooks = vi.hoisted(() => ({
  /** The read after which `afterRead` runs, counted from 1; `null` counts only. */
  at: null as number | null,
  reads: 0,
  afterRead: null as (() => void) | null,
}));

vi.mock("../../src/core/store/index.js", async (importOriginal) => {
  const original = await importOriginal<{ openStore: typeof OpenStore }>();
  const openStore: typeof OpenStore = (commonDir, options) => {
    const opened = original.openStore(commonDir, options);
    if (!("knownStates" in opened)) return opened;
    const store = opened as { -readonly [K in keyof Store]: Store[K] };
    const { knownStates, testFileKeys, transaction } = store;
    let writing = 0;
    const after = <T>(value: T): T => {
      if (writing > 0) return value;
      hooks.reads += 1;
      if (hooks.reads === hooks.at) hooks.afterRead?.();
      return value;
    };
    store.transaction = (fn) => {
      writing += 1;
      try {
        return transaction(fn);
      } finally {
        writing -= 1;
      }
    };
    store.knownStates = { ...knownStates, list: (id) => after(knownStates.list(id)) };
    store.testFileKeys = { ...testFileKeys, list: (id) => after(testFileKeys.list(id)) };
    return store;
  };
  return { ...original, openStore };
});

const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive" };

interface Harness {
  readonly name: string;
  startTurn(r: SquealRepo): Promise<void>;
  stop(r: SquealRepo, overrides?: object): Promise<{ readonly stdout: string }>;
}

const HARNESSES: readonly Harness[] = [
  {
    name: "claude-code",
    async startTurn(r) {
      await runHook("session-start", recorded("session-start", r.root), deps);
      await runHook("user-prompt-submit", recorded("user-prompt-submit", r.root), deps);
    },
    stop: (r, overrides) => runHook("stop", recorded("stop", r.root, overrides), deps),
  },
  {
    name: "codex",
    async startTurn(r) {
      await runCodexHook("session-start", codexRecorded("exec", "session-start", r.root), deps);
      await runCodexHook(
        "user-prompt-submit",
        codexRecorded("exec", "user-prompt-submit", r.root),
        deps,
      );
    },
    stop: (r, overrides) =>
      runCodexHook("stop", codexRecorded("exec", "stop", r.root, overrides), deps),
  },
];

/** `FILE` is the slow tier, its one check passing and current at revision 1; the agent is in a turn. */
async function repo(harness: Harness): Promise<SquealRepo> {
  hooks.at = null;
  hooks.afterRead = null;
  const r = squealRepo();
  r.apply(r.pass());
  r.policy({
    slow: { ...DEFAULT_POLICY.slow, include: [FILE.path] },
    stop: { waitMs: 0, requireSlowSuite: true },
  });
  await harness.startTurn(r);
  return r;
}

function decision(stdout: string): { decision?: string; reason?: string } {
  return stdout.trim() === "" ? {} : (JSON.parse(stdout) as { decision?: string });
}

/** The reads one Stop makes outside write transactions, from a run with no commit. */
async function readsOfOneStop(harness: Harness): Promise<number> {
  const r = await repo(harness);
  hooks.reads = 0;
  expect(decision((await harness.stop(r)).stdout).decision).toBeUndefined();
  return hooks.reads;
}

describe.each(HARNESSES)("stop.requireSlowSuite on one snapshot, $name (B3)", (harness) => {
  it("blocks at the new revision whichever read the daemon's commit follows", async () => {
    const reads = await readsOfOneStop(harness);
    expect(reads).toBeGreaterThan(1);
    for (let at = 1; at <= reads; at++) {
      const r = await repo(harness);
      hooks.reads = 0;
      hooks.at = at;
      hooks.afterRead = () => r.queue("k2");
      const out = decision((await harness.stop(r)).stdout);
      expect(hooks.reads, `read ${at}`).toBeGreaterThanOrEqual(at);
      expect(out.decision, `read ${at}`).toBe("block");
      expect(out.reason, `read ${at}`).toMatch(
        /^Squeal policy stop.requireSlowSuite is on and 1 slow test file is not current at revision 2: src\/math.test.ts\./,
      );
      r.store.close();
    }
  });

  it("never blocks again while an earlier block keeps the agent going (stop_hook_active)", async () => {
    const r = await repo(harness);
    r.queue("k2");
    expect(decision((await harness.stop(r)).stdout).decision).toBe("block");
    const again = await harness.stop(r, { stop_hook_active: true });
    expect(decision(again.stdout).decision).toBeUndefined();
  });
});
