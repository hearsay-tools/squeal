import { describe, expect, it } from "vitest";
import { readTurn } from "../../src/core/delivery/turn.js";
import type { TestFileRef } from "../../src/core/types/index.js";
import { type HookDeps, type HookResult, runHook } from "../../src/harness/claude-code/index.js";
import { check, result, setKey } from "../state/helpers.js";
import { recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Task 001-85 (lessons, defect 14): a waiter message written mid-turn lands
 * at the next tool boundary, after PostToolBatch delivered the same news with
 * a newer header. So the waiter speaks only to an idle agent, and only about
 * the test files pending when its turn ended; everything else rides on the
 * next prompt or tool boundary. Every case runs the hooks on recorded input.
 */

const SILENT: HookResult = { stdout: "", stderr: "", exitCode: 0 };
const INTERACTIVE = { CLAUDE_CODE_SESSION_ATTENDED: "1", CLAUDE_CODE_ENTRYPOINT: "cli" };

/** Far longer than a waiter takes to see a result (it polls every 10 ms here). */
const QUIET_MS = 400;

const deps = (overrides: Partial<HookDeps> = {}): HookDeps => ({
  env: INTERACTIVE,
  ensureDaemon: async () => "alive",
  pollIntervalMs: 10,
  waiterTimeoutMs: 5_000,
  ...overrides,
});

type Event = "session-start" | "user-prompt-submit" | "post-tool-batch" | "pre-tool-use" | "stop";

const hook = (name: Event, r: SquealRepo, overrides: object = {}) =>
  runHook(name, recorded(name, r.root, overrides), deps());

/** The waiter with a short timeout, applying `change` once it waits. */
async function waiterAround(r: SquealRepo, change: () => void, timeoutMs = QUIET_MS) {
  const waiting = runHook("waiter", recorded("stop", r.root), deps({ waiterTimeoutMs: timeoutMs }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  change();
  return waiting;
}

const context = (out: HookResult): string =>
  out.stdout === ""
    ? ""
    : (JSON.parse(out.stdout) as { hookSpecificOutput: { additionalContext: string } })
        .hookSpecificOutput.additionalContext;

const OTHER_FILE: TestFileRef = { project: "", path: "src/other.test.ts" };
const OTHER = check("other > holds", OTHER_FILE);
const other = (r: SquealRepo, outcome: "pass" | "fail") =>
  result(OTHER, outcome, {
    key: "o1",
    worktreeId: r.worktreeId,
    revision: (r.store.revisions.latest(r.worktreeId)?.number ?? 0) + 1,
    ...(outcome === "fail" ? { message: "other broke" } : {}),
  });

/** Registered by SessionStart with `math > adds` passing, then a prompt starts a turn. */
async function inTurn(): Promise<SquealRepo> {
  const r = squealRepo();
  setKey(r.store, "o1", { file: OTHER_FILE, worktreeId: r.worktreeId });
  r.apply(r.pass(), other(r, "pass"));
  await hook("session-start", r);
  expect(await hook("user-prompt-submit", r)).toEqual(SILENT);
  return r;
}

describe("the idle waiter and the turn state (task 001-85)", () => {
  it("(1) mid-turn: news arrives through PostToolBatch only, the waiter is silent", async () => {
    const r = await inTurn();
    r.queue("k2");

    const waiter = await waiterAround(r, () => r.apply(r.fail()));
    const batch = await hook("post-tool-batch", r);

    expect(waiter).toEqual(SILENT);
    expect(context(batch)).toMatch(/^SQUEAL · 1 check changed at revision 3\n/);
    expect(context(batch)).toContain("PASS -> FAIL");
    expect(readTurn(r.store, r.consumer()).turn).toBe("in-turn");
  });

  it("(2) idle with a pending check: the waiter delivers its result", async () => {
    const r = await inTurn();
    r.queue("k2");
    expect(await hook("stop", r)).toEqual(SILENT);
    expect(readTurn(r.store, r.consumer())).toEqual({
      turn: "idle",
      testFiles: ["\0src/math.test.ts"],
      newTestFiles: false,
      keys: { "\0src/math.test.ts": "k2" },
      revision: 2,
    });

    const waiter = await waiterAround(r, () => r.apply(r.fail()), 5_000);

    expect(waiter.exitCode).toBe(2);
    expect(waiter.stderr).toMatch(/^SQUEAL · 1 check changed at revision 3\n/);
    expect(waiter.stderr).toContain("PASS -> FAIL");
    // The wake starts a turn, and the prompt Claude Code sends with it has nothing left.
    expect(readTurn(r.store, r.consumer()).turn).toBe("in-turn");
    expect(await hook("user-prompt-submit", r)).toEqual(SILENT);
  });

  it("(3) idle: a check not pending at Stop never wakes; the next prompt carries it", async () => {
    const r = await inTurn();
    r.queue("k2");
    await hook("stop", r);

    const waiter = await waiterAround(r, () => r.apply(other(r, "fail")));
    expect(waiter).toEqual(SILENT);

    // The pending check's result wakes, and says nothing of the other one.
    const wake = await waiterAround(r, () => r.apply(r.fail()), 5_000);
    expect(wake.exitCode).toBe(2);
    expect(wake.stderr).toContain("math > adds");
    expect(wake.stderr).not.toContain("other > holds");

    const prompt = context(await hook("user-prompt-submit", r));
    expect(prompt).toMatch(/^SQUEAL · 1 check changed at revision 4\n/);
    expect(prompt).toContain("FAIL  src/other.test.ts > other > holds");
    expect(prompt).not.toContain("math > adds");
  });

  it("(4) after an interrupt (a prompt, no Stop): the waiter is silent, the next prompt carries it", async () => {
    const r = await inTurn();
    r.queue("k2");
    // Esc: Claude Code runs no Stop; UserPromptSubmit armed this waiter.
    const waiter = await waiterAround(r, () => r.apply(r.fail()));
    expect(waiter).toEqual(SILENT);

    const prompt = context(await hook("user-prompt-submit", r));
    expect(prompt).toContain("PASS -> FAIL");
    expect(readTurn(r.store, r.consumer()).turn).toBe("in-turn");
  });

  it("(5) a Stop that speaks keeps the turn; the silent Stop after it ends it", async () => {
    const r = await inTurn();
    r.queue("k2");
    r.apply(r.fail());
    const spoken = await hook("stop", r);
    expect(context(spoken)).toContain("PASS -> FAIL");
    expect(readTurn(r.store, r.consumer()).turn).toBe("in-turn");

    r.queue("k3");
    const waiter = await waiterAround(r, () => r.apply(r.pass()));
    expect(waiter).toEqual(SILENT);

    // The continued turn's Stop says the recovery, and the one after it ends the turn.
    expect(context(await hook("stop", r, { stop_hook_active: true }))).toContain("FAIL -> PASS");
    expect(await hook("stop", r, { stop_hook_active: true })).toEqual(SILENT);
    expect(readTurn(r.store, r.consumer()).turn).toBe("idle");
  });

  it("a tool call puts a consumer left idle in a turn (review wave 10, S2)", async () => {
    const r = await inTurn();
    r.queue("k2");
    // Squeal's Stop is silent, but another Stop hook blocks: the agent works on.
    expect(await hook("stop", r)).toEqual(SILENT);
    expect(readTurn(r.store, r.consumer()).turn).toBe("idle");
    // The first tool boundary after the edit says only that Squeal saw it (task 001-224).
    expect(context(await hook("post-tool-batch", r))).toMatch(
      /\nSqueal saw your edit and queued 1 test file;/,
    );
    expect(readTurn(r.store, r.consumer()).turn).toBe("in-turn");

    const waiter = await waiterAround(r, () => r.apply(r.fail()));
    expect(waiter).toEqual(SILENT);
    expect(context(await hook("post-tool-batch", r))).toContain("PASS -> FAIL");
  });

  it("(5b) another Stop hook continues the turn: its first tool call is in a turn before it runs (task 001-93)", async () => {
    const r = await inTurn();
    r.queue("k2");
    // Squeal's Stop is silent, another Stop hook blocks, and the continuation runs `sleep 15`.
    expect(await hook("stop", r)).toEqual(SILENT);
    expect(readTurn(r.store, r.consumer()).turn).toBe("idle");
    const bash = { tool_name: "Bash", tool_input: { command: "sleep 15" } };
    expect(await hook("pre-tool-use", r, bash)).toEqual(SILENT);
    expect(readTurn(r.store, r.consumer()).turn).toBe("in-turn");

    // The waited-for result lands while the call runs: only the next PostToolBatch tells it.
    const waiter = await waiterAround(r, () => r.apply(r.fail()));
    expect(waiter).toEqual(SILENT);
    expect(context(await hook("post-tool-batch", r))).toContain("PASS -> FAIL");
  });

  it.each([
    ["an edit made from outside", (r: SquealRepo) => r.queue("k3")],
    ["a re-run under the same key", () => {}],
  ])(
    "idle: once a pending file's result lands quiet, %s never wakes (review wave 10, P1)",
    async (_, edit) => {
      const r = await inTurn();
      r.queue("k2");
      await hook("stop", r);

      expect(await waiterAround(r, () => r.apply(r.pass()))).toEqual(SILENT);
      expect(readTurn(r.store, r.consumer())).toMatchObject({ turn: "idle", testFiles: [] });

      edit(r);
      const waiter = await waiterAround(r, () => r.apply(r.fail()));
      expect(waiter).toEqual(SILENT);
      expect(context(await hook("user-prompt-submit", r))).toContain("PASS -> FAIL");
    },
  );

  it("idle: a pending file whose key an outside edit changed is no longer waited for (S3)", async () => {
    const r = await inTurn();
    r.queue("k2");
    await hook("stop", r);
    expect(readTurn(r.store, r.consumer())).toMatchObject({ keys: { "\0src/math.test.ts": "k2" } });

    r.queue("k3");
    const waiter = await waiterAround(r, () => r.apply(r.fail()));
    expect(waiter).toEqual(SILENT);
  });

  it("a session starts idle and waiting for nothing", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    await hook("session-start", r);
    const waiter = await waiterAround(r, () => r.apply(r.fail()));
    expect(waiter).toEqual(SILENT);
    expect(context(await hook("user-prompt-submit", r))).toContain("PASS -> FAIL");
  });
});
