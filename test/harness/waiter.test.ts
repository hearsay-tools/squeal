import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { storePaths } from "../../src/core/store/index.js";
import {
  type HookDeps,
  type HookResult,
  runHook,
  waiterLockPath,
} from "../../src/harness/claude-code/index.js";
import { recorded, squealRepo } from "./helpers.js";

const SILENT: HookResult = { stdout: "", stderr: "", exitCode: 0 };
const INTERACTIVE = { CLAUDE_CODE_SESSION_ATTENDED: "1", CLAUDE_CODE_ENTRYPOINT: "cli" };

function deps(overrides: Partial<HookDeps> = {}): HookDeps {
  return {
    env: INTERACTIVE,
    ensureDaemon: async () => "alive",
    pollIntervalMs: 10,
    waiterTimeoutMs: 5_000,
    ...overrides,
  };
}

async function registered() {
  const r = squealRepo();
  r.apply(r.pass());
  await runHook("session-start", recorded("session-start", r.root), deps());
  return r;
}

describe("idle waiter", () => {
  it("exits 2 with the formatted delta on stderr when a transition arrives", async () => {
    const r = await registered();
    setTimeout(() => r.apply(r.fail()), 150);

    const out = await runHook("waiter", recorded("stop", r.root), deps());

    expect(out.exitCode).toBe(2);
    expect(out.stdout).toBe("");
    expect(out.stderr).toMatch(/^SQUEAL · 1 check changed at revision 2\n/);
    expect(out.stderr).toContain("PASS -> FAIL");
    // Delivered: the next tool boundary has nothing new.
    const batch = await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps());
    expect(batch).toEqual(SILENT);
  });

  it("exits 0 silently on timeout", async () => {
    const r = await registered();
    const started = performance.now();
    const out = await runHook("waiter", recorded("stop", r.root), deps({ waiterTimeoutMs: 300 }));
    expect(out).toEqual(SILENT);
    expect(performance.now() - started).toBeGreaterThanOrEqual(290);
  });

  it.each([
    ["-p mode", { CLAUDE_CODE_SESSION_ATTENDED: "0", CLAUDE_CODE_ENTRYPOINT: "sdk-cli" }],
    [
      "an SDK entry point",
      { CLAUDE_CODE_SESSION_ATTENDED: "1", CLAUDE_CODE_ENTRYPOINT: "sdk-cli" },
    ],
    ["no attended flag", { CLAUDE_CODE_ENTRYPOINT: "cli" }],
  ])("is never armed in %s", async (_, env) => {
    const r = await registered();
    r.apply(r.fail());
    const started = performance.now();
    const out = await runHook("waiter", recorded("stop", r.root), deps({ env }));
    expect(out).toEqual(SILENT);
    expect(performance.now() - started).toBeLessThan(1_000); // far below the 5 s waiter timeout; CI took 142 ms
    const batch = await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps());
    expect(batch.stdout).toContain("PASS -> FAIL");
  });

  it("is never armed for a subagent", async () => {
    const r = await registered();
    const out = await runHook("waiter", recorded("subagent-stop", r.root), deps());
    expect(out).toEqual(SILENT);
  });

  it("runs once per consumer: a second waiter exits at once while the first holds the lock", async () => {
    const r = await registered();
    const first = runHook("waiter", recorded("stop", r.root), deps());
    await new Promise((resolve) => setTimeout(resolve, 100));

    const started = performance.now();
    const second = await runHook("waiter", recorded("stop", r.root), deps());
    expect(second).toEqual(SILENT);
    expect(performance.now() - started).toBeLessThan(1_000); // far below the 5 s waiter timeout; CI took 142 ms

    r.apply(r.fail());
    expect((await first).exitCode).toBe(2);
  });

  it("exits 0 and removes its lock file when the session ends", async () => {
    const r = await registered();
    const lock = waiterLockPath(storePaths(r.repo.commonDir).locksDir, r.consumer());
    const waiting = runHook("waiter", recorded("stop", r.root), deps());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(existsSync(lock)).toBe(true);

    await runHook("session-end", recorded("session-end", r.root), deps());

    expect(await waiting).toEqual(SILENT);
    expect(existsSync(lock)).toBe(false);
  });

  it("waits for SessionStart to register the consumer", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    const waiting = runHook("waiter", recorded("session-start", r.root), deps());
    await new Promise((resolve) => setTimeout(resolve, 150));
    await runHook("session-start", recorded("session-start", r.root), deps());
    r.apply(r.fail());
    expect((await waiting).exitCode).toBe(2);
  });

  it("touches its consumer when it times out, so the 10 minute expiry starts there", async () => {
    const r = await registered();
    const before = r.store.consumers.get(r.consumer())?.lastSeenAt ?? 0;
    const at = before + 3_600_000;
    const out = await runHook(
      "waiter",
      recorded("stop", r.root),
      deps({ waiterTimeoutMs: 100, now: () => at }),
    );
    expect(out).toEqual(SILENT);
    expect(r.store.consumers.get(r.consumer())?.lastSeenAt).toBe(at);
  });
});

describe("idle waiter on UserPromptSubmit (defect 10)", () => {
  it("arms for a registered consumer with no waiter and wakes it on a transition", async () => {
    const r = await registered();
    setTimeout(() => r.apply(r.fail()), 150);
    const out = await runHook("waiter", recorded("user-prompt-submit", r.root), deps());
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain("PASS -> FAIL");
  });

  it("exits at once when a waiter already holds the lock", async () => {
    const r = await registered();
    const first = runHook("waiter", recorded("stop", r.root), deps());
    await new Promise((resolve) => setTimeout(resolve, 100));

    const started = performance.now();
    const second = await runHook("waiter", recorded("user-prompt-submit", r.root), deps());
    expect(second).toEqual(SILENT);
    expect(performance.now() - started).toBeLessThan(1_000); // far below the 5 s waiter timeout; CI took 142 ms

    r.apply(r.fail());
    expect((await first).exitCode).toBe(2);
  });
});
