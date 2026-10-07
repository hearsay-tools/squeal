import { describe, expect, it } from "vitest";
import { createDelivery, formatDelta, formatRegistration } from "../../src/core/delivery/index.js";
import { createStatusBuilder } from "../../src/core/status/index.js";
import { REGRESSION_KINDS } from "../../src/core/types/index.js";
import { type HookDeps, type HookResult, runHook } from "../../src/harness/claude-code/index.js";
import { PRIMER } from "../../src/harness/shared/primer.js";
import { ADDS, recorded, type SquealRepo, SUBAGENT, SUBTRACTS, squealRepo } from "./helpers.js";

const SILENT: HookResult = { stdout: "", stderr: "", exitCode: 0 };

function deps(overrides: Partial<HookDeps> = {}): HookDeps {
  return { env: {}, ensureDaemon: async () => "alive", ...overrides };
}

const json = (result: HookResult): unknown => JSON.parse(result.stdout);

/** The text a fresh delivery over the same store renders, for comparing hook output exactly. */
function delivery(r: SquealRepo) {
  return createDelivery(r.store, { status: createStatusBuilder(r.store) });
}

describe("SessionStart and SubagentStart", () => {
  it("ensures the daemon, registers the consumer and injects the registration", async () => {
    const r = squealRepo();
    r.apply(r.fail(SUBTRACTS), r.pass());
    const ensured: string[] = [];
    const out = await runHook(
      "session-start",
      recorded("session-start", r.root),
      deps({
        cli: "/plugin/dist/cli/squeal.mjs",
        ensureDaemon: async (root, { socketTimeoutMs, cli }) => {
          ensured.push(`${root} ${socketTimeoutMs} ${cli}`);
          return "alive";
        },
      }),
    );

    expect(ensured).toEqual([`${r.root} 100 /plugin/dist/cli/squeal.mjs`]);
    expect(r.store.consumers.get(r.consumer())).not.toBeNull();
    const registration = await delivery(r).register(r.consumer());
    expect(json(out)).toEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: `${formatRegistration(registration)}\n\n${PRIMER}`,
      },
    });
    expect(out.exitCode).toBe(0);
    expect(formatRegistration(registration)).toContain("Known failures: 1");
  });

  it("registers a subagent as its own consumer", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    const out = await runHook("session-start", recorded("subagent-start", r.root), deps());

    expect(json(out)).toMatchObject({ hookSpecificOutput: { hookEventName: "SubagentStart" } });
    expect(r.store.consumers.get(r.consumer(SUBAGENT))).not.toBeNull();
    expect(r.store.consumers.get(r.consumer())).toBeNull();
  });

  it("does not ensure a daemon in a repository without a store or squeal.config.json", async () => {
    const r = squealRepo();
    r.store.close();
    const { rmSync } = await import("node:fs");
    rmSync(`${r.repo.commonDir}/squeal`, { recursive: true });
    let ensured = 0;
    const out = await runHook(
      "session-start",
      recorded("session-start", r.root),
      deps({
        ensureDaemon: async () => {
          ensured++;
          return "spawned";
        },
      }),
    );
    expect(out).toEqual(SILENT);
    expect(ensured).toBe(0);
  });
});

describe("PostToolBatch", () => {
  it("injects the delta once and is silent when nothing changed", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    await runHook("session-start", recorded("session-start", r.root), deps());
    r.apply(r.fail());

    const first = await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps());
    const second = await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps());

    expect(json(first)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PostToolBatch",
        additionalContext: expect.stringContaining("PASS -> FAIL"),
      },
    });
    const text = (json(first) as { hookSpecificOutput: { additionalContext: string } })
      .hookSpecificOutput.additionalContext;
    expect(text).toMatch(/^SQUEAL · 1 check changed at revision 2\n/);
    expect(text).toContain("FAIL  src/math.test.ts > math > adds");
    expect(second).toEqual(SILENT);
  });

  it("delivers to the subagent consumer apart from the main agent", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    await runHook("session-start", recorded("session-start", r.root), deps());
    await runHook("session-start", recorded("subagent-start", r.root), deps());
    r.apply(r.fail());

    const sub = await runHook(
      "post-tool-batch",
      recorded("subagent-post-tool-batch", r.root),
      deps(),
    );
    const main = await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps());

    expect(sub.stdout).toContain("PASS -> FAIL");
    expect(main.stdout).toContain("PASS -> FAIL");
  });

  it("registers a consumer that has no registration and injects the registration", async () => {
    const r = squealRepo();
    r.apply(r.fail());
    const out = await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps());

    expect(r.store.consumers.get(r.consumer())).not.toBeNull();
    expect(json(out)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PostToolBatch",
        additionalContext: expect.stringMatching(/^SQUEAL · registered at revision 1\n/),
      },
    });
  });
});

describe("PreToolUse", () => {
  async function regressed() {
    const r = squealRepo();
    r.apply(r.pass(), r.fail(SUBTRACTS));
    await runHook("session-start", recorded("session-start", r.root), deps());
    r.apply(r.fail(), r.pass(SUBTRACTS));
    return r;
  }

  it("denies an edit once per undelivered regression with a factual reason", async () => {
    const r = await regressed();
    const peeked = await delivery(r).peek(r.consumer(), { kinds: REGRESSION_KINDS });
    expect(peeked).not.toBeNull();
    // Peeking above marked the regression delivered; put the view back as it was.
    r.store.views.writeMany(r.consumer(), [
      { check: ADDS, outcome: "pass", fingerprint: null, toldAt: 1 },
    ]);
    if (peeked === null) return;

    const deny = await runHook("pre-tool-use", recorded("pre-tool-use", r.root), deps());
    const again = await runHook("pre-tool-use", recorded("pre-tool-use", r.root), deps());

    expect(json(deny)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `${formatDelta(peeked)}\n\nSqueal policy interrupt.onRegression denied this Edit call, so the edit was not applied. The same call can be re-issued; this regression does not deny again.`,
      },
    });
    expect(again).toEqual(SILENT);
  });

  it("leaves recoveries for the next delivery", async () => {
    const r = await regressed();
    await runHook("pre-tool-use", recorded("pre-tool-use", r.root), deps());

    const batch = await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps());
    expect(batch.stdout).toContain("FAIL -> PASS");
    expect(batch.stdout).not.toContain("PASS -> FAIL");
  });

  it("never denies on a recovery", async () => {
    const r = squealRepo();
    r.apply(r.fail());
    await runHook("session-start", recorded("session-start", r.root), deps());
    r.apply(r.pass());
    expect(await runHook("pre-tool-use", recorded("pre-tool-use", r.root), deps())).toEqual(SILENT);
  });

  it("allows every edit when interrupt.onRegression is off", async () => {
    const r = await regressed();
    r.policy({ interrupt: { onRegression: false } });
    expect(await runHook("pre-tool-use", recorded("pre-tool-use", r.root), deps())).toEqual(SILENT);
    const batch = await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps());
    expect(batch.stdout).toContain("PASS -> FAIL");
  });
});

describe("Stop and SubagentStop", () => {
  it("is silent when nothing changed, because Stop context keeps the turn going", async () => {
    const r = squealRepo();
    r.apply(r.pass(), r.fail(SUBTRACTS));
    await runHook("session-start", recorded("session-start", r.root), deps());

    expect(await runHook("stop", recorded("stop", r.root), deps())).toEqual(SILENT);
  });

  it("registers an unregistered consumer and speaks only when it has known failures", async () => {
    const quiet = squealRepo();
    quiet.apply(quiet.pass());
    expect(await runHook("stop", recorded("stop", quiet.root), deps())).toEqual(SILENT);
    expect(quiet.store.consumers.get(quiet.consumer())).not.toBeNull();

    const failing = squealRepo();
    failing.apply(failing.fail());
    const out = await runHook("stop", recorded("stop", failing.root), deps());
    expect(json(out)).toEqual({
      hookSpecificOutput: {
        hookEventName: "Stop",
        additionalContext: expect.stringMatching(
          /^SQUEAL · registered at revision 1\n[\s\S]*Known failures: 1/,
        ),
      },
    });
  });

  it("delivers the delta with its header", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    await runHook("session-start", recorded("session-start", r.root), deps());
    r.apply(r.fail());

    const out = await runHook("stop", recorded("stop", r.root), deps());
    const text = (json(out) as { hookSpecificOutput: { additionalContext: string } })
      .hookSpecificOutput.additionalContext;
    expect(text).toMatch(
      /^SQUEAL · 1 check changed at revision 2\nRevision 2 \(changed src\/math\.ts\): /,
    );
    expect(text).toContain("PASS -> FAIL");
    expect(text).toMatch(/\nKnown failures: 1$/);
  });

  it("blocks on known failures when stop.blockOnKnownFailures is on", async () => {
    const r = squealRepo();
    r.apply(r.pass(), r.fail(SUBTRACTS));
    await runHook("session-start", recorded("session-start", r.root), deps());
    r.policy({ stop: { blockOnKnownFailures: true } });

    const out = await runHook("stop", recorded("stop", r.root), deps());

    expect(json(out)).toEqual({
      decision: "block",
      reason:
        "Squeal policy stop.blockOnKnownFailures is on and 1 known failure exists at revision 1: src/math.test.ts > math > subtracts.\n\n" +
        "SQUEAL · status at revision 1\n" +
        "Revision 1 (changed src/math.ts): 2 current, 0 pending, 0 stale, 0 unknown. Full-suite checkpoint: none completed at any revision.\n" +
        "Known failures: 1",
    });
  });

  it("blocks without a full suite at this revision when stop.requireFullSuite is on", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    await runHook("session-start", recorded("session-start", r.root), deps());
    await runHook("session-start", recorded("subagent-start", r.root), deps());
    r.policy({ stop: { requireFullSuite: true } });

    const out = await runHook("stop", recorded("subagent-stop", r.root), deps());

    expect(json(out)).toMatchObject({
      decision: "block",
      reason: expect.stringMatching(
        /^Squeal policy stop.requireFullSuite is on and no full-suite checkpoint completed at revision 1; none completed at any revision. `squeal run --all` starts one.\n\n/,
      ),
    });
  });

  it("does not block while a block already keeps the agent going (stop_hook_active)", async () => {
    const r = squealRepo();
    r.apply(r.fail());
    await runHook("session-start", recorded("session-start", r.root), deps());
    r.policy({ stop: { blockOnKnownFailures: true } });

    const out = await runHook("stop", recorded("stop", r.root, { stop_hook_active: true }), deps());
    expect(out).toEqual(SILENT);

    r.apply(r.fail(ADDS, "a different failure"));
    const changed = await runHook(
      "stop",
      recorded("stop", r.root, { stop_hook_active: true }),
      deps(),
    );
    expect(json(changed)).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "Stop",
        additionalContext: expect.stringContaining("FAIL -> FAIL, failure changed"),
      },
    });
  });

  it("waits up to stop.waitMs for pending checks of the current revision", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    await runHook("session-start", recorded("session-start", r.root), deps());
    r.policy({ stop: { waitMs: 1_000 } });
    r.store.testFileKeys.upsertMany([
      { worktreeId: r.worktreeId, testFile: FILE_REF, key: "k2", revision: 2, pending: "running" },
    ]);
    r.sink.refresh(r.worktreeId, 1, { checkpointId: null });
    setTimeout(() => {
      r.store.testFileKeys.upsertMany([
        { worktreeId: r.worktreeId, testFile: FILE_REF, key: "k1", revision: 2, pending: null },
      ]);
      r.apply(r.fail());
    }, 300);

    const started = performance.now();
    const out = await runHook("stop", recorded("stop", r.root), deps());
    const waited = performance.now() - started;

    expect(waited).toBeGreaterThanOrEqual(250);
    expect(waited).toBeLessThan(1_000);
    expect(out.stdout).toContain("1 current, 0 pending");
    expect(out.stdout).toContain("PASS -> FAIL");
  });
});

const FILE_REF = { project: "", path: "src/math.test.ts" };

describe("SessionEnd", () => {
  it("unregisters every consumer of the session in this worktree", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    await runHook("session-start", recorded("session-start", r.root), deps());
    await runHook("session-start", recorded("subagent-start", r.root), deps());

    const out = await runHook("session-end", recorded("session-end", r.root), deps());

    expect(out).toEqual(SILENT);
    expect(r.store.consumers.list(r.worktreeId)).toEqual([]);
  });
});

describe("any event", () => {
  it.each(["not json", "{}", '{"session_id": 5}'])(
    "exits 0 silently on malformed input %s",
    async (input) => {
      expect(await runHook("post-tool-batch", input, deps())).toEqual(SILENT);
    },
  );

  it("exits 0 silently when a dependency throws", async () => {
    const r = squealRepo();
    const out = await runHook(
      "session-start",
      recorded("session-start", r.root),
      deps({
        ensureDaemon: async () => {
          throw new Error("boom");
        },
      }),
    );
    expect(out).toEqual(SILENT);
  });
});
