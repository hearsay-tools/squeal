import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, type PolicyFile } from "../../../src/core/types/policy.js";
import {
  type AntigravityHookName,
  runAntigravityHook,
} from "../../../src/harness/antigravity/hooks.js";
import type { HookDeps } from "../../../src/harness/shared/hook.js";
import { FILE, type SquealRepo, SUBTRACTS, squealRepo } from "../helpers.js";
import { landSlow, SLOW_FILE, deps as slowDeps, slowKey, turnOf } from "../stop-slow-helpers.js";
import { antigravityRecorded, injected } from "./helpers.js";

/*
 * Spec 024 goal 4 and D3's Stop: the abort and `fullyIdle: false` guards,
 * the continuation loop guard, and the sequential `stop` then `stop-slow`.
 */

const deps: HookDeps = slowDeps;
const hook = (r: SquealRepo, name: AntigravityHookName, fixture: string, overrides: object = {}) =>
  runAntigravityHook(name, antigravityRecorded(fixture, r.root, overrides), deps);

const decision = (out: { stdout: string }) =>
  out.stdout === "" ? {} : (JSON.parse(out.stdout) as { decision?: string; reason?: string });

/** Registered with both checks passing and a turn started, under `stop`. */
async function inTurn(stop: NonNullable<PolicyFile["stop"]> = {}): Promise<SquealRepo> {
  const r = squealRepo();
  r.policy({ slow: { ...DEFAULT_POLICY.slow, include: [SLOW_FILE.path, FILE.path] }, stop });
  r.apply(r.pass(), r.pass(SUBTRACTS));
  await hook(r, "session-start", "session-start");
  await hook(r, "pre-invocation", "pre-invocation-first");
  return r;
}

/** In a turn under `stop.requireSlowSuite`, an edit at revision 2 with the slow file queued. */
async function slowQueued(): Promise<SquealRepo> {
  const r = await inTurn({ requireSlowSuite: true });
  r.apply(r.pass(), r.pass(SUBTRACTS));
  slowKey(r, "queued");
  return r;
}

const FAILS =
  /^Squeal policy stop.requireSlowSuite is on and the slow tier ran at revision 2: 1 check fails: test\/e2e\/slow.test.ts > ledger > posts\.\n\n/;

describe("stop (goal 4)", () => {
  it("is silent and ends the turn with nothing to say", async () => {
    const r = await inTurn();
    expect(await hook(r, "stop", "stop")).toEqual({ stdout: "", stderr: "" });
    expect(turnOf(r)).toBe("idle");
  });

  it("continues the turn with news", async () => {
    const r = await inTurn();
    r.apply(r.fail(), r.pass(SUBTRACTS));
    expect(decision(await hook(r, "stop", "stop"))).toEqual({
      decision: "continue",
      reason: expect.stringMatching(
        /^SQUEAL · 1 check changed \(1 test\) at revision 2\n[\s\S]*PASS -> FAIL/,
      ),
    });
    expect(turnOf(r)).toBe("in-turn");
  });

  it.each([
    ["executionNum 1", "stop-continued", {}],
    ["continuationActive", "stop", { continuationActive: true }],
  ])("never continues again after a continuation (%s)", async (_, fixture, overrides) => {
    const r = await inTurn({ blockOnKnownFailures: true });
    r.apply(r.fail(), r.pass(SUBTRACTS));
    const first = decision(await hook(r, "stop", "stop"));
    expect(first.reason).toMatch(/^Squeal policy stop.blockOnKnownFailures is on/);
    r.apply(r.fail(), r.fail(SUBTRACTS));
    expect(decision(await hook(r, "stop", fixture, overrides))).toEqual({});
    expect(turnOf(r)).toBe("idle");
    // What it did not say waits for the next prompt.
    const prompt = await hook(r, "pre-invocation", "pre-invocation-first");
    expect(injected(prompt)).toContain("math > subtracts");
  });
});

describe("the Stop guards (D3)", () => {
  it.each(["stop-user-canceled", "stop-not-idle"])(
    "%s: stop ends the turn silently and keeps the news for the next prompt",
    async (fixture) => {
      const r = await inTurn({ blockOnKnownFailures: true });
      r.apply(r.fail(), r.pass(SUBTRACTS));
      expect(decision(await hook(r, "stop", fixture))).toEqual({});
      expect(turnOf(r)).toBe("idle");
      const prompt = await hook(r, "pre-invocation", "pre-invocation-first");
      expect(injected(prompt)).toContain("PASS -> FAIL");
    },
  );

  it.each(["stop-user-canceled", "stop-not-idle"])(
    "%s: stop hands nothing over, and stop-slow holds nothing, at once",
    async (fixture) => {
      const r = await slowQueued();
      expect(decision(await hook(r, "stop", fixture))).toEqual({});
      landSlow(r, "fail");
      const started = performance.now();
      expect(decision(await hook(r, "stop-slow", fixture))).toEqual({});
      expect(performance.now() - started).toBeLessThan(500);
      expect(turnOf(r)).toBe("idle");
    },
  );
});

describe("stop then stop-slow (D3)", () => {
  it("a silent stop hands the slow checks over, and stop-slow continues on their failure", async () => {
    const r = await slowQueued();
    expect(decision(await hook(r, "stop", "stop"))).toEqual({});
    landSlow(r, "fail");
    const waiting = decision(await hook(r, "stop-slow", "stop"));
    expect(waiting.decision).toBe("continue");
    expect(waiting.reason).toMatch(FAILS);
    expect(turnOf(r)).toBe("in-turn");
  });

  it("stop-slow is silent once they pass", async () => {
    const r = await slowQueued();
    expect(decision(await hook(r, "stop", "stop"))).toEqual({});
    landSlow(r, "pass");
    expect(decision(await hook(r, "stop-slow", "stop"))).toEqual({});
    expect(turnOf(r)).toBe("idle");
  });
});
