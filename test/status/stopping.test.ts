import { afterEach, describe, expect, it } from "vitest";
import { acquireDaemonLock } from "../../src/core/daemon/lock.js";
import { claimHandoff, handoffFrom } from "../../src/core/delivery/handoff.js";
import { formatRegistration, headerLines } from "../../src/core/delivery/index.js";
import { readLiveHeader } from "../../src/core/delivery/liveness.js";
import { appendNote } from "../../src/core/notes.js";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import { lockFileFor } from "../../src/core/store/index.js";
import {
  type DaemonRecord,
  daemonExitMetaKey,
  type EpochMs,
  notesMetaKey,
  type StatusSnapshot,
} from "../../src/core/types/index.js";
import { appendRevisions, fakeRepo, seedStore } from "./helpers.js";

/*
 * Row 011-34 (011 C9 as amended 2026-10-20, design 011-30 section 4): a
 * daemon whose shutdown began and that still holds its lock is stopping,
 * neither alive nor down. Before it, `squeal start` printed "alive" above a
 * snapshot that said "no daemon running", and `--json` said `down`.
 */

const NOW = Date.UTC(2026, 9, 22, 8, 0, 0) as EpochMs;
const SINCE = (NOW - 12_000) as EpochMs;
const SINCE_TEXT = new Date(SINCE).toISOString();

const releases: (() => void)[] = [];
afterEach(() => {
  for (const release of releases.splice(0)) release();
});

interface Options {
  /** `alive`: its last heartbeat is fresh; `down`: it stopped with the timers at `SINCE`. */
  readonly heartbeat?: "alive" | "down";
  /** A handoff claim for it, at this time (row 011-32). */
  readonly claimAt?: EpochMs;
  /** Whether a process holds its lock. */
  readonly locked?: boolean;
}

/** A worktree whose 0.1.0 daemon began its shutdown at `SINCE`, as `#shutdown` leaves it. */
function stopping({ heartbeat = "down", claimAt, locked = true }: Options = {}) {
  const repo = fakeRepo();
  const store = seedStore(repo);
  const wt = repo.mainId;
  const record: DaemonRecord = {
    socketPath: "/tmp/squeal-stopping.sock",
    startedAt: NOW - 600_000,
    heartbeatAt: heartbeat === "alive" ? NOW - 2_000 : SINCE,
    heartbeatIntervalMs: 5_000,
    squealVersion: "0.1.0",
    token: "old",
  };
  store.worktrees.upsert({
    id: wt,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: record,
  });
  appendRevisions(store, wt, 3, { head: null, dirty: true });
  const self = handoffFrom(record);
  store.meta.set(daemonExitMetaKey(wt), self);
  appendNote(store, wt, { at: SINCE, revision: 3, text: "daemon stepped down", exitOf: self });
  if (claimAt !== undefined) claimHandoff(store, wt, { from: self, to: "0.1.31", at: claimAt });
  // As in a used store, the lock file is there whether or not a process holds it.
  const lock = acquireDaemonLock(lockFileFor(repo.commonDir, wt));
  if (lock === null) throw new Error("the lock is taken");
  if (locked) releases.push(() => lock.release());
  else lock.release();
  const status = (at: EpochMs = NOW) => readStatus(repo.main, { now: () => at }) as StatusSnapshot;
  const header = (at: EpochMs = NOW) => readLiveHeader(store, wt, at);
  return { repo, store, wt, status, header };
}

describe("a daemon whose shutdown began and that holds its lock (row 011-34)", () => {
  it("reads stopping in status, --full and --json, never alive beside down", () => {
    const { status } = stopping();
    const s = status();
    expect(s.daemon).toEqual({
      state: "down",
      since: SINCE,
      stopping: { from: "0.1.0", since: SINCE, overdue: false },
    });
    const text = formatStatus(s, NOW, "squeal", { full: true });
    expect(text).toContain(
      `  the daemon is stopping since ${SINCE_TEXT}; results are as of revision 3; nothing validates until its lock frees`,
    );
    expect(text).toContain(
      `Daemon: stopping since ${SINCE_TEXT} (12 s); nothing validates until its lock frees`,
    );
    expect(text).not.toMatch(/no daemon (?:running|has validated)|Daemon: running/);
    expect(JSON.parse(JSON.stringify(s)).daemon.stopping).toEqual({
      from: "0.1.0",
      since: SINCE,
      overdue: false,
    });
  });

  it("with its heartbeat still fresh, reads stopping, not running", () => {
    const { status } = stopping({ heartbeat: "alive" });
    const s = status();
    expect(s.daemon).toMatchObject({ state: "alive", stopping: { since: SINCE } });
    const text = formatStatus(s, NOW, "squeal", { full: true });
    expect(text).toContain(`Daemon: stopping since ${SINCE_TEXT} (12 s)`);
    expect(text).not.toContain("Daemon: running");
  });

  it("with a handoff claim, names the version that follows and the claim's bound", () => {
    const { status } = stopping({ claimAt: (SINCE + 100) as EpochMs });
    const s = status();
    expect(s.daemon.stopping).toEqual({
      from: "0.1.0",
      since: SINCE,
      to: "0.1.31",
      boundAt: SINCE + 100 + 130_000,
      overdue: false,
    });
    expect(formatStatus(s, NOW, "squeal", { full: true })).toContain(
      `Daemon: handing over from 0.1.0 to 0.1.31 since ${SINCE_TEXT} (12 s); 0.1.31 serves once the old daemon's lock frees`,
    );
  });

  it("past the claim's bound, names `squeal start`", () => {
    const { status } = stopping({ claimAt: (SINCE + 100) as EpochMs });
    const at = (SINCE + 100 + 130_000) as EpochMs;
    const text = formatStatus(status(at), at, "squeal", { full: true });
    expect(text).toContain(
      `Daemon: handing over from 0.1.0 to 0.1.31 since ${SINCE_TEXT} (2 min), past its 130 s bound; \`squeal start\` finishes it`,
    );
    expect(text).toContain(
      `  the daemon is handing over from 0.1.0 to 0.1.31 since ${SINCE_TEXT}, past its 130 s bound; results are as of revision 3; \`squeal start\` finishes it`,
    );
  });

  it("without a claim, names `squeal start` 130 s after its shutdown began", () => {
    const { status } = stopping();
    const before = (SINCE + 129_999) as EpochMs;
    expect(status(before).daemon.stopping?.overdue).toBe(false);
    const at = (SINCE + 130_000) as EpochMs;
    expect(formatStatus(status(at), at, "squeal", { full: true })).toContain(
      `Daemon: stopping since ${SINCE_TEXT} (2 min), past its 130 s bound; \`squeal start\` finishes it`,
    );
  });

  it("says it in the registration header and in a delivery's", () => {
    const { header } = stopping({ claimAt: (SINCE + 100) as EpochMs });
    const live = header();
    expect(live.daemon?.stopping).toMatchObject({ to: "0.1.31", overdue: false });
    const sentence = ` The daemon is handing over from 0.1.0 to 0.1.31 since ${SINCE_TEXT}; 0.1.31 serves once the old daemon's lock frees; results are as of revision 3.`;
    expect(headerLines(live, "squeal", "full")[0]).toContain(sentence);
    expect(headerLines(live, "squeal", "news")[0]).toContain(sentence);
    const registration = formatRegistration({ header: live, knownFailures: [] } as never);
    expect(registration).toContain(sentence);
    expect(registration).not.toMatch(/No daemon (?:is running|has validated)/);
  });

  it("after it cleared its record, a live claim and a held lock still read handing over", () => {
    const { store, wt, status } = stopping({ claimAt: (SINCE + 100) as EpochMs });
    store.worktrees.setDaemon(wt, null);
    expect(status().daemon).toEqual({
      state: "down",
      since: SINCE,
      stopping: {
        from: "0.1.0",
        since: SINCE + 100,
        to: "0.1.31",
        boundAt: SINCE + 100 + 130_000,
        overdue: false,
      },
    });
    const past = (SINCE + 100 + 130_000) as EpochMs;
    expect(status(past).daemon).toEqual({ state: "down", since: SINCE });
  });

  // Review 0.1.259: the lock goes before the successor's process takes it; status read down there.
  it("after it cleared its record and let go of its lock, a live claim still reads handing over", () => {
    const { store, wt, status, header } = stopping({
      claimAt: (SINCE + 100) as EpochMs,
      locked: false,
    });
    store.worktrees.setDaemon(wt, null);
    const handing = {
      from: "0.1.0",
      since: SINCE + 100,
      to: "0.1.31",
      boundAt: SINCE + 100 + 130_000,
      overdue: false,
    };
    expect(status().daemon).toEqual({ state: "down", since: SINCE, stopping: handing });
    expect(header().daemon).toMatchObject({ state: "down", stopping: handing });
    expect(formatStatus(status(), NOW, "squeal")).toContain(
      `the daemon is handing over from 0.1.0 to 0.1.31 since ${new Date(SINCE + 100).toISOString()}`,
    );
  });

  it("after it cleared its record, is plain down with a free lock and no live claim", () => {
    const { store, wt, status, header } = stopping({ locked: false });
    store.worktrees.setDaemon(wt, null);
    expect(status().daemon).toEqual({ state: "down", since: SINCE });
    expect(header().daemon).toEqual({ state: "down", since: SINCE });
    claimHandoff(store, wt, { from: "0.1.0@1#old", to: "0.1.31", at: (SINCE + 100) as EpochMs });
    const past = (SINCE + 100 + 130_000) as EpochMs;
    expect(status(past).daemon).toEqual({ state: "down", since: SINCE });
    expect(header(past).daemon).toEqual({ state: "down", since: SINCE });
  });

  it("is plain down once its lock is free: it was killed while it shut down", () => {
    const { status, header } = stopping({ locked: false });
    expect(status().daemon).toEqual({ state: "down", since: SINCE });
    expect(header().daemon).toEqual({ state: "down", since: SINCE });
  });

  it("is plain alive or down with no shutdown begun, or another incarnation's mark", () => {
    const { store, wt, status } = stopping();
    store.meta.set(daemonExitMetaKey(wt), "0.1.0@1#other");
    store.meta.delete(notesMetaKey(wt));
    expect(status().daemon).toEqual({ state: "down", since: SINCE });
  });
});
