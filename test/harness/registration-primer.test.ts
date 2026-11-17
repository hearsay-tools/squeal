import { describe, expect, it } from "vitest";
import { runHook } from "../../src/harness/claude-code/hooks.js";
import { bridgeDeps, prompt } from "../../src/harness/opencode/bridge.js";
import { after as toolResult } from "../../src/harness/opencode/bridge-turn.js";
import { toolBoundary } from "../../src/harness/pi/session.js";
import { workerDeps } from "../../src/harness/pi/worker.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { PRIMER_OPENING } from "../../src/harness/shared/primer.js";
import { recorded, SESSION, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Row 005-117: a consumer that is not registered (its store came after its start, or it expired)
 * registers at the next tool boundary or prompt. Pi and OpenCode put the primer in the system
 * prompt (Pi's run start, OpenCode's `primer` answers), so their registration text there says
 * the header alone; before 005-117 it said the primer a second time. Claude Code's says it.
 */

/** A worktree with one known failure, a live daemon, and no registered consumer. */
function unregistered(): SquealRepo {
  const r = squealRepo();
  r.apply(r.fail());
  r.daemon("alive");
  return r;
}

const piDeps = (): HookDeps => ({
  ...workerDeps(new URL("file:///pkg/dist/worker.mjs")),
  env: {},
  ensureDaemon: async () => "alive",
});

const ocDeps = (): HookDeps => ({
  ...bridgeDeps(new URL("file:///pkg/dist/hooks/after.mjs"), { worktree: "/", pid: 1 }),
  env: {},
  ensureDaemon: async () => "alive",
});

const about = (r: SquealRepo) => ({
  consumer: { sessionId: SESSION },
  worktree: r.root,
  pid: process.pid,
});

describe("a registration at a boundary says the primer once (row 005-117)", () => {
  it("Pi's tool boundary: the header alone", async () => {
    const r = unregistered();
    const text = await toolBoundary({ sessionId: SESSION, cwd: r.root }, piDeps());
    expect(text).toContain("FAIL");
    expect(text).not.toContain(PRIMER_OPENING);
  });

  it("OpenCode's tool result: the header alone, the primer in its own field", async () => {
    const r = unregistered();
    const answer = await toolResult(
      { kind: "after", ...about(r), tool: "bash", primer: true },
      ocDeps(),
    );
    expect(answer.text).toContain("FAIL");
    expect(answer.text).not.toContain(PRIMER_OPENING);
    expect("primer" in answer && answer.primer?.startsWith(PRIMER_OPENING)).toBe(true);
  });

  it("OpenCode's prompt: the header alone, the primer in its own field", async () => {
    const r = unregistered();
    const answer = await prompt({ kind: "prompt", ...about(r) }, ocDeps());
    expect(answer.text).toContain("FAIL");
    expect(answer.text).not.toContain(PRIMER_OPENING);
    expect(answer.primer?.startsWith(PRIMER_OPENING)).toBe(true);
  });

  it("Claude Code's tool boundary: the header and the primer", async () => {
    const r = unregistered();
    const out = await runHook("post-tool-batch", recorded("post-tool-batch", r.root), {
      env: {},
      cli: "/plugin/dist/cli/squeal.mjs",
      ensureDaemon: async () => "alive",
    });
    expect(out.stdout).toContain(PRIMER_OPENING);
  });
});
