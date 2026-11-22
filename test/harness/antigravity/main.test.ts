import { afterEach, describe, expect, it, vi } from "vitest";
import { preInvocation, preToolUse } from "../../../src/harness/antigravity/handlers.js";
import type { AntigravityHandler } from "../../../src/harness/antigravity/hook.js";
import { runAntigravityHook } from "../../../src/harness/antigravity/hooks.js";
import {
  type HookIo,
  PRE_TOOL_USE_DEADLINE_MS,
  runHookInput,
} from "../../../src/harness/antigravity/main.js";
import type { OutputStream } from "../../../src/harness/shared/hand-off.js";
import type { HookDeps } from "../../../src/harness/shared/hook.js";
import { type SquealRepo, SUBTRACTS, squealRepo } from "../helpers.js";
import { antigravityRecorded, injected } from "./helpers.js";

/*
 * Spec 024 D3 and D4 on the process wrapper: reports commit only after
 * stdout took the text (row 011-288), allow and error write nothing, never
 * `{}`, and PreToolUse gives up silently at its 1,500 ms deadline.
 */

const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive" };
const overrides: Partial<HookDeps> = { ensureDaemon: async () => "alive" };

afterEach(() => {
  vi.useRealTimers();
});

/** A stream that keeps what it took; `fails`: every write reports an error. */
function stream(fails = false): OutputStream & { readonly text: () => string } {
  const chunks: string[] = [];
  return {
    write(text, callback) {
      if (fails) {
        callback(new Error("EPIPE"));
        return false;
      }
      chunks.push(text);
      callback();
      return true;
    },
    text: () => chunks.join(""),
  };
}

type Stream = ReturnType<typeof stream>;

function io(more: Partial<Omit<HookIo, "stdout" | "stderr">> & { stdout?: Stream } = {}) {
  const stdout = stream();
  const stderr = stream();
  const exit = vi.fn<(code: number) => void>();
  return { stdout, stderr, exit, ...more };
}

/** Registered, in a turn, with a regression nobody was told. */
async function regressed(): Promise<SquealRepo> {
  const r = squealRepo();
  r.apply(r.pass(), r.pass(SUBTRACTS));
  const stdin = (fixture: string) => antigravityRecorded(fixture, r.root);
  await runAntigravityHook("session-start", stdin("session-start"), deps);
  await runAntigravityHook("pre-invocation", stdin("pre-invocation-first"), deps);
  r.apply(r.fail(), r.pass(SUBTRACTS));
  return r;
}

const afterTools = (r: SquealRepo) => antigravityRecorded("pre-invocation-after-tools", r.root);

describe("writeThenCommit (row 011-288)", () => {
  it("commits a report once stdout took it", async () => {
    const r = await regressed();
    const out = io();
    await runHookInput("pre-invocation", preInvocation, afterTools(r), {}, overrides, out);
    expect(injected(out.stdout.text())).toContain("PASS -> FAIL");
    expect(out.stderr.text()).toBe("");
    const again = io();
    await runHookInput("pre-invocation", preInvocation, afterTools(r), {}, overrides, again);
    expect(again.stdout.text()).toBe("");
  });

  it("leaves a report owed when stdout fails", async () => {
    const r = await regressed();
    const failed = io({ stdout: stream(true) });
    await runHookInput("pre-invocation", preInvocation, afterTools(r), {}, overrides, failed);
    const again = io();
    await runHookInput("pre-invocation", preInvocation, afterTools(r), {}, overrides, again);
    expect(injected(again.stdout.text())).toContain("PASS -> FAIL");
  });
});

describe("empty stdout (goal 7)", () => {
  it("writes nothing to allow a call", async () => {
    const r = await regressed();
    const out = io();
    const stdin = antigravityRecorded("pre-tool-use-run-command", r.root);
    await runHookInput("pre-tool-use", preToolUse, stdin, {}, overrides, out);
    expect(out.stdout.text()).toBe("");
    expect(out.exit).not.toHaveBeenCalled();
  });

  it("writes nothing when the handler throws, and leaves its report owed", async () => {
    const r = await regressed();
    const throwing: AntigravityHandler = async (input, location, d) => {
      await preInvocation(input, location, d);
      throw new Error("boom");
    };
    const out = io();
    await runHookInput("pre-invocation", throwing, afterTools(r), {}, overrides, out);
    expect(out.stdout.text()).toBe("");
    expect(out.stderr.text()).toBe("");
    const again = io();
    await runHookInput("pre-invocation", preInvocation, afterTools(r), {}, overrides, again);
    expect(injected(again.stdout.text())).toContain("PASS -> FAIL");
  });
});

describe("PreToolUse's fail-open deadline (D4)", () => {
  /** A handler that answers a deny only when `release` is called. */
  function held() {
    let release = () => {};
    const handler: AntigravityHandler = () =>
      new Promise((resolve) => {
        release = () => resolve({ decision: "deny", reason: "late" });
      });
    return { handler, release: () => release() };
  }

  it("is 1,500 ms", () => {
    expect(PRE_TOOL_USE_DEADLINE_MS).toBe(1_500);
  });

  it("exits 0 with empty stdout at 1,500 ms, and drops the late deny", async () => {
    const r = await regressed();
    vi.useFakeTimers();
    const { handler, release } = held();
    const out = io();
    const stdin = antigravityRecorded("pre-tool-use-write-file", r.root);
    const done = runHookInput("pre-tool-use", handler, stdin, {}, overrides, out);
    await vi.advanceTimersByTimeAsync(PRE_TOOL_USE_DEADLINE_MS - 1);
    expect(out.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(out.exit).toHaveBeenCalledExactlyOnceWith(0);
    release();
    await done;
    expect(out.stdout.text()).toBe("");
  });

  it("leaves a report the late handler prepared owed", async () => {
    const r = await regressed();
    let release = () => {};
    const slow: AntigravityHandler = async (input, location, d) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return preInvocation(input, location, d);
    };
    const out = io({ deadlineMs: 20 });
    const done = runHookInput("pre-invocation", slow, afterTools(r), {}, overrides, out);
    await vi.waitFor(() => expect(out.exit).toHaveBeenCalledWith(0));
    release();
    await done;
    expect(out.stdout.text()).toBe("");
    const again = io();
    await runHookInput("pre-invocation", preInvocation, afterTools(r), {}, overrides, again);
    expect(injected(again.stdout.text())).toContain("PASS -> FAIL");
  });

  it("is armed for pre-tool-use only", async () => {
    const r = await regressed();
    vi.useFakeTimers();
    const { handler, release } = held();
    const out = io();
    const done = runHookInput(
      "stop-slow",
      handler,
      antigravityRecorded("stop", r.root),
      {},
      overrides,
      out,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(out.exit).not.toHaveBeenCalled();
    release();
    await done;
    expect(JSON.parse(out.stdout.text())).toEqual({ decision: "deny", reason: "late" });
  });
});
