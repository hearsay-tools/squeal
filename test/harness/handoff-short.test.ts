import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EnsureDaemonOptions } from "../../src/core/daemon/ensure.js";
import {
  claimHandoff,
  endHandoff,
  HANDOFF_BOUND_MS,
  readHandoff,
  readShortHandoff,
} from "../../src/core/delivery/handoff.js";
import { readDaemonNotes } from "../../src/core/notes.js";
import type { DaemonRequest, EpochMs } from "../../src/core/types/index.js";
import { type HookDeps, runHook } from "../../src/harness/claude-code/index.js";
import { openContext } from "../../src/harness/shared/context.js";
import { ensureIfStale } from "../../src/harness/shared/ensure.js";
import { recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Row 011-140 (011 C9, `research/issue-75-77.md` Q2): a Codex kept copy that
 * held older code spawned every successor older than the claim it ended, and
 * the next newer hook stepped it down again, 39 times in 180 s. Such a
 * successor ends the handoff short: one note, no second step-down, and one
 * notice that names `squeal start`. `test/daemon/handoff-short` registers a
 * real daemon under a claim.
 */

const OLD = "0.1.272";
const HOOK = "0.1.273";
const SUCCESSOR = `${OLD}@2#u`;
const EXECUTABLE = "/data/versions/0.1.273/dist/cli/squeal.mjs";
const AT = 1_800_000_000_000 as EpochMs;

let dir: string;
const servers: Server[] = [];
beforeEach(() => {
  dir = mkdtempSync("/tmp/sq-");
});
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  rmSync(dir, { recursive: true, force: true });
});

const handoffNotes = (r: SquealRepo) =>
  readDaemonNotes(r.store, r.worktreeId)
    .map((note) => note.text)
    .filter((text) => text.includes("handoff"));

/** A claim from the old daemon to `HOOK` at `AT`, then the successor's registration at `at`. */
function registers(r: SquealRepo, version: string, at: number = AT + 500): void {
  claimHandoff(r.store, r.worktreeId, { from: `${OLD}@1#t`, to: HOOK, at: AT });
  endHandoff(r.store, r.worktreeId, {
    of: SUCCESSOR,
    version,
    executable: EXECUTABLE,
    at: at as EpochMs,
  });
}

describe("a successor's registration ends the claim (row 011-140)", () => {
  it("ends it short when the successor is older than the claim: its mark and one note", () => {
    const r = squealRepo();
    registers(r, OLD);
    expect(readHandoff(r.store, r.worktreeId)).toBeNull();
    expect(readShortHandoff(r.store, r.worktreeId)).toEqual({
      of: SUCCESSOR,
      version: OLD,
      claimed: HOOK,
      at: AT + 500,
    });
    expect(handoffNotes(r)).toEqual([
      `the handoff to Squeal ${HOOK} ended with a ${OLD} daemon from ${EXECUTABLE}; ` +
        `no hook asks it to step down again, and \`squeal start\` of ${HOOK} replaces it`,
    ]);
  });

  it.each([
    ["of the claim's version", HOOK, AT + 500],
    ["newer than the claim", "0.1.274", AT + 500],
    ["past the claim's bound", OLD, AT + HANDOFF_BOUND_MS],
  ])(
    "ends it with no mark and no note, and clears an earlier mark, for a successor %s",
    (_, version, at) => {
      const r = squealRepo();
      registers(r, OLD);
      registers(r, version, at);
      expect(readHandoff(r.store, r.worktreeId)).toBeNull();
      expect(readShortHandoff(r.store, r.worktreeId)).toBeNull();
      expect(handoffNotes(r)).toHaveLength(1);
    },
  );
});

/** The successor as registered at `OLD`, alive an hour, answering every request; what it was asked. */
async function successor(r: SquealRepo): Promise<DaemonRequest[]> {
  const socketPath = join(dir, "d.sock");
  const asked: DaemonRequest[] = [];
  const server = createServer((socket) => {
    socket.on("error", () => {});
    socket.once("data", (chunk) => {
      const request = JSON.parse(chunk.toString("utf8")) as DaemonRequest;
      asked.push(request);
      const answer =
        request.type === "step-down"
          ? { ok: true, type: "step-down", squealVersion: OLD, steppingDown: true }
          : { ok: true, type: request.type };
      socket.end(`${JSON.stringify({ schemaVersion: 1, ...answer })}\n`);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  recordAt(r, 2, "u");
  return asked;
}

/** Records the daemon of `OLD` started at `startedAt` with `token` on the stand-in socket, alive an hour. */
function recordAt(r: SquealRepo, startedAt: number, token: string): void {
  r.store.worktrees.setDaemon(r.worktreeId, {
    socketPath: join(dir, "d.sock"),
    startedAt: startedAt as EpochMs,
    heartbeatAt: Date.now() as EpochMs,
    heartbeatIntervalMs: 3_600_000,
    squealVersion: OLD,
    token,
  });
}

/** Hook deps at `HOOK`; `calls` are its spawns and lock waits. */
function hookAt(): { calls: EnsureDaemonOptions[]; deps: HookDeps } {
  const calls: EnsureDaemonOptions[] = [];
  const deps: HookDeps = {
    env: {},
    cli: "/plugin/dist/cli/squeal.mjs",
    squealVersion: HOOK,
    harnessProcess: () => null,
    ensureDaemon: async (_root, options) => {
      calls.push(options);
      return options.awaitLockMs === undefined ? "alive" : "spawned";
    },
  };
  return { calls, deps };
}

const boundary = (r: SquealRepo, name: string, deps: HookDeps) =>
  runHook(name as never, recorded(name, r.root, { session_id: "s1" }), deps);

describe("a daemon that ended its handoff short (row 011-140)", () => {
  it("is asked no second step-down, and no hook spawns a successor", async () => {
    const r = squealRepo();
    const asked = await successor(r);
    registers(r, OLD, Date.now());
    const { calls, deps } = hookAt();
    await boundary(r, "session-start", deps);
    await boundary(r, "post-tool-batch", deps);
    await boundary(r, "stop", deps);
    expect(asked.filter((a) => a.type === "step-down")).toEqual([]);
    expect(calls.filter((call) => call.awaitLockMs !== undefined)).toEqual([]);
  });

  it("is told once, naming the claim's version and `squeal start`", async () => {
    const r = squealRepo();
    await successor(r);
    const { deps } = hookAt();
    await boundary(r, "session-start", deps);
    registers(r, OLD, Date.now());
    const first = (await boundary(r, "post-tool-batch", deps)).stdout;
    expect(first).toContain(`SQUEAL · a ${OLD} daemon is validating at revision`);
    expect(first).toContain(`, not ${HOOK}`);
    expect(first).toContain(
      `no hook asks it to step down again, and \`squeal start\` of ${HOOK} replaces it`,
    );
    const second = (await boundary(r, "post-tool-batch", deps)).stdout;
    expect(second).not.toContain("daemon is validating");
  });

  it("is asked nothing when it registers between the hook's read of the record and of the mark", async () => {
    // Review 0.1.277, B1: the hook read the stepping daemon's record, then the
    // successor's mark, and asked the successor at the reused socket.
    const r = squealRepo();
    const asked = await successor(r);
    recordAt(r, 1, "t");
    const { calls, deps } = hookAt();
    let registered = false;
    // The hook's first clock read comes after its read of the record.
    const now = () => {
      if (!registered) {
        registered = true;
        recordAt(r, 2, "u");
        registers(r, OLD, Date.now());
      }
      return Date.now() as EpochMs;
    };
    const location = { root: r.root, commonDir: r.repo.commonDir } as never;
    const context = openContext({ session_id: "s1" }, location);
    if (context === null) throw new Error("no store");
    try {
      expect(await ensureIfStale(context, { ...deps, now })).toBe("fresh");
    } finally {
      context.close();
    }
    expect(registered).toBe(true);
    expect(asked.filter((a) => a.type === "step-down")).toEqual([]);
    expect(calls.filter((call) => call.awaitLockMs !== undefined)).toEqual([]);
  });
});
