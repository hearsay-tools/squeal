import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runHook } from "../../src/harness/claude-code/hooks.js";
import { bridgeDeps, prompt, register } from "../../src/harness/opencode/bridge.js";
import { after as toolResult } from "../../src/harness/opencode/bridge-turn.js";
import { startRun } from "../../src/harness/pi/run.js";
import { startSession, toolBoundary } from "../../src/harness/pi/session.js";
import { workerDeps } from "../../src/harness/pi/worker.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { PRIMER_OPENING } from "../../src/harness/shared/primer.js";
import { type FakeRepo, fakeRepo } from "../status/helpers.js";
import { recorded, SESSION, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Row 005-117: a consumer that is not registered (its store came after its start, or it expired)
 * registers at the next tool boundary or prompt. Pi and OpenCode put the primer in the system
 * prompt (Pi's run start, OpenCode's `primer` answers), so their registration text there says
 * the header alone; before 005-117 it said the primer a second time. Claude Code's says it.
 * Review 0.1.556: Pi's boundary leaves the primer out only when the run's system prompt has it
 * (the extension's `primed`); a store that came after the run start gave that run none.
 */

/** A repository with a `squeal.config.json` and no store yet. */
function configOnly(): FakeRepo {
  const repo = fakeRepo();
  writeFileSync(join(repo.main, "squeal.config.json"), "{}\n");
  return repo;
}

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
  it("Pi's tool boundary in a run whose system prompt has the primer: the header alone", async () => {
    const r = unregistered();
    const text = await toolBoundary({ sessionId: SESSION, cwd: r.root, primed: true }, piDeps());
    expect(text).toContain("FAIL");
    expect(text).not.toContain(PRIMER_OPENING);
  });

  it("Pi, the store after the run start: the boundary that registers says the primer, once (review 0.1.556)", async () => {
    const repo = configOnly();
    const session = { sessionId: SESSION, cwd: repo.main };
    expect(await startSession({ ...session, reason: "startup" }, piDeps())).toBeNull();
    expect((await startRun(session, piDeps())).primer).toBeNull();
    const r = squealRepo(repo);
    r.apply(r.fail());
    // The run's system prompt has no primer, so the extension sends no `primed`.
    const text = await toolBoundary(session, piDeps());
    expect(text).toContain("FAIL");
    expect(text?.split(PRIMER_OPENING).length).toBe(2);
    expect(await toolBoundary(session, piDeps())).toBeNull();
    // The next run's system prompt has it; its news does not repeat it.
    const next = await startRun(session, piDeps());
    expect(next.primer?.startsWith(PRIMER_OPENING)).toBe(true);
    expect(next.news ?? "").not.toContain(PRIMER_OPENING);
  });

  it("OpenCode, the store after the register: the tool result says the header, the primer goes to the system prompt", async () => {
    const repo = configOnly();
    const consumer = { consumer: { sessionId: SESSION }, worktree: repo.main, pid: process.pid };
    expect(await register({ kind: "register", ...consumer }, ocDeps())).toMatchObject({
      registered: false,
      primer: null,
    });
    const r = squealRepo(repo);
    r.apply(r.fail());
    // The plugin has no primer yet, so it asks for one (`hooks.ts` `tool.execute.after`).
    const answer = await toolResult(
      { kind: "after", ...consumer, tool: "bash", primer: true },
      ocDeps(),
    );
    expect(answer.text).toContain("FAIL");
    expect(answer.text).not.toContain(PRIMER_OPENING);
    expect("primer" in answer && answer.primer?.startsWith(PRIMER_OPENING)).toBe(true);
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
