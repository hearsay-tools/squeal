import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publishSlowActivity } from "../../src/core/slow/state.js";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import { nextStep } from "../../src/core/status/next-step.js";
import { readNamedFiles } from "../../src/core/status/standing.js";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { keys, NOW, SLOW_A, SLOW_B, SLOW_C, SLOW_D, SLOW_POLICY, seed } from "./slow-tier-seed.js";

/*
 * Row 011-58 (gh-58; 004 D2 and D8): while this worktree's slow tier waits
 * for the per-user slow slot, status names each held permit's holder:
 * worktree, pid, time held, running files and what it has left; a stale,
 * missing or unreadable holder record says so. The slot's directory is a
 * temporary one, never the host's.
 */

/** No process has this pid: above Linux's and macOS's highest. */
const GONE = 99_999_999;

let runtime: string;
const held: DatabaseSync[] = [];

beforeEach(() => {
  runtime = mkdtempSync(join(tmpdir(), "squeal-slot-status-"));
  mkdirSync(join(runtime, "squeal"), { mode: 0o700 });
  vi.stubEnv("XDG_RUNTIME_DIR", runtime);
});

afterEach(() => {
  for (const db of held.splice(0)) db.close();
  vi.unstubAllEnvs();
  rmSync(runtime, { recursive: true, force: true });
});

/** Holds permit `file` as `takePermit` does, recording `holder`, or none for `null`. */
function hold(file: string, holder: { pid: number; worktreeId: string; since: number } | null) {
  const db = new DatabaseSync(join(runtime, "squeal", file));
  db.exec("PRAGMA locking_mode = EXCLUSIVE");
  db.exec("BEGIN EXCLUSIVE");
  db.exec(
    "CREATE TABLE IF NOT EXISTS holder (pid INTEGER NOT NULL, worktree_id TEXT NOT NULL, since INTEGER NOT NULL)",
  );
  if (holder !== null) {
    db.prepare("INSERT INTO holder (pid, worktree_id, since) VALUES (?, ?, ?)").run(
      holder.pid,
      holder.worktreeId,
      holder.since,
    );
  }
  db.exec("COMMIT");
  held.push(db);
}

/** This worktree's two slow files wait for the slot, its daemon says, under `maxParallel` permits. */
function waiting(maxParallel: number) {
  const s = seed({ ...SLOW_POLICY, slow: { ...SLOW_POLICY.slow, maxParallel } });
  keys(s.store, s.repo, { [SLOW_A]: "queued", [SLOW_B]: "queued" });
  publishSlowActivity(s.store, s.repo.mainId, { kind: "waiting", for: "slot" });
  return s;
}

/** A second worktree of the repository whose live daemon runs SLOW_C with SLOW_D queued. */
function otherRunning(s: ReturnType<typeof waiting>) {
  const other = s.repo.addWorktree("other");
  writeFileSync(join(other.root, "squeal.config.json"), JSON.stringify(SLOW_POLICY));
  s.store.worktrees.upsert({
    id: other.id,
    root: other.root,
    commonDir: s.repo.commonDir,
    isMain: false,
    registeredAt: 1,
    daemon: {
      socketPath: "/run/squeal-other.sock",
      startedAt: NOW - 600_000,
      heartbeatAt: NOW - 1_000,
      heartbeatIntervalMs: 5_000,
      squealVersion: "0.0.0",
    },
  });
  s.store.testFileKeys.upsertMany(
    (
      [
        [SLOW_C, "running"],
        [SLOW_D, "queued"],
        [SLOW_A, "queued"],
      ] as const
    ).map(([path, pending]) => ({
      worktreeId: other.id,
      testFile: { project: "", path: path as never },
      key: `other-${path}` as never,
      revision: 1,
      pending,
    })),
  );
  publishSlowActivity(s.store, other.id, {
    kind: "running",
    path: SLOW_C as never,
    since: NOW - 90_000,
    lastDurationMs: null,
  });
  return other;
}

function snapshotOf(root: string): StatusSnapshot {
  const status = readStatus(root, { now: () => NOW });
  if (!status.available) throw new Error(status.message);
  return status;
}

const slotLine = (s: StatusSnapshot) =>
  formatStatus(s, NOW)
    .split("\n")
    .filter((line) => line.startsWith("Slow slot:"));

describe("status names the slow slot's holders (011-58, gh-58)", () => {
  it("names another worktree holding the slot: its pid, time held, running files and what it has left", () => {
    const s = waiting(1);
    const other = otherRunning(s);
    hold("slow.lock", { pid: process.pid, worktreeId: other.id, since: NOW - 90_000 });

    const snapshot = snapshotOf(s.repo.main);

    expect(slotLine(snapshot)).toEqual([
      `Slow slot: held by ${other.root} (pid ${process.pid}) for 1 min 30 s, running ${SLOW_C}, with 2 more slow test files queued there`,
    ]);
    const lines = formatStatus(snapshot, NOW).split("\n");
    const tier = lines.findIndex((line) => line.startsWith("Slow tier:"));
    expect(lines[tier + 1]).toMatch(/^Slow slot: /);
    expect(snapshot.slowSlot).toEqual({
      permits: 1,
      holders: [
        {
          kind: "live",
          permits: 1,
          pid: process.pid,
          worktreeId: other.id,
          root: other.root,
          since: NOW - 90_000,
          heldMs: 90_000,
          running: [SLOW_C],
          pending: 3,
        },
      ],
    });
  });

  it("several permits: each holder with its count; a stale record and one with no holder say so", () => {
    const s = waiting(4);
    const other = otherRunning(s);
    hold("slow.lock", { pid: process.pid, worktreeId: other.id, since: NOW - 120_000 });
    hold("slow.1.lock", { pid: GONE, worktreeId: "elsewhere", since: NOW - 30_000 });
    hold("slow.2.lock", { pid: process.pid, worktreeId: other.id, since: NOW - 60_000 });
    hold("slow.3.lock", null);

    const snapshot = snapshotOf(s.repo.main);

    expect(slotLine(snapshot)).toEqual([
      `Slow slot: 4 of 4 permits held: 2 by ${other.root} (pid ${process.pid}) for 2 min, running ${SLOW_C}, with 2 more slow test files queued there; 1 by pid ${GONE} of worktree elsewhere of another repository, which is not running: a stale holder record, 30 s old; 1 whose lock file records no holder`,
    ]);
    expect(snapshot.slowSlot?.holders.map((h) => [h.kind, h.permits])).toEqual([
      ["live", 2],
      ["stale", 1],
      ["missing", 1],
    ]);
  });

  it("a named wait's slow file names the holder in its reason", () => {
    const s = waiting(1);
    const other = otherRunning(s);
    hold("slow.lock", { pid: process.pid, worktreeId: other.id, since: NOW - 90_000 });

    const [file] = readNamedFiles(
      s.store,
      s.repo.mainId,
      s.repo.main,
      [{ project: "", path: SLOW_A as never }],
      { state: "alive", lastHeartbeatAt: NOW - 1_000 },
      NOW,
    );

    expect(file?.pending?.kind).toBe("slow");
    if (file?.pending === undefined) throw new Error("the slow file is pending");
    expect(nextStep(file.pending, { named: true }).reason).toBe(
      `slow, run after the fast tests or on {command}; slow slot: held by ${other.root} (pid ${process.pid}) for 1 min 30 s, running ${SLOW_C}, with 2 more slow test files queued there`,
    );
  });

  it("the daemon waits for the slot, which no one holds now: says so", () => {
    const s = waiting(2);

    const snapshot = snapshotOf(s.repo.main);

    expect(slotLine(snapshot)).toEqual([
      "Slow slot: no permit is held now; this worktree's daemon takes one on its next pass",
    ]);
    expect(snapshot.slowSlot).toEqual({ permits: 2, holders: [] });
  });

  it("no line and no field while the slow tier waits for anything else", () => {
    const s = waiting(1);
    publishSlowActivity(s.store, s.repo.mainId, { kind: "waiting", for: "load" });
    hold("slow.lock", { pid: process.pid, worktreeId: "elsewhere", since: NOW - 1_000 });

    const snapshot = snapshotOf(s.repo.main);

    expect(slotLine(snapshot)).toEqual([]);
    expect(snapshot).not.toHaveProperty("slowSlot");
  });
});
