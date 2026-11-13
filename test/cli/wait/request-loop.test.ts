import { afterEach, describe, expect, it } from "vitest";
import { untilTaken } from "../../../src/cli/wait/wait.js";
import type { DaemonResponse } from "../../../src/core/types/daemon.js";
import { type Answer, closeFakeDaemons, fakeDaemon, received } from "../fake-daemon.js";
import { closeLoopFixtures, socketPath, stalling, steppedClock, timingOut } from "./fixture.js";

/*
 * Row 011-326: the loop that waits for the daemon to take a request, one
 * entry for `run --all`, `run --slow`, `run <group>` (with its narrow run)
 * and a lint group, over the fake daemon socket and a stepped clock. Each
 * row pins a cell of its loop: whose id a status request names, the pause,
 * the socket bound and what a wrong answer means.
 */

afterEach(() => {
  closeFakeDaemons();
  closeLoopFixtures();
});

/** A stepped clock whose pauses move it on by at least 1 ms, as real time does. */
function clock() {
  const c = steppedClock();
  const pause = c.ports.pause;
  return { ...c, ports: { ...c.ports, pause: (ms: number) => pause(Math.max(ms, 1)) } };
}

const answer = (fields: Record<string, unknown>) =>
  ({ schemaVersion: 1, ok: true, error: null, ...fields }) as unknown as DaemonResponse;
const runAll = (requestId: string, checkpoint: object | null) =>
  answer({ type: "run-all", requestId, checkpoint });
const runSlow = (requestId: string, requested: object | null) =>
  answer({ type: "run-slow", requestId, requested });
const runGroup = (fields: Record<string, unknown> = {}) =>
  answer({
    type: "run-group",
    requestId: "g1",
    group: "e2e",
    requested: null,
    unknown: false,
    ...fields,
  });

/** The fake daemon on `socket`, answering each status request type from its list. */
const listen = (socket: string, answers: Record<string, readonly DaemonResponse[]>) =>
  fakeDaemon(socket, answers as unknown as Record<string, Answer[]>);

const CHECKPOINT = { id: "c1", revision: 3 };
const QUEUED = { revision: 3, queued: 1 };

describe("until the daemon takes a request (row 011-326)", () => {
  it("run-all: status requests name the first answer's id, 100 ms apart", async () => {
    const c = clock();
    const socket = socketPath();
    await listen(socket, { "run-all-status": [runAll("r2", null), runAll("r2", CHECKPOINT)] });
    const first = runAll("r1", null);
    const outcome = await untilTaken(
      { loop: "run-all", socketPath: socket, first, deadline: c.start + 60_000 },
      c.ports,
    );
    expect(outcome).toEqual({ kind: "taken", answer: runAll("r2", CHECKPOINT) });
    expect(received).toEqual([
      { type: "run-all-status", requestId: "r1" },
      { type: "run-all-status", requestId: "r1" },
    ]);
    expect(c.pauses).toEqual([100, 100]);
  });

  it("run-slow: status requests name the last answer's id", async () => {
    const c = clock();
    const socket = socketPath();
    await listen(socket, { "run-slow-status": [runSlow("s2", null), runSlow("s2", QUEUED)] });
    const outcome = await untilTaken(
      {
        loop: "run-slow",
        socketPath: socket,
        first: runSlow("s1", null),
        deadline: c.start + 60_000,
      },
      c.ports,
    );
    expect(outcome).toEqual({ kind: "taken", answer: runSlow("s2", QUEUED) });
    expect(received).toEqual([
      { type: "run-slow-status", requestId: "s1" },
      { type: "run-slow-status", requestId: "s2" },
    ]);
  });

  it("run-all: a fixed 100 ms pause past the deadline, then pending (`now > deadline`)", async () => {
    const c = clock();
    const socket = socketPath();
    await listen(socket, { "run-all-status": [runAll("r1", null)] });
    const outcome = await untilTaken(
      { loop: "run-all", socketPath: socket, first: runAll("r1", null), deadline: c.start + 150 },
      c.ports,
    );
    expect(outcome).toEqual({ kind: "pending", answer: runAll("r1", null) });
    expect(c.pauses).toEqual([100, 100]);
  });

  it("run-group: pauses end at the deadline, and one more ask at it, then pending", async () => {
    const c = clock();
    const socket = socketPath();
    await listen(socket, { "run-group-status": [runGroup()] });
    const outcome = await untilTaken(
      { loop: "run-group", socketPath: socket, first: runGroup(), deadline: c.start + 150 },
      c.ports,
    );
    expect(outcome).toEqual({ kind: "pending", answer: runGroup() });
    expect(c.pauses).toEqual([100, 50, 1]);
    expect(received).toHaveLength(3);
  });

  it("run-group: a status request the deadline cut short leaves the last answer pending", async () => {
    const c = clock();
    const socket = socketPath();
    await stalling(socket, () => null);
    const first = runGroup({ holder: null });
    const outcome = await untilTaken(
      { loop: "run-group", socketPath: socket, first, deadline: c.start + 150 },
      c.ports,
    );
    expect(outcome).toEqual({ kind: "pending", answer: first });
  });

  it("run-group: unknown group, failed and taken from the first answer, with no ask", async () => {
    const socket = socketPath();
    const ask = (first: DaemonResponse) =>
      untilTaken({
        loop: "run-group",
        socketPath: socket,
        first,
        deadline: Number.POSITIVE_INFINITY,
      });
    expect(await ask(runGroup({ unknown: true }))).toEqual({
      kind: "unknown group",
      answer: runGroup({ unknown: true }),
    });
    expect(await ask(runGroup({ error: "boom" }))).toEqual({ kind: "failed", error: "boom" });
    expect(await ask(runGroup({ requested: QUEUED }))).toMatchObject({ kind: "taken" });
    expect(await ask(answer({ type: "ping" }))).toEqual({
      kind: "refused",
      error: "unexpected answer",
    });
    const unknownType = { schemaVersion: 1, ok: false, error: "unknown request type: run-group" };
    expect(await ask(unknownType as DaemonResponse)).toEqual({ kind: "unsupported" });
  });

  it("stopped: no daemon listens for the status request", async () => {
    const c = clock();
    const outcome = await untilTaken(
      {
        loop: "run-group",
        socketPath: socketPath(),
        first: runGroup(),
        deadline: c.start + 60_000,
      },
      c.ports,
    );
    expect(outcome).toEqual({ kind: "stopped" });
  });

  it("run-all: an answer of another type is a stopped daemon; run-slow: a refusal", async () => {
    const c = clock();
    const socket = socketPath();
    const refused = { schemaVersion: 1, ok: false, error: "busy" } as DaemonResponse;
    await listen(socket, { "run-all-status": [refused], "run-slow-status": [refused] });
    const deadline = c.start + 60_000;
    expect(
      await untilTaken(
        { loop: "run-all", socketPath: socket, first: runAll("r1", null), deadline },
        c.ports,
      ),
    ).toEqual({ kind: "stopped" });
    expect(
      await untilTaken(
        { loop: "run-slow", socketPath: socket, first: runSlow("s1", null), deadline },
        c.ports,
      ),
    ).toEqual({ kind: "refused", error: "busy" });
  });

  it("run-all and run-slow: a status request with no answer within 2 s is a busy daemon, no throw (011-327, review 0.1.469 N2)", async () => {
    const c = clock();
    const socket = socketPath();
    const ports = timingOut(c.ports, ["run-all-status", "run-slow-status"]);
    const deadline = c.start + 60_000;
    expect(
      await untilTaken(
        { loop: "run-all", socketPath: socket, first: runAll("r1", null), deadline },
        ports,
      ),
    ).toEqual({ kind: "unanswered", answer: runAll("r1", null), words: " within 2 s" });
    expect(
      await untilTaken(
        { loop: "run-slow", socketPath: socket, first: runSlow("s1", null), deadline },
        ports,
      ),
    ).toEqual({ kind: "unanswered", answer: runSlow("s1", null), words: " within 2 s" });
  });

  it("run-all and run-slow: a status request the deadline cut short leaves the request pending (011-327)", async () => {
    const c = clock();
    const socket = socketPath();
    const ports = timingOut(c.ports, ["run-all-status", "run-slow-status"]);
    const deadline = c.start + 150;
    expect(
      await untilTaken(
        { loop: "run-all", socketPath: socket, first: runAll("r1", null), deadline },
        ports,
      ),
    ).toEqual({ kind: "pending", answer: runAll("r1", null) });
    expect(
      await untilTaken(
        { loop: "run-slow", socketPath: socket, first: runSlow("s1", null), deadline },
        ports,
      ),
    ).toEqual({ kind: "pending", answer: runSlow("s1", null) });
  });
});
