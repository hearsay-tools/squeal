import { describe, expect, it } from "vitest";
import { readPolicy } from "../../../src/core/daemon/policy.js";
import { createDelivery } from "../../../src/core/delivery/delivery.js";
import type { CheckGroup } from "../../../src/core/types/check-groups.js";
import type { HookContext } from "../../../src/harness/shared/context.js";
import { stopRules, waitingEntryRecorded } from "../../../src/harness/shared/stop-decide.js";
import type { SquealRepo } from "../helpers.js";
import { deps, HARNESSES, mainConsumer, markStopWait, repo } from "../stop-slow-helpers.js";

/*
 * Spec 024 D3 and D5 (row 024-02): Antigravity runs its two Stop entries in
 * order, `stop` then `stop-slow`, and ships both in one plugin, so the
 * waiting entry always runs after a silent `stop` for the main agent. `stop`
 * hands it the open required checks with no record of it and no wait for one.
 */

const E2E: CheckGroup = { name: "e2e", runner: "vitest", tests: ["test/e2e/**"], at: "stop" };

/** A registered main agent in a turn, its slow file queued, and no waiting entry recorded. */
async function unmarked(): Promise<SquealRepo> {
  const [claude] = HARNESSES;
  if (claude === undefined) throw new Error("no harness");
  const r = await repo(claude, {}, false);
  r.policy({ checks: [E2E] });
  return r;
}

function contextOf(r: SquealRepo): HookContext {
  const status = {
    build: () => ({ schemaVersion: 1, available: false, reason: "timeout", message: "" }) as const,
  };
  return {
    root: r.root,
    commonDir: r.repo.commonDir,
    store: r.store,
    consumer: mainConsumer(r),
    delivery: createDelivery(r.store, { status }),
    write: async (work) => work(),
    sent: async () => {},
    close: () => {},
  };
}

describe("stopRules for Antigravity (spec 024 D3)", () => {
  it("leaves a main agent's open required checks to stop-slow with no record of it", async () => {
    const r = await unmarked();
    const project = readPolicy(r.root);
    const input = { stopHookActive: false, harness: "antigravity" } as const;
    const rules = stopRules(contextOf(r), project, input, deps);
    expect(rules.required).toBeNull();
    expect(rules.handoff).toBe(true);
    expect(rules.holds).not.toBeNull();
    // Claude Code without the record decides them itself.
    const claude = stopRules(contextOf(r), project, { ...input, harness: "claude-code" }, deps);
    expect(claude.required).not.toBeNull();
  });

  it("decides a subagent's required checks itself, as for every harness", async () => {
    const r = await unmarked();
    const context = { ...contextOf(r), consumer: { ...mainConsumer(r), agentId: "sub-1" } };
    const input = { stopHookActive: false, harness: "antigravity" } as const;
    expect(stopRules(context, readPolicy(r.root), input, deps).required).not.toBeNull();
  });
});

describe("waitingEntryRecorded for Antigravity (spec 024 D3)", () => {
  it("returns false at once, as for Pi, even with a record", async () => {
    const r = await unmarked();
    markStopWait(r, "antigravity");
    const started = performance.now();
    const deadline = started + 2_000;
    expect(await waitingEntryRecorded(contextOf(r), "antigravity", deps, deadline)).toBe(false);
    expect(performance.now() - started).toBeLessThan(100);
  });
});
