import { describe, expect, it } from "vitest";
import { squealEvidence } from "../../../evals/lib/index.mjs";
import { readTurn } from "../../../src/core/delivery/turn.js";
import { MAIN_AGENT } from "../../../src/core/types/index.js";
import { runHook } from "../../../src/harness/claude-code/index.js";
import { runCodexHook } from "../../../src/harness/codex/index.js";
import { bridgeDeps, register } from "../../../src/harness/opencode/bridge.js";
import { stop as opencodeStop } from "../../../src/harness/opencode/bridge-turn.js";
import { settle } from "../../../src/harness/pi/run.js";
import { startSession } from "../../../src/harness/pi/session.js";
import { workerDeps } from "../../../src/harness/pi/worker.js";
import type { HookDeps } from "../../../src/harness/shared/hook.js";
import { codexInput, codexRecorded, sessionOf } from "../../harness/codex/helpers.js";
import { recorded, SESSION, type SquealRepo } from "../../harness/helpers.js";
import { hookedRepo } from "./rig.js";

/*
 * Spec 017 D8 "At Stop" (row 017-23): a lint change not yet told is news at
 * Stop by itself, as a test change is. Stop holds once, tells it and never
 * repeats it; a result not stored at Stop is not waited for, and the next
 * boundary tells it. Each harness's own Stop, over the real lint pass.
 */

const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive" };

/** One harness's session: its start, its Stop, and what that Stop told, `null` when silent. */
interface Harness {
  readonly name: string;
  /** The session's consumer: Codex's recorded input names its own session. */
  readonly session: string;
  start(r: SquealRepo): Promise<void>;
  /** The Stop; `again` is the one after Squeal's own continuation, where the harness has one. */
  stop(r: SquealRepo, again: boolean): Promise<string | null>;
}

/** A hook's stdout as the text it told: context, a block's reason, or `null` when silent. */
function toldBy(stdout: string): string | null {
  if (stdout === "") return null;
  const out = JSON.parse(stdout) as {
    reason?: string;
    hookSpecificOutput?: { additionalContext?: string };
  };
  return out.hookSpecificOutput?.additionalContext ?? out.reason ?? null;
}

const claudeCode: Harness = {
  name: "Claude Code",
  session: SESSION,
  async start(r) {
    await runHook("session-start", recorded("session-start", r.root), deps);
  },
  async stop(r, again) {
    const input = recorded("stop", r.root, { stop_hook_active: again });
    return toldBy((await runHook("stop", input, deps)).stdout);
  },
};

const codex: Harness = {
  name: "Codex",
  session: String(codexInput("exec", "session-start", "/").session_id),
  async start(r) {
    await runCodexHook("session-start", codexRecorded("exec", "session-start", r.root), deps);
    await runCodexHook(
      "user-prompt-submit",
      codexRecorded("exec", "user-prompt-submit", r.root),
      deps,
    );
  },
  async stop(r, again) {
    const input = again
      ? codexRecorded("exec", "stop-hook-active", r.root, sessionOf("exec", "session-start"))
      : codexRecorded("exec", "stop", r.root);
    return toldBy((await runCodexHook("stop", input, deps)).stdout);
  },
};

const opencodeDeps = (): HookDeps => ({
  ...bridgeDeps(new URL("file:///pkg/dist/hooks/after.mjs"), { worktree: "/", pid: process.pid }),
  ...deps,
});
const opencodeAbout = (r: SquealRepo) => ({
  consumer: { sessionId: SESSION },
  worktree: r.root,
  pid: process.pid,
});

const opencode: Harness = {
  name: "OpenCode",
  session: SESSION,
  async start(r) {
    await register({ kind: "register", ...opencodeAbout(r) }, opencodeDeps());
  },
  async stop(r) {
    return (await opencodeStop({ kind: "stop", ...opencodeAbout(r) }, opencodeDeps())).report;
  },
};

const piDeps = (): HookDeps => ({
  ...workerDeps(new URL("file:///pkg/dist/worker.mjs")),
  ...deps,
});

const pi: Harness = {
  name: "Pi",
  session: SESSION,
  async start(r) {
    await startSession({ sessionId: SESSION, cwd: r.root, reason: "startup" }, piDeps());
  },
  async stop(r) {
    return (await settle({ sessionId: SESSION, cwd: r.root }, piDeps())).report;
  },
};

const ON = { enabled: true };
const lines = (text: string | null) => (text ?? "").split("\n");
const B_FAILS = "FAIL lint: src/b.js: 1 finding, +1 no-console (no-console found)";

describe.each([claudeCode, codex, opencode, pi])("lint news at $name's Stop (017 D8)", (h) => {
  it("tells a lint change alone once, and the Stop after it is not held", async () => {
    const { r, edit } = await hookedRepo({ "src/a.js": "ok\n", "src/b.js": "ok\n" }, ON);
    await h.start(r);
    await edit({ "src/b.js": "bad no-console\n" });
    const first = await h.stop(r, false);
    expect(lines(first)).toContain(B_FAILS);
    expect(lines(first)[0]).toMatch(/^SQUEAL · 1 lint change at revision \d+$/);
    // The turn goes on to read it; the next Stop has nothing new and ends the turn.
    expect(await h.stop(r, true)).toBeNull();
    const consumer = { worktreeId: r.worktreeId, sessionId: h.session, agentId: MAIN_AGENT };
    expect(readTurn(r.store, consumer).turn).toBe("idle");
    // Told once: a later Stop does not tell it again.
    expect(await h.stop(r, false)).toBeNull();
  });

  it("tells a test change and a lint change at one Stop together, once", async () => {
    const { r, edit } = await hookedRepo({ "src/a.js": "ok\n", "src/b.js": "ok\n" }, ON);
    await h.start(r);
    await edit({ "src/b.js": "bad no-console\n" }, r.fail());
    const text = lines(await h.stop(r, false));
    expect(text[0]).toMatch(/^SQUEAL · 1 check changed \(1 test\) at revision \d+; 1 lint change$/);
    const test = text.findIndex((l) => l.startsWith("FAIL  src/math.test.ts > math > adds"));
    expect(test).toBeGreaterThan(0);
    expect(text.indexOf(B_FAILS)).toBeGreaterThan(test);
    expect(await h.stop(r, true)).toBeNull();
    expect(await h.stop(r, false)).toBeNull();
  });
});

describe("a lint result not stored at Stop (017 D8)", () => {
  it("is not waited for, and the next boundary tells it", async () => {
    const { r, write, settle: lint } = await hookedRepo({ "src/b.js": "ok\n" }, ON);
    await claudeCode.start(r);
    write({ "src/b.js": "bad no-console\n" });
    // The lint pass has not run on the edit: Stop has nothing to tell and ends the turn.
    expect(await claudeCode.stop(r, false)).toBeNull();
    expect(readTurn(r.store, r.consumer()).turn).toBe("idle");
    await lint();
    const prompt = await runHook(
      "user-prompt-submit",
      recorded("user-prompt-submit", r.root),
      deps,
    );
    expect(lines(toldBy(prompt.stdout))).toContain(B_FAILS);
    expect(await claudeCode.stop(r, false)).toBeNull();
  });
});

describe("lint.blocking at Stop (017 D8)", () => {
  it("off, holds Stop only to tell the change; on, blocks once with the change beside the reason", async () => {
    const off = await hookedRepo({ "src/b.js": "ok\n" }, ON);
    await claudeCode.start(off.r);
    await off.edit({ "src/b.js": "bad no-console\n" });
    const told = await runHook("stop", recorded("stop", off.r.root), deps);
    expect(told.stdout).not.toContain('"decision"');
    expect(lines(toldBy(told.stdout))).toContain(B_FAILS);

    const on = await hookedRepo({ "src/b.js": "ok\n" }, { enabled: true, blocking: true });
    await claudeCode.start(on.r);
    await on.edit({ "src/b.js": "bad no-console\n" });
    const held = JSON.parse((await runHook("stop", recorded("stop", on.r.root), deps)).stdout) as {
      decision?: string;
      reason?: string;
    };
    expect(held.decision).toBe("block");
    expect(lines(held.reason ?? null)).toContain(
      "Squeal policy lint.blocking is on and 1 file went to fail lint since this session started: src/b.js (1 finding). `squeal lint --changed` lists them.",
    );
    expect(lines(held.reason ?? null)).toContain(B_FAILS);
    // The Stop after the block never blocks again and has nothing new to tell.
    expect(await claudeCode.stop(on.r, true)).toBeNull();
  });
});

describe("the evals' reading of a Stop with lint news (017 D8)", () => {
  it("reads lint lines as code lines, no test check and no failure, plain and in the hook's JSON", async () => {
    const { r, edit } = await hookedRepo({ "src/b.js": "ok\n" }, ON);
    await claudeCode.start(r);
    await edit({ "src/b.js": "bad no-console\n" });
    const out = (await runHook("stop", recorded("stop", r.root), deps)).stdout;
    const text = toldBy(out) ?? expect.unreachable();
    expect(lines(text)).toContain(B_FAILS);
    for (const told of [text, out]) {
      expect(squealEvidence(told, "push")).toMatchObject({ checks: [], failures: 0, failing: [] });
    }
  });
});
