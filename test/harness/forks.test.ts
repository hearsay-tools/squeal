import { describe, expect, it } from "vitest";
import { type HookDeps, type HookResult, runHook } from "../../src/harness/claude-code/index.js";
import { recorded, type SquealRepo, SUBAGENT, squealRepo } from "./helpers.js";

/** The fork's agent id in the recorded fork inputs. */
const FORK = "a7d96bf482821c613";

const SILENT: HookResult = { stdout: "", stderr: "", exitCode: 0 };

/** Dependencies that count every daemon ensure. */
function counting(): { deps: HookDeps; ensured: () => number } {
  let calls = 0;
  return {
    deps: {
      env: {},
      ensureDaemon: async () => {
        calls++;
        return "alive";
      },
    },
    ensured: () => calls,
  };
}

/** Main agent registered, `stop.blockOnKnownFailures` on, one failure current. */
async function oneFailure(): Promise<SquealRepo> {
  const r = squealRepo();
  r.apply(r.fail());
  await runHook("session-start", recorded("session-start", r.root), counting().deps);
  r.policy({ stop: { blockOnKnownFailures: true } });
  return r;
}

describe("Claude Code's internal forks are not consumers (lessons, defect 9)", () => {
  it("SubagentStart of a fork registers nothing, ensures no daemon and says nothing", async () => {
    const r = await oneFailure();
    const { deps, ensured } = counting();

    const out = await runHook("session-start", recorded("subagent-start-fork", r.root), deps);

    expect(out).toEqual(SILENT);
    expect(ensured()).toBe(0);
    expect(r.store.consumers.get(r.consumer(FORK))).toBeNull();
  });

  it("SubagentStop of a fork never blocks, delivers nothing and registers nothing", async () => {
    const r = await oneFailure();
    await runHook("session-start", recorded("subagent-start-fork", r.root), counting().deps);
    const { deps, ensured } = counting();

    const out = await runHook("stop", recorded("subagent-stop-fork", r.root), deps);

    expect(out).toEqual(SILENT);
    expect(ensured()).toBe(0);
    expect(r.store.consumers.get(r.consumer(FORK))).toBeNull();
    expect(r.store.consumers.list(r.worktreeId).map((c) => c.consumer.agentId)).toEqual(["main"]);
  });

  it("SubagentStop of a fork unregisters a stale consumer of its agent id", async () => {
    const r = await oneFailure();
    // An older build registered the fork like a subagent and its block kept it going.
    await runHook(
      "session-start",
      recorded("subagent-start", r.root, { agent_id: FORK }),
      counting().deps,
    );
    expect(r.store.consumers.get(r.consumer(FORK))).not.toBeNull();

    const out = await runHook("stop", recorded("subagent-stop-fork", r.root), counting().deps);

    expect(out).toEqual(SILENT);
    expect(r.store.consumers.get(r.consumer(FORK))).toBeNull();
    expect(r.store.consumers.get(r.consumer())).not.toBeNull();
  });

  it("a subagent without an agent type is still blocked", async () => {
    const r = await oneFailure();
    const untyped = { agent_type: undefined };
    await runHook("session-start", recorded("subagent-start", r.root, untyped), counting().deps);

    const out = await runHook("stop", recorded("subagent-stop", r.root, untyped), counting().deps);

    expect(JSON.parse(out.stdout)).toMatchObject({ decision: "block" });
    expect(r.store.consumers.get(r.consumer(SUBAGENT))).not.toBeNull();
  });

  it("PostToolBatch and PreToolUse of a fork register nothing and say nothing (review wave 6, N4)", async () => {
    const r = await oneFailure();
    const fork = { agent_id: FORK, agent_type: "" };

    const batch = await runHook(
      "post-tool-batch",
      recorded("subagent-post-tool-batch", r.root, fork),
      counting().deps,
    );
    const edit = await runHook(
      "pre-tool-use",
      recorded("pre-tool-use", r.root, fork),
      counting().deps,
    );

    expect(batch).toEqual(SILENT);
    expect(edit).toEqual(SILENT);
    expect(r.store.consumers.get(r.consumer(FORK))).toBeNull();
  });

  it("PreToolUse of a fork never denies, even for a consumer an older build registered", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    await runHook(
      "session-start",
      recorded("subagent-start", r.root, { agent_id: FORK }),
      counting().deps,
    );
    r.apply(r.fail());

    const fork = { agent_id: FORK, agent_type: "" };
    const edit = await runHook(
      "pre-tool-use",
      recorded("pre-tool-use", r.root, fork),
      counting().deps,
    );

    expect(edit).toEqual(SILENT);
  });
});

/*
 * Review wave 6, S2: under `claude --agent <name>` a fork reports `<name>` as
 * its agent type. A real subagent is registered by SubagentStart or its first
 * PostToolBatch, so a SubagentStop with no registration is treated as a fork.
 */
describe("a SubagentStop that was never registered is a fork's (review wave 6, S2)", () => {
  const HELPER = { agent_type: "helper" };

  it("never blocks, says nothing, registers nothing and ensures no daemon", async () => {
    const r = await oneFailure();
    r.daemon("stale");
    const { deps, ensured } = counting();

    const out = await runHook("stop", recorded("subagent-stop", r.root, HELPER), deps);

    expect(out).toEqual(SILENT);
    expect(ensured()).toBe(0);
    expect(r.store.consumers.get(r.consumer(SUBAGENT))).toBeNull();
    expect(r.store.consumers.list(r.worktreeId).map((c) => c.consumer.agentId)).toEqual(["main"]);
  });

  it("a registered subagent of the same type is still blocked", async () => {
    const r = await oneFailure();
    await runHook("session-start", recorded("subagent-start", r.root, HELPER), counting().deps);

    const out = await runHook("stop", recorded("subagent-stop", r.root, HELPER), counting().deps);

    expect(JSON.parse(out.stdout)).toMatchObject({ decision: "block" });
    expect(r.store.consumers.get(r.consumer(SUBAGENT))).not.toBeNull();
  });

  it("a main agent's Stop with no registration still registers and is blocked", async () => {
    const r = squealRepo();
    r.apply(r.fail());
    r.policy({ stop: { blockOnKnownFailures: true } });

    const out = await runHook("stop", recorded("stop", r.root), counting().deps);

    expect(JSON.parse(out.stdout)).toMatchObject({ decision: "block" });
    expect(r.store.consumers.get(r.consumer())).not.toBeNull();
  });
});
