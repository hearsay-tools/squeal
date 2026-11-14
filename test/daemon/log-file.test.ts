import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DAEMON_LOG_MAX_BYTES,
  daemonLogLine,
  daemonLogSink,
  openDaemonLog,
  rotateDaemonLog,
} from "../../src/core/daemon/log-file.js";
import { logLongWrites, longWriteLine } from "../../src/core/store/long-write.js";
import { daemonLogFor } from "../../src/core/store/paths.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { fakeRepo } from "../status/helpers.js";
import { open } from "../store/helpers.js";

/*
 * Row 021-32: the daemon's log file, its line, its bound, and the sink a
 * daemon whose stderr is that file writes through.
 */

/** `<ISO 8601 UTC with ms> [<pid>] ` at the start of a line. */
const PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[\d+\] /;

const fds: number[] = [];
let unlog: (() => void) | null = null;
afterEach(() => {
  unlog?.();
  unlog = null;
  for (const fd of fds.splice(0)) closeSync(fd);
});

/** A worktree, its log path, and that log opened for append as a spawn opens it. */
function opened(maxBytes = DAEMON_LOG_MAX_BYTES) {
  const repo = fakeRepo();
  const path = daemonLogFor(repo.commonDir as AbsolutePath, repo.mainId);
  const fd = openDaemonLog(path, maxBytes);
  if (fd === null) throw new Error("the log did not open");
  fds.push(fd);
  return { repo, path, fd };
}

/** Sleeps the thread, holding whatever it holds, with no CPU spent. */
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

describe("the daemon log file (row 021-32)", () => {
  it("lies under the store's logs directory, named by the worktree id", () => {
    expect(daemonLogFor("/r/.git" as AbsolutePath, "0123456789abcdef")).toBe(
      "/r/.git/squeal/logs/daemon-0123456789abcdef.log",
    );
  });

  it("prefixes a line with the UTC time in ms and the pid", () => {
    const at = new Date(Date.UTC(2026, 10, 14, 13, 50, 0, 123));
    expect(daemonLogLine("squeal daemon: long write", at, 41234)).toBe(
      "2026-11-14T13:50:00.123Z [41234] squeal daemon: long write",
    );
  });

  it("rotates at the limit into one previous file, over the one before", () => {
    const { path } = opened();
    writeFileSync(path, "a".repeat(100));
    rotateDaemonLog(path as AbsolutePath, 100);
    expect(readFileSync(path, "utf8")).toBe("");
    expect(readFileSync(`${path}.1`, "utf8")).toBe("a".repeat(100));

    writeFileSync(path, "b".repeat(99));
    rotateDaemonLog(path as AbsolutePath, 100);
    expect(readFileSync(path, "utf8")).toBe("b".repeat(99));

    writeFileSync(path, "c".repeat(150));
    rotateDaemonLog(path as AbsolutePath, 100);
    expect(readFileSync(`${path}.1`, "utf8")).toBe("c".repeat(150));
    expect(existsSync(`${path}.2`)).toBe(false);
  });

  it("rotates a full file before a spawn opens it, and keeps the descriptor writing to the path", () => {
    const { path, fd } = opened(64);
    writeFileSync(fd, "x".repeat(64));
    const again = openDaemonLog(path as AbsolutePath, 64);
    if (again === null) throw new Error("the log did not open");
    fds.push(again);
    expect(readFileSync(`${path}.1`, "utf8")).toBe("x".repeat(64));
    // The earlier descriptor appends at the truncated end, into the file a reader finds.
    writeFileSync(fd, "old\n");
    writeFileSync(again, "new\n");
    expect(readFileSync(path, "utf8")).toBe("old\nnew\n");
  });

  it("does not open when its directory cannot be made", () => {
    const repo = fakeRepo();
    const path = daemonLogFor(repo.commonDir as AbsolutePath, repo.mainId);
    writeFileSync(join(repo.commonDir, "squeal"), "a file where the store directory goes");
    expect(openDaemonLog(path)).toBeNull();
  });
});

describe("the daemon's log sink (row 021-32)", () => {
  it("is none when stderr is not the worktree's log", () => {
    const { repo } = opened();
    const other = openSync(join(repo.main, "other.log"), "a");
    fds.push(other);
    expect(daemonLogSink(repo.main as AbsolutePath, DAEMON_LOG_MAX_BYTES, other)).toBeNull();
  });

  it("writes each line with time and pid, a long write over 250 ms among them", () => {
    const { repo, path, fd } = opened();
    const sink = daemonLogSink(repo.main as AbsolutePath, DAEMON_LOG_MAX_BYTES, fd);
    if (sink === null) throw new Error("no sink on the worktree's log");
    const log = (line: string) => sink(`squeal daemon: ${line}`);
    // As the daemon's lifecycle wires it (`lifecycle.ts`): the long-write line goes to `log`.
    unlog = logLongWrites((write) => log(longWriteLine(write)));
    log("started");
    const store = open(repo.commonDir);
    store.transaction(() => {
      store.meta.set("slow", "1");
      sleep(300);
    });

    const lines = readFileSync(path, "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).toMatch(PREFIX);
    expect(lines[0]).toContain(` [${process.pid}] squeal daemon: started`);
    expect(lines[1]).toMatch(/squeal daemon: long write: store\.sqlite write lock held \d+ ms by /);
  });

  it("keeps the log within its bound while it writes", () => {
    const { repo, path, fd } = opened(200);
    const sink = daemonLogSink(repo.main as AbsolutePath, 200, fd);
    if (sink === null) throw new Error("no sink on the worktree's log");
    for (let i = 0; i < 20; i++) sink(`line ${i} ${"y".repeat(40)}`);
    const current = readFileSync(path, "utf8");
    const previous = readFileSync(`${path}.1`, "utf8");
    // Each file reaches the limit by at most one line before it rotates.
    expect(current.length).toBeLessThan(200);
    expect(previous.length).toBeGreaterThanOrEqual(200);
    expect(previous.length).toBeLessThan(200 + 100);
    expect(current).toContain("line 19 ");
    expect(previous.split("\n")[0]).toMatch(PREFIX);
  });

  it("never throws when the write fails", () => {
    const { repo, fd } = opened();
    const sink = daemonLogSink(repo.main as AbsolutePath, DAEMON_LOG_MAX_BYTES, fd);
    if (sink === null) throw new Error("no sink on the worktree's log");
    closeSync(fds.splice(fds.indexOf(fd), 1)[0] as number);
    expect(() => sink("lost")).not.toThrow();
  });
});
