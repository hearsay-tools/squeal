import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnsureDaemonResult } from "../../src/core/types/daemon.js";
import type { HookContext } from "../../src/harness/shared/context.js";
import { ensure } from "../../src/harness/shared/ensure.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { NOW, type Stored, scratch, VERSION } from "./fixture.js";

/*
 * Review 0.1.403 B1 (row 011-293): the hook's stop check holds no stop while
 * the recorded daemon's heartbeat is fresh, as before the move: a daemon
 * spawned in the stop's window validates (C9, `--until-start`), and the hook
 * goes on to ensure it. With the heartbeat stale, the stop holds as before.
 */

const releases: (() => void)[] = [];
afterEach(() => {
  for (const release of releases.splice(0)) release();
});

/** The hook's `ensure` over `stored`, as a hook of the recorded daemon's version runs it. */
async function ensureBeside(stored: Stored) {
  const { store, id, root, commonDir, release } = scratch(stored);
  releases.push(release);
  const ensureDaemon = vi.fn(async (): Promise<EnsureDaemonResult> => "alive");
  const deps: HookDeps = { env: {}, now: () => NOW, squealVersion: VERSION, ensureDaemon };
  const context = {
    root,
    commonDir,
    store,
    consumer: { worktreeId: id, sessionId: "s1", agentId: "main" },
    close: () => {},
  } as unknown as HookContext;
  const result = await ensure({ root, commonDir }, deps, context);
  return { result, calls: ensureDaemon.mock.calls.length };
}

describe("the hook's stop check beside a fresh heartbeat (review 0.1.403 B1)", () => {
  it.each([
    ["`--until-start`, written before the heartbeat", { at: -30_000, untilStart: true }],
    ["`--until-start`, written after the heartbeat", { at: -1_000, untilStart: true }],
    ["a plain stop, written before the heartbeat", { at: -30_000 }],
    ["a plain stop, written after the heartbeat", { at: -1_000 }],
  ] as const)("with %s, ensures the daemon", async (_name, stop) => {
    expect(await ensureBeside({ heartbeat: -2_000, stop })).toEqual({ result: "alive", calls: 1 });
  });

  it("with the heartbeat stale, the stop until start holds and nothing is ensured", async () => {
    const stop = { at: -11_000, untilStart: true } as const;
    expect(await ensureBeside({ heartbeat: -12_000, stop })).toEqual({
      result: "stopped",
      calls: 0,
    });
  });
});
