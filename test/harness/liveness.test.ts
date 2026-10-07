import { describe, expect, it } from "vitest";
import type { EnsureDaemonOptions } from "../../src/core/daemon/ensure.js";
import {
  type HookDeps,
  type HookResult,
  runHook,
  SPAWN_SETTLE_MS,
} from "../../src/harness/claude-code/index.js";
import { mayEdit } from "../../src/harness/shared/index.js";
import { recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Review wave 3, S2 and spec 001 D9: "PostToolBatch and Stop also ensure the
 * daemon when the recorded heartbeat is older than two intervals", and
 * delivered text says when no daemon is validating, once per consumer.
 */

const CLI = "/plugin/dist/cli/squeal.mjs";
const context = (out: HookResult): string =>
  (JSON.parse(out.stdout) as { hookSpecificOutput: { additionalContext: string } })
    .hookSpecificOutput.additionalContext;

function recording(result: "alive" | "spawned" | "unavailable" = "alive", onEnsure?: () => void) {
  const calls: (EnsureDaemonOptions & { root: string })[] = [];
  const deps: HookDeps = {
    env: {},
    cli: CLI,
    ensureDaemon: async (root, options) => {
      calls.push({ root, ...options });
      onEnsure?.();
      return result;
    },
  };
  return { calls, deps };
}

async function registered(): Promise<SquealRepo> {
  const r = squealRepo();
  r.apply(r.pass());
  await runHook("session-start", recorded("session-start", r.root), recording().deps);
  return r;
}

describe.each(["post-tool-batch", "stop"] as const)("%s and a stale heartbeat", (hook) => {
  it("ensures the daemon with the shipped CLI and the recorded daemon", async () => {
    const r = await registered();
    r.daemon("stale", 1_000);
    const { calls, deps } = recording("spawned");

    await runHook(hook, recorded(hook, r.root), deps);

    expect(calls).toEqual([
      expect.objectContaining({
        root: r.root,
        cli: CLI,
        socketTimeoutMs: 100,
        record: expect.objectContaining({ heartbeatAt: 1_000 }),
      }),
    ]);
  });

  it("ensures nothing while the heartbeat is fresh: a store read, no socket", async () => {
    const r = await registered();
    const { calls, deps } = recording();
    await runHook(hook, recorded(hook, r.root), deps);
    expect(calls).toEqual([]);
  });
});

describe("liveness in delivered text", () => {
  it("is delivered once at a tool boundary when the daemon stops validating", async () => {
    const r = await registered();
    r.daemon("stale", Date.UTC(2026, 0, 2, 14, 2));
    const { deps } = recording("spawned");

    const first = await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps);
    const second = await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps);

    expect(context(first)).toBe(
      "SQUEAL · no daemon is validating at revision 1\n" +
        "Revision 1 (changed src/math.ts): 1 current, 0 pending, 0 stale, 0 unknown. Full-suite checkpoint: none completed at any revision. " +
        "No daemon has validated since 2026-01-02T14:02:00.000Z; results are as of revision 1.",
    );
    expect(second.stdout).toBe("");
  });

  it("is in a registration made while no daemon runs", async () => {
    const r = squealRepo();
    r.apply(r.fail());
    r.daemon("none");
    const out = await runHook(
      "post-tool-batch",
      recorded("post-tool-batch", r.root),
      recording().deps,
    );
    expect(context(out)).toContain(" No daemon is running; results are as of revision 1.");
  });
});

/*
 * Lessons, defect 22 (task 001-112): with a daemon that holds the lock and
 * does not answer, no daemon validates and none is started; every boundary
 * with an edit says so, past the liveness told once.
 */
describe("a boundary while no daemon validates and none was started", () => {
  const STALE = Date.UTC(2026, 0, 2, 14, 2);
  const LINE =
    "Not validated: no daemon has validated since 2026-01-02T14:02:00.000Z; any change this call made has no result.";
  const batch = (root: string, ...tools: string[]) =>
    recorded("post-tool-batch", root, {
      tool_calls: tools.map((tool_name, i) => ({
        tool_name,
        tool_input: {},
        tool_use_id: `t${i}`,
      })),
    });

  it("says any change has no result at every boundary that may have edited", async () => {
    const r = await registered();
    r.daemon("stale", STALE);
    const { deps } = recording("unavailable");

    const first = await runHook("post-tool-batch", batch(r.root, "Read", "Edit"), deps);
    const second = await runHook("post-tool-batch", batch(r.root, "Bash"), deps);

    expect(context(first)).toBe(
      "SQUEAL · no daemon is validating at revision 1\n" +
        "Revision 1 (changed src/math.ts): 1 current, 0 pending, 0 stale, 0 unknown. Full-suite checkpoint: none completed at any revision. " +
        "No daemon has validated since 2026-01-02T14:02:00.000Z; results are as of revision 1.\n" +
        LINE,
    );
    // Review wave 11f, S1: a Bash call may have changed nothing, so the line never says it edited.
    expect(context(second)).toBe(`SQUEAL · ${LINE}`);
    expect(context(second)).not.toContain("edit");
  });

  it("says nothing more at a boundary without an edit", async () => {
    const r = await registered();
    r.daemon("stale", STALE);
    const { deps } = recording("unavailable");
    await runHook("post-tool-batch", batch(r.root, "Edit"), deps);

    const out = await runHook("post-tool-batch", batch(r.root, "Read", "Grep"), deps);

    expect(out.stdout).toBe("");
  });

  it("counts a batch that names no tools as an edit", async () => {
    const r = await registered();
    r.daemon("stale", STALE);
    const { deps } = recording("unavailable");
    await runHook("post-tool-batch", batch(r.root, "Edit"), deps);

    const out = await runHook(
      "post-tool-batch",
      recorded("post-tool-batch", r.root, { tool_calls: undefined }),
      deps,
    );

    expect(context(out)).toBe(`SQUEAL · ${LINE}`);
  });

  it("says no daemon is running when none ever heartbeat", async () => {
    const r = await registered();
    r.daemon("none");
    const { deps } = recording("unavailable");
    await runHook("post-tool-batch", batch(r.root, "Edit"), deps);

    const out = await runHook("post-tool-batch", batch(r.root, "Write"), deps);

    expect(context(out)).toBe(
      "SQUEAL · Not validated: no daemon is running; any change this call made has no result.",
    );
  });

  it("is not said for a dead daemon a boundary replaced: the new one will validate the edit", async () => {
    const r = await registered();
    r.daemon("stale", STALE);
    const { deps } = recording("spawned");

    const first = await runHook("post-tool-batch", batch(r.root, "Edit"), deps);
    const second = await runHook("post-tool-batch", batch(r.root, "Edit"), deps);

    expect(context(first)).not.toContain("Not validated");
    expect(second.stdout).toBe("");
  });
});

describe("mayEdit", () => {
  it("is true for a tool that changes files, a shell, or tools not named", () => {
    expect(mayEdit(["Read", "Edit"])).toBe(true);
    expect(mayEdit(["Bash"])).toBe(true);
    expect(mayEdit(["apply_patch"])).toBe(true);
    expect(mayEdit(undefined)).toBe(true);
    expect(mayEdit(["Read", "Grep", "Glob"])).toBe(false);
    expect(mayEdit([])).toBe(false);
  });
});

describe("SessionStart after spawning a daemon", () => {
  it("waits for the new daemon's heartbeat, so the registration says it validates", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    r.daemon("none");
    const { deps } = recording("spawned", () => setTimeout(() => r.daemon("alive"), 100));

    const started = performance.now();
    const out = await runHook("session-start", recorded("session-start", r.root), deps);

    expect(performance.now() - started).toBeLessThan(SPAWN_SETTLE_MS);
    expect(context(out)).toMatch(/^SQUEAL · registered at revision 1\n/);
    expect(context(out)).not.toContain("No daemon");
  });

  it(`registers after ${SPAWN_SETTLE_MS} ms and says so when no heartbeat arrives`, async () => {
    const r = squealRepo();
    r.apply(r.pass());
    r.daemon("none");
    const started = performance.now();
    const out = await runHook(
      "session-start",
      recorded("session-start", r.root),
      recording("spawned").deps,
    );
    const elapsed = performance.now() - started;

    expect(elapsed).toBeGreaterThanOrEqual(SPAWN_SETTLE_MS - 10);
    expect(elapsed).toBeLessThan(SPAWN_SETTLE_MS + 500);
    expect(context(out)).toContain("No daemon is running; results are as of revision 1.");
  });
});
