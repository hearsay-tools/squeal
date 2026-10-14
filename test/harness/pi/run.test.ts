import { describe, expect, it } from "vitest";
import { readTurn } from "../../../src/core/delivery/turn.js";
import { omittedTestFilesMetaKey } from "../../../src/core/scheduler/omitted-test-files.js";
import { endRun, settle, startRun, toolCall } from "../../../src/harness/pi/run.js";
import { startSession, toolBoundary } from "../../../src/harness/pi/session.js";
import { piCommand, workerDeps } from "../../../src/harness/pi/worker.js";
import type { HookDeps } from "../../../src/harness/shared/hook.js";
import { PRIMER_OPENING } from "../../../src/harness/shared/primer.js";
import { outsideGit } from "../bundle-helpers.js";
import { SESSION, type SquealRepo, squealRepo } from "../helpers.js";

/*
 * The worker's side of spec 009 D3 for one run on the shared code: the
 * primer naming the CLI as D7 says and the run's news, the writer block once
 * per regression, 005 D8 on `bash`, the Stop at settle, and the end of a turn.
 */

const deps = (): HookDeps => ({
  ...workerDeps(new URL("file:///pkg/dist/worker.mjs")),
  env: {},
  ensureDaemon: async () => "alive",
});
const COMMAND = piCommand("/pkg/dist/cli/squeal.mjs");

const about = (r: SquealRepo) => ({ sessionId: SESSION, cwd: r.root });

/** A repository whose session registered at a passing baseline. */
async function registered(): Promise<SquealRepo> {
  const r = squealRepo();
  r.apply(r.pass());
  await startSession({ ...about(r), reason: "startup" }, deps());
  return r;
}

describe("a run's start", () => {
  it("gives the primer, naming the CLI by its absolute path, and no news when there is none", async () => {
    const r = await registered();
    const answer = await startRun(about(r), deps());
    expect(answer.primer?.startsWith(PRIMER_OPENING)).toBe(true);
    expect(answer.primer).toContain(`${COMMAND} status --wait 60000`);
    expect(answer.news).toBeNull();
    expect(readTurn(r.store, r.consumer()).turn).not.toBe("idle");
  });

  it("gives the undelivered delta as the run's news", async () => {
    const r = await registered();
    r.apply(r.fail());
    const answer = await startRun(about(r), deps());
    expect(answer.news).toMatch(/^SQUEAL · /);
    expect(answer.news).toContain("PASS -> FAIL");
  });

  it("registers a consumer that is not, with its header as the news", async () => {
    const r = squealRepo();
    r.apply(r.fail());
    const answer = await startRun(about(r), deps());
    expect(answer.news).toMatch(/^SQUEAL · registered at revision 1\n/);
    expect(answer.news).not.toContain(PRIMER_OPENING);
    expect(r.store.consumers.get(r.consumer())).not.toBeNull();
  });

  it("is silent outside a git worktree", async () => {
    expect(await startRun({ sessionId: SESSION, cwd: outsideGit() }, deps())).toEqual({
      primer: null,
      news: null,
    });
  });
});

describe("a tool call", () => {
  const call = (r: SquealRepo, toolName: string, command?: string) =>
    toolCall({ ...about(r), toolName, ...(command === undefined ? {} : { command }) }, deps());

  it("blocks the first edit or write after an undelivered regression, once", async () => {
    const r = await registered();
    r.apply(r.fail());
    const reason = await call(r, "write");
    expect(reason).toMatch(/^SQUEAL · /);
    expect(reason).toContain("PASS -> FAIL");
    expect(reason).toContain("denied this write call, so the edit was not applied");
    expect(reason).toContain("can be re-issued");
    expect(await call(r, "edit")).toBeNull();
  });

  it("blocks nothing with interrupt.onRegression off", async () => {
    const r = await registered();
    r.policy({ interrupt: { onRegression: false } });
    r.apply(r.fail());
    expect(await call(r, "edit")).toBeNull();
  });

  it("never blocks bash by default, and the regression stays for the boundary", async () => {
    const r = await registered();
    r.apply(r.fail());
    expect(await call(r, "bash", "npx vitest run")).toBeNull();
    expect(await toolBoundary(about(r), deps())).toContain("PASS -> FAIL");
  });

  it("denies an answered test command once under testCommand.denyWhenCurrent (005 D8)", async () => {
    const r = await registered();
    r.store.meta.set(omittedTestFilesMetaKey(r.worktreeId), "0");
    r.policy({ testCommand: { denyWhenCurrent: true } });
    expect(await call(r, "bash", "ls")).toBeNull();
    expect(await call(r, "bash", "npx vitest run")).toMatch(/^The command did not run\./);
    expect(await call(r, "bash", "npx vitest run")).toBeNull();
  });
});

describe("a run's settle", () => {
  it("reports news as the continuation, then is silent and ends the turn", async () => {
    const r = await registered();
    await startRun(about(r), deps());
    r.apply(r.fail());
    const first = await settle(about(r), deps());
    expect(first.report).toMatch(/^SQUEAL · /);
    expect(first.report).toContain("PASS -> FAIL");
    expect(readTurn(r.store, r.consumer()).turn).not.toBe("idle");
    expect(await settle(about(r), deps())).toEqual({ report: null });
    expect(readTurn(r.store, r.consumer()).turn).toBe("idle");
  });

  it("blocks with stop.blockOnKnownFailures", async () => {
    const r = await registered();
    r.policy({ stop: { blockOnKnownFailures: true } });
    r.apply(r.fail());
    await toolBoundary(about(r), deps());
    expect((await settle(about(r), deps())).report).toMatch(/known failure/i);
  });

  it("is silent outside a git worktree", async () => {
    expect(await settle({ sessionId: SESSION, cwd: outsideGit() }, deps())).toEqual({
      report: null,
    });
  });
});

describe("the end of an aborted run", () => {
  it("ends the turn", async () => {
    const r = await registered();
    await startRun(about(r), deps());
    expect(await endRun(about(r), deps())).toBeNull();
    expect(readTurn(r.store, r.consumer()).turn).toBe("idle");
  });
});
