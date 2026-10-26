import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { type WaitLiveness, watchDaemon } from "../../src/cli/wait-liveness.js";
import { acquireDaemonLock, type DaemonLock } from "../../src/core/daemon/lock.js";
import { markSpawn, markStart } from "../../src/core/daemon/start-mark.js";
import { headerLines } from "../../src/core/delivery/header.js";
import { readLiveHeader } from "../../src/core/delivery/liveness.js";
import { markStopped } from "../../src/core/delivery/stopped.js";
import { formatStatus } from "../../src/core/status/index.js";
import { LOCKED_TEXT, SPAWNED_TEXT } from "../../src/core/status/outstanding-text.js";
import { lockFileFor } from "../../src/core/store/index.js";
import type {
  AbsolutePath,
  DaemonLiveness,
  EpochMs,
  WorktreeId,
} from "../../src/core/types/index.js";
import { settled } from "../evals/status-snapshot.js";
import { A, NOW, repoWith } from "./status-wait-fixture.js";

/*
 * Review 0.1.357 B1 (row 011-254; the coordinator, 2026-10-26, request
 * 90086442): a current start wins over a stop. Beside either stop's mark,
 * a cleared or stale record with no start mark, a hook's spawn mark or a
 * daemon that holds the lock and marks its start reads the same in status,
 * `--full`, `--json`, the hooks' header and a wait's first judgment: starting
 * while 011-251's readers read a start, else stopped as the mark says.
 */

const at = (ms: number) => ms as EpochMs;

const saved = { ...process.env };
let runtimeDir: string;
const locks: DaemonLock[] = [];
beforeEach(() => {
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
});
afterEach(() => {
  for (const lock of locks.splice(0)) lock.release();
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

type Record = "cleared" | "stale";
type Start = "none" | "spawn" | "locked";

/**
 * A worktree at revision 4 whose daemon cleared its record (its last
 * heartbeat a second old), or left it a minute stale; a stop's mark after
 * that heartbeat, `--until-start` or plain; and the start `start` marks.
 */
function worktree(record: Record, start: Start, untilStart: boolean) {
  const { repo, store } = repoWith([A]);
  const id = repo.mainId as WorktreeId;
  const daemon = store.worktrees.get(id)?.daemon ?? null;
  store.worktrees.setDaemon(
    id,
    record === "stale" && daemon !== null ? { ...daemon, heartbeatAt: at(NOW - 60_000) } : null,
  );
  store.transaction(() => markStopped(store, id, at(NOW - 200), null, untilStart));
  const lockFile = lockFileFor(repo.commonDir as AbsolutePath, id);
  mkdirSync(dirname(lockFile), { recursive: true });
  if (start === "spawn") markSpawn(lockFile, at(NOW - 500), null);
  if (start === "locked") {
    const lock = acquireDaemonLock(lockFile);
    if (lock === null) throw new Error("the lock is taken");
    locks.push(markStart(lockFile, lock));
  }
  return { repo, store, id, lockFile };
}

async function run(argv: string[], cwd: string): Promise<string> {
  let stdout = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: () => {},
    cwd,
    now: () => at(NOW),
    env: {},
  };
  await main(argv, io);
  return stdout;
}

/** Each reader's words for the worktree. */
async function readers(record: Record, start: Start, untilStart: boolean) {
  const { repo, store, id, lockFile } = worktree(record, start, untilStart);
  const commonDir = repo.commonDir as AbsolutePath;
  const plain = await run(["status"], repo.main);
  return {
    outstanding: plain.split("\n").find((line) => line.startsWith("  no daemon has validated")),
    daemonLine: (await run(["status", "--full"], repo.main))
      .split("\n")
      .find((line) => line.startsWith("Daemon: ")),
    json: JSON.parse(await run(["status", "--json"], repo.main)).daemon,
    header: headerLines(readLiveHeader(store, id, at(NOW)), "squeal").join("\n"),
    wait: watchDaemon(id, { lockFile, commonDir }).judge(
      store.worktrees.get(id)?.daemon ?? null,
      at(NOW),
    ),
  };
}

const MODE = "stopped until `squeal start` (`squeal stop --until-start`)";
const PLAIN = "stopped by request (`squeal stop`)";
const LAPSED: WaitLiveness = { state: "lapsed" };
const LOCKED: WaitLiveness = { state: "lapsed", locked: true };

/** The review's table: the record, the start beside it, what status reads, the wait's judgment. */
const table: [Record, Start, "stopped" | "spawn" | "start", WaitLiveness][] = [
  ["cleared", "none", "stopped", { state: "down", reason: "stopped" }],
  ["cleared", "spawn", "spawn", LOCKED],
  ["cleared", "locked", "start", LOCKED],
  ["stale", "none", "stopped", LAPSED],
  ["stale", "spawn", "stopped", LAPSED],
  ["stale", "locked", "start", LOCKED],
];

describe.each([
  ["`squeal stop --until-start`", true, MODE],
  ["a plain `squeal stop`", false, PLAIN],
] as const)("beside the mark of %s (review 0.1.357 B1)", (_stop, untilStart, named) => {
  it.each(table)(
    "a %s record with start mark %s reads as %s in every reader",
    async (record, start, reads, wait) => {
      const r = await readers(record, start, untilStart);

      expect(r.wait).toEqual(wait);
      if (reads === "stopped") {
        expect(r.json).toMatchObject({ state: "down", stopped: true });
        expect(r.json.untilStart).toBe(untilStart ? true : undefined);
        expect(r.json).not.toHaveProperty("startingSince");
        expect(r.outstanding).toContain(`; ${named}`);
        expect(r.daemonLine).toMatch(new RegExp(`^Daemon: ${escaped(named)}[;:] `));
        expect(r.header).toContain(`The daemon is ${named}`);
        return;
      }
      expect(r.json).toMatchObject({ state: "down", startMark: reads });
      expect(typeof r.json.startingSince).toBe("number");
      expect(r.json).not.toHaveProperty("stopped");
      expect(r.json).not.toHaveProperty("untilStart");
      expect(r.outstanding).toMatch(
        new RegExp(`; ${escaped(reads === "spawn" ? SPAWNED_TEXT : LOCKED_TEXT)}$`),
      );
      expect(r.daemonLine).toMatch(/; a daemon is starting$/);
      expect(r.header).toContain("A daemon is starting; results are as of revision 4.");
      for (const text of [r.outstanding, r.daemonLine, r.header])
        expect(text).not.toContain("stopped");
    },
  );
});

describe("`stopOf`, the one rule the renderers read (review 0.1.357 B1)", () => {
  const down = { state: "down", since: at(1_000) } as const;
  const lines = (daemon: DaemonLiveness) => {
    const snapshot = { ...settled, daemon };
    const header = { ...snapshot, daemon };
    return [
      formatStatus(snapshot, at(20_000), "squeal", { full: true }),
      headerLines(header as never, "squeal").join("\n"),
    ].join("\n");
  };

  it("reads `untilStart` only with `stopped`", () => {
    const text = lines({ ...down, untilStart: true });
    expect(text).not.toContain("stopped until");
    expect(text).toContain("No daemon has validated since");
  });

  it("names no stop while a start is current", () => {
    const text = lines({ ...down, stopped: true, untilStart: true, startingSince: at(19_000) });
    expect(text).not.toContain("stopped");
    expect(text).toContain("A daemon is starting");
  });
});

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\`]/g, "\\$&");
}
