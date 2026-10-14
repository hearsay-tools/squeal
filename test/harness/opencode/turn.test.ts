import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { readTurn } from "../../../src/core/delivery/turn.js";
import { omittedTestFilesMetaKey } from "../../../src/core/scheduler/omitted-test-files.js";
import {
  bridgeDeps,
  opencodeCommand,
  prompt,
  register,
} from "../../../src/harness/opencode/bridge.js";
import { after, before, endTurn, stop, wait } from "../../../src/harness/opencode/bridge-turn.js";
import type { OcConsumer } from "../../../src/harness/opencode/protocol.js";
import type { HookDeps } from "../../../src/harness/shared/hook.js";
import { outsideGit } from "../bundle-helpers.js";
import { SESSION, type SquealRepo, squealRepo } from "../helpers.js";
import { CHILD_ID } from "./stub.js";

/*
 * The bridge's side of spec 008 D3 within a turn and D5's wait, on the
 * shared code: the prompt's delta, the writer block once per regression and
 * never on `bash` by default, 005 D8, the boundary's delta once per parallel
 * batch, Stop at idle, the end of a turn, and the idle wait.
 */

const BUNDLE = new URL("file:///pkg/dist/hooks/after.mjs");
const COMMAND = opencodeCommand("/pkg/dist/cli/squeal.mjs");
const deps = (overrides: Partial<HookDeps> = {}): HookDeps => ({
  ...bridgeDeps(BUNDLE, { worktree: "/", pid: process.pid }),
  env: {},
  ensureDaemon: async () => "alive",
  ...overrides,
});
const ROOT: OcConsumer = { sessionId: SESSION };
const about = (r: SquealRepo | string, consumer: OcConsumer = ROOT) => ({
  consumer,
  worktree: typeof r === "string" ? r : r.root,
  pid: process.pid,
});

/** A repository whose root session registered at a passing baseline. */
async function registered(consumer: OcConsumer = ROOT): Promise<SquealRepo> {
  const r = squealRepo();
  r.apply(r.pass());
  await register({ kind: "register", ...about(r, consumer) }, deps());
  return r;
}

const call = (r: SquealRepo, tool: string, command?: string) =>
  before(
    {
      kind: "before",
      ...about(r),
      tool,
      ...(command === undefined ? {} : { command, workdir: r.root }),
    },
    deps(),
  );
const boundary = (r: SquealRepo, tool = "bash", consumer: OcConsumer = ROOT) =>
  after({ kind: "after", ...about(r, consumer), tool }, deps());

describe("prompt", () => {
  it("starts the turn and gives the undelivered delta", async () => {
    const r = await registered();
    await endTurn({ kind: "endTurn", ...about(r) }, deps());
    r.apply(r.fail());
    const { text } = await prompt({ kind: "prompt", ...about(r) }, deps());
    expect(text).toMatch(/^SQUEAL · /);
    expect(text).toContain("PASS -> FAIL");
    expect(readTurn(r.store, r.consumer()).turn).not.toBe("idle");
    expect(await prompt({ kind: "prompt", ...about(r) }, deps())).toMatchObject({
      text: null,
      stopWaitMs: 0,
    });
  });

  it("answers the primer as the consumer's coverage now has it (008-22)", async () => {
    const r = await registered();
    const { primer } = await prompt({ kind: "prompt", ...about(r) }, deps());
    expect(primer).toContain(COMMAND);
  });

  it("answers the policy's stop.waitMs, for the deadline at idle (review 008-16 B1)", async () => {
    const r = await registered();
    r.policy({ stop: { waitMs: 1_200 } });
    expect((await prompt({ kind: "prompt", ...about(r) }, deps())).stopWaitMs).toBe(1_200);
    expect((await register({ kind: "register", ...about(r) }, deps())).stopWaitMs).toBe(1_200);
  });

  it("registers a consumer the daemon expired, its header naming the CLI by path", async () => {
    const r = squealRepo();
    r.apply(r.fail());
    const { text } = await prompt({ kind: "prompt", ...about(r) }, deps());
    expect(text).toMatch(/^SQUEAL · registered at revision 1\n/);
    expect(text).toContain(COMMAND);
    expect(r.store.consumers.get(r.consumer())).not.toBeNull();
  });
});

describe("before", () => {
  it("blocks the first edit, write or apply_patch after an undelivered regression, once", async () => {
    for (const tool of ["edit", "write", "apply_patch"]) {
      const r = await registered();
      r.apply(r.fail());
      const { reason } = await call(r, tool);
      expect(reason).toMatch(/^SQUEAL · /);
      expect(reason).toContain("PASS -> FAIL");
      expect(reason).toContain(`denied this ${tool} call, so the edit was not applied`);
      expect(reason).toContain("can be re-issued");
      expect(await call(r, tool)).toEqual({ reason: null });
    }
  });

  it("blocks nothing with interrupt.onRegression off", async () => {
    const r = await registered();
    r.policy({ interrupt: { onRegression: false } });
    r.apply(r.fail());
    expect(await call(r, "edit")).toEqual({ reason: null });
  });

  it("never blocks bash by default, and the regression stays for the boundary", async () => {
    const r = await registered();
    r.apply(r.fail());
    expect(await call(r, "bash", "npx vitest run")).toEqual({ reason: null });
    expect((await boundary(r)).text).toContain("PASS -> FAIL");
  });

  it("denies an answered test command once under testCommand.denyWhenCurrent (005 D8)", async () => {
    const r = await registered();
    r.store.meta.set(omittedTestFilesMetaKey(r.worktreeId), "0");
    r.policy({ testCommand: { denyWhenCurrent: true } });
    expect(await call(r, "bash", "ls")).toEqual({ reason: null });
    expect((await call(r, "bash", "npx vitest run")).reason).toMatch(/^The command did not run\./);
    expect(await call(r, "bash", "npx vitest run")).toEqual({ reason: null });
  });

  it("puts an idle consumer back in a turn on any tool (001-93)", async () => {
    const r = await registered();
    await endTurn({ kind: "endTurn", ...about(r) }, deps());
    expect(readTurn(r.store, r.consumer()).turn).toBe("idle");
    expect(await call(r, "read")).toEqual({ reason: null });
    expect(readTurn(r.store, r.consumer()).turn).not.toBe("idle");
  });
});

describe("after", () => {
  it("delivers a regression once over parallel calls", async () => {
    const r = await registered();
    r.apply(r.fail());
    const answers = await Promise.all([boundary(r, "edit"), boundary(r, "read"), boundary(r)]);
    const texts = answers.map((a) => a.text).filter((t) => t !== null);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain("PASS -> FAIL");
    expect(texts[0]).toContain(`Full output: ${COMMAND} why`);
  });

  it("delivers the matching recovery, and nothing for an unchanged failure", async () => {
    const r = await registered();
    r.apply(r.fail());
    await boundary(r);
    r.apply(r.fail());
    expect(await boundary(r)).toEqual({ text: null });
    r.apply(r.pass());
    expect((await boundary(r)).text).toContain("FAIL -> PASS");
  });

  it("delivers to a child for the child, not its parent", async () => {
    const child = { sessionId: SESSION, agentId: CHILD_ID };
    const r = await registered();
    await register({ kind: "register", ...about(r, child) }, deps());
    r.apply(r.fail());
    expect((await boundary(r, "bash", child)).text).toContain("PASS -> FAIL");
    expect((await boundary(r, "bash", child)).text).toBeNull();
    expect((await boundary(r)).text).toContain("PASS -> FAIL");
  });

  it("is silent outside a git worktree", async () => {
    const answer = await after({ kind: "after", ...about(outsideGit()), tool: "bash" }, deps());
    expect(answer).toEqual({ text: null });
    const asked = { kind: "after", ...about(outsideGit()), tool: "bash", primer: true } as const;
    expect(await after(asked, deps())).toEqual({ text: null });
  });

  it("asked, registers a consumer the message could not and answers the primer and stop.waitMs (008-22)", async () => {
    const r = squealRepo();
    r.policy({ stop: { waitMs: 1_200 } });
    const answer = await after({ kind: "after", ...about(r), tool: "bash", primer: true }, deps());
    expect(answer.text).toMatch(/^SQUEAL · registered/);
    expect(answer.primer).toContain(COMMAND);
    expect(answer.stopWaitMs).toBe(1_200);
    expect(r.store.consumers.get(r.consumer())).not.toBeNull();
    // Not asked: the delta alone.
    expect(Object.keys(await boundary(r))).toEqual(["text"]);
  });
});

describe("stop and endTurn", () => {
  it("reports news once as the continuation; the next stop is silent and ends the turn", async () => {
    const r = await registered();
    r.apply(r.fail());
    const first = await stop({ kind: "stop", ...about(r) }, deps());
    expect(first.report).toMatch(/^SQUEAL · /);
    expect(first.report).toContain("PASS -> FAIL");
    expect(readTurn(r.store, r.consumer()).turn).not.toBe("idle");
    expect(await stop({ kind: "stop", ...about(r) }, deps())).toEqual({ report: null });
    expect(readTurn(r.store, r.consumer()).turn).toBe("idle");
  });

  it("blocks with stop.blockOnKnownFailures", async () => {
    const r = await registered();
    r.policy({ stop: { blockOnKnownFailures: true } });
    r.apply(r.fail());
    await boundary(r);
    expect((await stop({ kind: "stop", ...about(r) }, deps())).report).toMatch(/known failure/i);
  });

  it("endTurn ends the turn and says nothing, the delta left for the next prompt", async () => {
    const r = await registered();
    r.apply(r.fail());
    expect(await endTurn({ kind: "endTurn", ...about(r) }, deps())).toEqual({ ended: true });
    expect(readTurn(r.store, r.consumer()).turn).toBe("idle");
    expect((await prompt({ kind: "prompt", ...about(r) }, deps())).text).toContain("PASS -> FAIL");
  });
});

describe("wait", () => {
  const waitDeps = () => deps({ pollIntervalMs: 10, waiterTimeoutMs: 5_000 });

  /** Registered, then idle at a stop that found the re-run of `math > adds` queued. */
  async function idle(): Promise<SquealRepo> {
    const r = await registered();
    r.queue("k2");
    expect(await stop({ kind: "stop", ...about(r) }, deps())).toEqual({ report: null });
    return r;
  }

  it("gives the idle delta once the pending file's result lands", async () => {
    const r = await idle();
    setTimeout(() => r.apply(r.fail()), 150);
    const { text } = await wait({ kind: "wait", ...about(r) }, waitDeps());
    expect(text).toMatch(/^SQUEAL · 1 check changed/);
    expect(text).toContain("PASS -> FAIL");
  });

  it("is null soon after OpenCode's process is gone", async () => {
    const r = await idle();
    const gone = spawnSync(process.execPath, ["-e", "0"]).pid;
    const started = performance.now();
    const answer = await wait({ kind: "wait", ...about(r), pid: gone }, waitDeps());
    expect(answer).toEqual({ text: null });
    expect(performance.now() - started).toBeLessThan(2_500);
  });
});
