import { describe, expect, it } from "vitest";
import { acquireDaemonLock } from "../../src/core/daemon/lock.js";
import {
  claimHandoff,
  daemonExitMetaKey,
  HANDOFF_BOUND_MS,
} from "../../src/core/presence/index.js";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import { lockFileFor } from "../../src/core/store/index.js";
import {
  type AbsolutePath,
  type DaemonRecord,
  daemonIncarnation,
  type EpochMs,
  type WorktreeId,
} from "../../src/core/types/index.js";
import { type HookDeps, type HookResult, runHook } from "../../src/harness/claude-code/index.js";
import { recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Row 011-295: the "Not validated" line a hook adds after an edit, when it
 * could neither reach nor start a daemon, says what status says for the same
 * presence: beside a daemon that died, the death and `squeal start`; beside
 * a shutdown begun, that the daemon is stopping. The late heartbeat and no
 * daemon are `late-heartbeat.test.ts`; a stop by request prints no line
 * (`stopped.test.ts`).
 */

const T = Date.now() as EpochMs;
const LAST = (T - 20_000) as EpochMs;
const ISO = new Date(LAST).toISOString();
const NO_RESULT = "any change this call made has no result.";
const EDIT = { tool_calls: [{ tool_name: "Edit", tool_input: {}, tool_use_id: "toolu_01A" }] };

/** A hook whose ensure could neither reach nor start a daemon: no CLI, or a daemon that does not answer. */
const unavailable = (now: EpochMs = T): HookDeps => ({
  env: {},
  cli: "/plugin/dist/cli/squeal.mjs",
  now: () => now,
  ensureDaemon: async () => "unavailable",
});

async function registered(): Promise<SquealRepo> {
  const r = squealRepo();
  r.apply(r.pass());
  await runHook("session-start", recorded("session-start", r.root), {
    env: {},
    ensureDaemon: async () => "alive",
  });
  return r;
}

/** The worktree's daemon lock, held as a live daemon holds it. */
function lock(r: SquealRepo) {
  const file = lockFileFor(r.repo.commonDir as AbsolutePath, r.worktreeId as WorktreeId);
  const held = acquireDaemonLock(file);
  if (held === null) throw new Error("the lock is taken");
  return held;
}

/** A recorded daemon with an incarnation, its heartbeat at `LAST`. */
function recordDaemon(r: SquealRepo): DaemonRecord {
  r.store.worktrees.setDaemon(r.worktreeId as WorktreeId, {
    socketPath: "/tmp/squeal-test-not-validated.sock" as AbsolutePath,
    startedAt: 1 as EpochMs,
    heartbeatAt: LAST,
    heartbeatIntervalMs: 5_000,
    squealVersion: "0.0.0-test",
    token: "t1",
  });
  const record = r.store.worktrees.get(r.worktreeId as WorktreeId)?.daemon;
  if (record === null || record === undefined) throw new Error("no record");
  return record;
}

/** Its shutdown began: the exit row names it, as a stopping daemon writes it. */
function shutDown(r: SquealRepo, record: DaemonRecord): void {
  r.store.meta.set(daemonExitMetaKey(r.worktreeId as WorktreeId), daemonIncarnation(record) ?? "");
}

async function edit(r: SquealRepo, now: EpochMs = T): Promise<string[]> {
  const out: HookResult = await runHook(
    "post-tool-batch",
    recorded("post-tool-batch", r.root, EDIT),
    unavailable(now),
  );
  const context = (JSON.parse(out.stdout) as { hookSpecificOutput: { additionalContext: string } })
    .hookSpecificOutput.additionalContext;
  return context.split("\n");
}

function status(r: SquealRepo, now: EpochMs = T) {
  const result = readStatus(r.root as AbsolutePath, { now: () => now });
  if (!result.available) throw new Error("status unavailable");
  return { json: result.daemon, text: formatStatus(result, now, "squeal", { full: true }) };
}

describe("the hook's Not validated line says what status says (row 011-295)", () => {
  it("beside a daemon that died, names the death and `squeal start`", async () => {
    const r = await registered();
    r.daemon("stale", LAST);
    lock(r).release();

    const lines = await edit(r);
    const { json, text } = status(r);

    expect(json).toEqual({ state: "down", since: LAST, died: { runs: [] } });
    expect(text).toContain(
      `no daemon has validated since ${ISO}; results are as of revision 1; it died without shutting down, between runs; \`squeal start\` starts one.`,
    );
    expect(lines.at(-1)).toBe(
      `Not validated: no daemon has validated since ${ISO}; the last daemon died without shutting down, between runs; \`squeal start\` starts one; ${NO_RESULT}`,
    );
    expect(lines.join("\n")).not.toContain("late");
  });

  it("beside a shutdown begun, says the daemon is stopping, as status does", async () => {
    const r = await registered();
    shutDown(r, recordDaemon(r));
    const held = lock(r);
    try {
      const lines = await edit(r);
      const { json, text } = status(r);

      expect(json).toMatchObject({ state: "down", stopping: { since: LAST, overdue: false } });
      const stopping = `stopping since ${ISO}`;
      expect(text).toContain(`Daemon: ${stopping} (20 s); nothing validates until its lock frees`);
      expect(lines).toContain(
        `Revision 1 (changed src/math.ts): no check pending, stale or unknown. The daemon is ${stopping}; nothing validates until its lock frees; results are as of revision 1.`,
      );
      expect(lines.at(-1)).toBe(
        `Not validated: the daemon is ${stopping}; nothing validates until its lock frees; ${NO_RESULT}`,
      );
      expect(lines.join("\n")).not.toMatch(/no daemon|late/);
    } finally {
      held.release();
    }
  });

  it("past its bound, says `squeal start` finishes it, as status does", async () => {
    const r = await registered();
    shutDown(r, recordDaemon(r));
    const now = (LAST + HANDOFF_BOUND_MS + 1_000) as EpochMs;
    const held = lock(r);
    try {
      const lines = await edit(r, now);
      const { text } = status(r, now);

      const past = `stopping since ${ISO}, past its 130 s bound; \`squeal start\` finishes it`;
      expect(text).toContain(`the daemon is stopping since ${ISO}, past its 130 s bound;`);
      expect(text).toContain("`squeal start` finishes it");
      expect(lines.at(-1)).toBe(`Not validated: the daemon is ${past}; ${NO_RESULT}`);
    } finally {
      held.release();
    }
  });

  it("after the old daemon cleared its record, says the handoff, as status does", async () => {
    const r = await registered();
    const record = recordDaemon(r);
    const id = r.worktreeId as WorktreeId;
    const from = daemonIncarnation(record) ?? "";
    claimHandoff(r.store, id, { from, to: "0.1.999", at: LAST });
    r.store.worktrees.setDaemon(id, null);

    const lines = await edit(r);
    const { text } = status(r);

    const handing = `handing over from 0.0.0-test to 0.1.999 since ${ISO}; 0.1.999 serves once the old daemon's lock frees`;
    expect(text).toContain(`Daemon: handing over from 0.0.0-test to 0.1.999 since ${ISO} (20 s)`);
    expect(lines.at(-1)).toBe(`Not validated: the daemon is ${handing}; ${NO_RESULT}`);
  });
});
