import { mkdirSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { META_FULL_CHECK_HOLDER } from "../../src/core/daemon/full-check-claim.js";
import { META_FULL_CHECK } from "../../src/core/store/open.js";
import { storePaths } from "../../src/core/store/paths.js";
import {
  daemonSuite,
  type FixtureRepo,
  ping,
  SLOW,
  spawnDaemon,
  stopProcess,
  waitFor,
  waitReady,
  withStore,
} from "./helpers.js";

const suite = daemonSuite();

/** Rows of filler: about 70 MB, an `integrity_check` of about 2 s on this project's host. */
const FILLER_ROWS = 300_000;

/** The pids of `pid`'s children, from `/proc` (Linux only). */
function childrenOf(pid: number): number[] {
  const found: number[] = [];
  for (const task of readdirSync(`/proc/${pid}/task`)) {
    const text = readFileSync(`/proc/${pid}/task/${task}/children`, "utf8").trim();
    if (text !== "") found.push(...text.split(/\s+/).map(Number));
  }
  return found;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function cmdline(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ").trim();
  } catch {
    return "";
  }
}

/** What `pid` holds open, other than pipes, sockets without a path and anonymous inodes. */
function heldFiles(pid: number): string[] {
  try {
    return readdirSync(`/proc/${pid}/fd`)
      .map((fd) => {
        try {
          return readlinkSync(`/proc/${pid}/fd/${fd}`);
        } catch {
          return "";
        }
      })
      .filter((target) => target.startsWith("/"));
  } catch {
    return [];
  }
}

/** Adds filler to the store and clears the day's claim, so the next daemon runs a long full check. */
function growStore(repo: FixtureRepo): void {
  const db = new DatabaseSync(storePaths(repo.commonDir).database);
  try {
    db.exec("PRAGMA busy_timeout = 10000");
    db.exec("CREATE TABLE filler (id INTEGER PRIMARY KEY, a BLOB, b TEXT)");
    db.exec(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${FILLER_ROWS}) ` +
        "INSERT INTO filler (a, b) SELECT randomblob(64), hex(randomblob(16)) FROM n",
    );
    db.exec("CREATE INDEX filler_a ON filler (a); CREATE INDEX filler_b ON filler (b)");
    db.prepare("DELETE FROM meta WHERE key = ?").run(META_FULL_CHECK);
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
}

/** A daemon spawned in `repo` with a scratch HOME, stopped after the test. */
function scratchDaemon(repo: FixtureRepo) {
  const home = join(repo.runtimeDir, "home");
  mkdirSync(home, { recursive: true });
  const spawned = spawnDaemon(suite.cli, { ...repo, env: { ...repo.env, HOME: home } });
  suite.cleanup(() => {
    if (spawned.child.exitCode === null && spawned.child.signalCode === null) {
      spawned.child.kill("SIGKILL");
    }
  });
  return spawned;
}

/*
 * Row 011-373: a SIGKILLed daemon leaves two children, its runner host and
 * its full integrity check. The check keeps a read-only connection on the
 * store, its WAL and its shared memory until `integrity_check` ends: about
 * 4 s after the kill on this file's first, larger store (notes of the row).
 * WAL readers do not block a writer and the daemon lock is not among its
 * files, so the replacement does not wait for it. This test freezes the
 * check mid-read (SIGSTOP), so it holds its snapshot through the whole
 * replacement start, whatever the load.
 */
describe.runIf(process.platform === "linux")(
  "a SIGKILLed daemon's children (row 011-373)",
  SLOW,
  () => {
    it("its full check, frozen mid-read, does not hold the replacement up; its runner host ends", async () => {
      const repo = suite.fixture();
      const first = scratchDaemon(repo);
      await waitReady(repo, first);
      await stopProcess(first);
      growStore(repo);

      const killed = scratchDaemon(repo);
      const killedPid = killed.child.pid ?? 0;
      await waitReady(repo, killed);
      const isCheck = (pid: number) => / check -e /.test(cmdline(pid));
      const check = await waitFor(
        () => childrenOf(killedPid).find(isCheck) ?? null,
        30_000,
        "the full check's process",
      );
      const database = storePaths(repo.commonDir).database;
      // Reading: its connection holds the store and its WAL.
      await waitFor(
        () => heldFiles(check).includes(`${database}-wal`),
        30_000,
        "the check reading",
      );
      const hosts = childrenOf(killedPid).filter((pid) => / runner-host /.test(cmdline(pid)));
      expect(hosts.length).toBeGreaterThan(0);
      process.kill(check, "SIGSTOP");
      suite.cleanup(() => {
        if (alive(check)) process.kill(check, "SIGKILL");
      });
      const held = heldFiles(check);
      killed.child.kill("SIGKILL");
      await killed.exited;
      const killedAt = performance.now();
      const hostsEnded = waitFor(
        () => hosts.every((pid) => !alive(pid)),
        30_000,
        "hosts ended",
      ).then(() => performance.now() - killedAt);

      const replacement = scratchDaemon(repo);
      const served = await waitFor(() => ping(repo.socketPath, 100), 60_000, "replacement");
      const servedMs = performance.now() - killedAt;
      // Ready is past the start's writes: its scan mark and its worktree record.
      await waitReady(repo, replacement);
      const readyMs = performance.now() - killedAt;
      const hostsMs = await hostsEnded;
      console.log(
        `row 011-373: killed daemon's check held ${held.join(", ")}; replacement serving ` +
          `${servedMs.toFixed(0)} ms and ready ${readyMs.toFixed(0)} ms after the kill with the ` +
          `check frozen mid-read; runner hosts ended ${hostsMs.toFixed(0)} ms after it`,
      );

      expect(served.pid).toBe(replacement.child.pid);
      // The frozen check still holds the store while the replacement serves and writes.
      expect(alive(check)).toBe(true);
      expect(held).toEqual(expect.arrayContaining([database, `${database}-wal`]));
      // The daemon lock is not among its files.
      expect(held.filter((file) => file.includes("/locks/"))).toEqual([]);
      process.kill(check, "SIGKILL");
      await waitFor(() => !alive(check), 10_000, "the check to end");
    });

    /*
     * Row 011-375: the killed daemon took the day's claim on the full check
     * and never answered it. The claim names its holder, so the replacement
     * sees it dead, takes the claim over and runs the check at its start.
     */
    it("its claim on the day's full check ends with it: the replacement runs the check", async () => {
      const repo = suite.fixture();
      const first = scratchDaemon(repo);
      await waitReady(repo, first);
      await stopProcess(first);
      growStore(repo);

      const killed = scratchDaemon(repo);
      const killedPid = killed.child.pid ?? 0;
      await waitReady(repo, killed);
      const isCheck = (pid: number) => / check -e /.test(cmdline(pid));
      const check = await waitFor(
        () => childrenOf(killedPid).find(isCheck) ?? null,
        30_000,
        "the full check's process",
      );
      // Freeze the check before it can answer, so the claim stays unanswered
      // whatever the disk's speed (review 0.1.521 N1).
      process.kill(check, "SIGSTOP");
      suite.cleanup(() => {
        if (alive(check)) process.kill(check, "SIGKILL");
      });
      const claimOf = () => withStore(repo, (store) => store.meta.get(META_FULL_CHECK));
      const killedClaim = claimOf();
      expect(killedClaim).not.toBeNull();
      const holder = withStore(repo, (store) => store.meta.get(META_FULL_CHECK_HOLDER));
      expect(JSON.parse(holder ?? "null")?.process?.pid).toBe(killedPid);
      killed.child.kill("SIGKILL");
      await killed.exited;
      // The orphaned check's answer goes nowhere: end it, so only the replacement checks.
      process.kill(check, "SIGKILL");
      await waitFor(() => !alive(check), 10_000, "the orphaned check to end");

      const replacement = scratchDaemon(repo);
      const replacementPid = replacement.child.pid ?? 0;
      await waitReady(repo, replacement);
      const claimed = await waitFor(
        () => {
          const claim = claimOf();
          return claim !== killedClaim ? claim : null;
        },
        60_000,
        "the replacement's claim",
      );
      expect(Number(claimed)).toBeGreaterThan(Number(killedClaim));
      // Its check answers and keeps the claim, as row 011-235 has it.
      await waitFor(
        () => withStore(repo, (store) => store.meta.get(META_FULL_CHECK_HOLDER) === null) || null,
        60_000,
        "the replacement's check to answer",
      );
      expect(claimOf()).toBe(claimed);
      expect(childrenOf(replacementPid).filter(isCheck)).toEqual([]);
      await stopProcess(replacement);
    });
  },
);
