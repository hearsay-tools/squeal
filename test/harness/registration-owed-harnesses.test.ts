import { describe, expect, it } from "vitest";
import { owedRegistration } from "../../src/core/delivery/registration-owed.js";
import { bridgeDeps, register } from "../../src/harness/opencode/bridge.js";
import { after as toolResult } from "../../src/harness/opencode/bridge-turn.js";
import { startRun } from "../../src/harness/pi/run.js";
import { startSession, toolBoundary } from "../../src/harness/pi/session.js";
import { HandOff } from "../../src/harness/shared/hand-off.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { PRIMER_OPENING } from "../../src/harness/shared/primer.js";
import { hangingEnsure, piDeps, SESSION, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Row 005-98, decision C in Pi and OpenCode (review 0.1.541): their starts register before the
 * daemon's start, so a kill at the 2 s deadline during that start leaves a registered consumer
 * whose header never reached the host. The next delivery says the registration, with the known
 * failure in it, once; the one after only news. No primer: both harnesses put it in the system
 * prompt (Pi's run start, OpenCode's register and prompt answers).
 */

const FIRST_FAIL = /^SQUEAL · registered at revision \d+\n/;

/** A worktree with one known failure and no daemon. */
function failing(): SquealRepo {
  const r = squealRepo();
  r.apply(r.fail());
  r.daemon("none");
  return r;
}

async function registered(r: SquealRepo): Promise<void> {
  await expect.poll(() => r.store.consumers.get(r.consumer()) !== null).toBe(true);
}

const ocDeps = (overrides: Partial<HookDeps> = {}): HookDeps => ({
  ...bridgeDeps(new URL("file:///pkg/dist/hooks/register.mjs"), { worktree: "/", pid: 1 }),
  env: {},
  ensureDaemon: async () => "alive",
  ...overrides,
});

describe("Pi: a session start killed during the daemon's start (row 005-98 C)", () => {
  async function killedStart(r: SquealRepo) {
    const h = hangingEnsure();
    const start = startSession(
      { sessionId: SESSION, cwd: r.root, reason: "startup" },
      piDeps({ ensureDaemon: h.ensureDaemon }),
    );
    await registered(r);
    r.daemon("alive");
    return async () => {
      h.release();
      await start;
    };
  }

  it("the next run start carries the registration with its failure once", async () => {
    const r = failing();
    const end = await killedStart(r);
    const first = await startRun({ sessionId: SESSION, cwd: r.root }, piDeps());
    expect(first.news).toMatch(FIRST_FAIL);
    expect(first.news).toContain("FAIL");
    expect(first.news).not.toContain(PRIMER_OPENING);
    expect(first.primer?.startsWith(PRIMER_OPENING)).toBe(true);
    expect((await startRun({ sessionId: SESSION, cwd: r.root }, piDeps())).news).toBeNull();
    await end();
  });

  it("the next tool boundary carries it when that comes first", async () => {
    const r = failing();
    const end = await killedStart(r);
    const first = await toolBoundary({ sessionId: SESSION, cwd: r.root }, piDeps());
    expect(first).toMatch(FIRST_FAIL);
    expect(first).toContain("FAIL");
    expect(first).not.toContain(PRIMER_OPENING);
    expect(await toolBoundary({ sessionId: SESSION, cwd: r.root }, piDeps())).toBeNull();
    await end();
  });

  it("a start that completed leaves nothing owed", async () => {
    const r = failing();
    await startSession({ sessionId: SESSION, cwd: r.root, reason: "startup" }, piDeps());
    expect((await startRun({ sessionId: SESSION, cwd: r.root }, piDeps())).news).toBeNull();
  });

  it("an answer the host took (hand-off committed) leaves nothing owed; a lost one stays owed", async () => {
    for (const taken of [true, false]) {
      const r = failing();
      const handOff = new HandOff();
      const text = await startSession(
        { sessionId: SESSION, cwd: r.root, reason: "startup" },
        piDeps({ handOff }),
      );
      expect(text).toContain("FAIL");
      if (taken) handOff.commit();
      else handOff.abandon();
      expect(owedRegistration(r.store, r.consumer())).toEqual(taken ? null : { primer: false });
      const news = (await startRun({ sessionId: SESSION, cwd: r.root }, piDeps())).news;
      if (taken) expect(news).toBeNull();
      else expect(news).toContain("FAIL");
    }
  });

  it("a first registration at a run start, killed during the daemon's start, is the next run's news", async () => {
    const r = failing();
    const h = hangingEnsure();
    const run = startRun(
      { sessionId: SESSION, cwd: r.root },
      piDeps({ ensureDaemon: h.ensureDaemon }),
    );
    await registered(r);
    r.daemon("alive");
    const next = await startRun({ sessionId: SESSION, cwd: r.root }, piDeps());
    expect(next.news).toMatch(FIRST_FAIL);
    expect(next.news).toContain("FAIL");
    expect((await startRun({ sessionId: SESSION, cwd: r.root }, piDeps())).news).toBeNull();
    h.release();
    await run;
  });
});

describe("OpenCode: a register killed during the daemon's start (row 005-98 C)", () => {
  const about = (r: SquealRepo) => ({
    consumer: { sessionId: SESSION },
    worktree: r.root,
    pid: process.pid,
  });

  it("the next tool result carries the registration with its failure once", async () => {
    const r = failing();
    const h = hangingEnsure();
    const start = register(
      { kind: "register", ...about(r) },
      ocDeps({ ensureDaemon: h.ensureDaemon }),
    );
    await registered(r);
    r.daemon("alive");
    const first = (await toolResult({ kind: "after", ...about(r), tool: "bash" }, ocDeps())).text;
    expect(first).toMatch(FIRST_FAIL);
    expect(first).toContain("FAIL");
    expect(first).not.toContain(PRIMER_OPENING);
    expect(
      (await toolResult({ kind: "after", ...about(r), tool: "bash" }, ocDeps())).text,
    ).toBeNull();
    h.release();
    await start;
  });

  it("an answer the plugin took (hand-off committed) leaves nothing owed; a lost one stays owed", async () => {
    for (const taken of [true, false]) {
      const r = failing();
      const handOff = new HandOff();
      const answer = await register({ kind: "register", ...about(r) }, ocDeps({ handOff }));
      expect(answer.header).toContain("FAIL");
      if (taken) handOff.commit();
      else handOff.abandon();
      const text = (await toolResult({ kind: "after", ...about(r), tool: "bash" }, ocDeps())).text;
      if (taken) expect(text).toBeNull();
      else expect(text).toContain("FAIL");
    }
  });

  it("a register that completed leaves nothing owed", async () => {
    const r = failing();
    await register({ kind: "register", ...about(r) }, ocDeps());
    expect(
      (await toolResult({ kind: "after", ...about(r), tool: "bash" }, ocDeps())).text,
    ).toBeNull();
  });
});
