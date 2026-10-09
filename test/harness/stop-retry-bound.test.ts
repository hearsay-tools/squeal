import { describe, expect, it, vi } from "vitest";
import type { createDelivery as CreateDelivery } from "../../src/core/delivery/index.js";
import { DEFAULT_POLICY, type EndTurnOptions } from "../../src/core/types/index.js";
import { runHook } from "../../src/harness/claude-code/index.js";
import { runCodexHook } from "../../src/harness/codex/index.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { STOP_DECISIONS } from "../../src/harness/shared/stop.js";
import { codexRecorded } from "./codex/helpers.js";
import { FILE, recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Spec 004 D7, review wave 2.5 B2: every `endTurn` a blocking Stop makes is
 * conditioned on the revision it decided at, the last of its bounded retries
 * too. Right before each real `endTurn` the test commits the daemon's next
 * revision from its own connection: two unrelated edits, then the slow file
 * queued under a new key. Stop never ends the turn at a revision it did not
 * check; at its retry bound it blocks with a short reason.
 */

const hooks = vi.hoisted(() => ({
  calls: [] as (EndTurnOptions | undefined)[],
  before: null as ((call: number) => void) | null,
}));

vi.mock("../../src/core/delivery/index.js", async (importOriginal) => {
  const original = await importOriginal<{ createDelivery: typeof CreateDelivery }>();
  const createDelivery: typeof CreateDelivery = (store, options) => {
    const delivery = original.createDelivery(store, options);
    return {
      ...delivery,
      endTurn: (consumer, at) => {
        hooks.calls.push(at);
        hooks.before?.(hooks.calls.length);
        return delivery.endTurn(consumer, at);
      },
    };
  };
  return { ...original, createDelivery };
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
  hooks.calls = [];
  hooks.before = null;
  const r = squealRepo();
  r.apply(r.pass());
  r.policy({
    slow: { ...DEFAULT_POLICY.slow, include: [FILE.path] },
    stop: { waitMs: 0, requireSlowSuite: true },
  });
  await harness.startTurn(r);
  hooks.calls = [];
  return r;
}

function decision(stdout: string): { decision?: string; reason?: string } {
  return stdout.trim() === "" ? {} : (JSON.parse(stdout) as { decision?: string });
}

/** Before `endTurn` call `n`, what the daemon commits: `edits[n - 1]`, nothing past the list. */
function commits(r: SquealRepo, edits: readonly ("edit" | "queue")[]): void {
  hooks.before = (call) => {
    const edit = edits[call - 1];
    if (edit === "edit") r.apply();
    if (edit === "queue") r.queue("k2");
  };
}

describe.each(HARNESSES)("Stop's last retry keeps its revision guard, $name (B2)", (harness) => {
  it("blocks when the slow file is queued right before the last endTurn", async () => {
    expect(STOP_DECISIONS).toBe(3);
    const r = await repo(harness);
    commits(r, ["edit", "edit", "queue"]);
    const out = decision((await harness.stop(r)).stdout);
    expect(hooks.calls).toEqual([{ atRevision: 1 }, { atRevision: 2 }, { atRevision: 3 }]);
    expect(out.decision).toBe("block");
    expect(out.reason).toMatch(
      /^Squeal: the revision changed 3 times while Stop decided, now past revision 3; stop again to decide at the newest\./,
    );
    const turn = await harness.stop(r, { stop_hook_active: true });
    expect(decision(turn.stdout).decision).toBeUndefined();
    r.store.close();
  });

  it("ends the turn at the revision its third decision checked (control)", async () => {
    const r = await repo(harness);
    commits(r, ["edit", "edit"]);
    expect((await harness.stop(r)).stdout).toBe("");
    expect(hooks.calls).toEqual([{ atRevision: 1 }, { atRevision: 2 }, { atRevision: 3 }]);
    r.store.close();
  });

  it("blocks on the queued slow file a retry decides on (control)", async () => {
    const r = await repo(harness);
    commits(r, ["edit", "queue"]);
    const out = decision((await harness.stop(r)).stdout);
    expect(hooks.calls).toEqual([{ atRevision: 1 }, { atRevision: 2 }]);
    expect(out.reason).toMatch(
      /^Squeal policy stop.requireSlowSuite is on and 1 slow test file is not current at revision 3: src\/math.test.ts\./,
    );
    r.store.close();
  });

  it("never blocks at the bound while an earlier block keeps the agent going (stop_hook_active)", async () => {
    const r = await repo(harness);
    commits(r, ["edit", "edit", "queue"]);
    expect((await harness.stop(r, { stop_hook_active: true })).stdout).toBe("");
    expect(hooks.calls).toHaveLength(1);
    expect(hooks.calls[0]?.atRevision).toBeUndefined();
    r.store.close();
  });
});
