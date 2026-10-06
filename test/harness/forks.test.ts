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
});
