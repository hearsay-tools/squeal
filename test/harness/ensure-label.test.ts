import {
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { type EnsuredDaemon, ensureDaemonProcess } from "../../src/core/daemon/ensure.js";
import { resolveCommonDir, worktreeIdFor } from "../../src/core/fs/index.js";
import { worktreeLabel } from "../../src/core/process-label.js";
import { discover } from "../../src/core/ps/discover.js";
import { createProcSource } from "../../src/core/ps/proc.js";
import type { AbsolutePath } from "../../src/core/types/index.js";
import { keepVersion } from "../../src/harness/shared/version-copies.js";
import { tempDir } from "../store/helpers.js";

/*
 * Spec 005 D3, project-first process commands (row 005-88), at the daemon's
 * real spawn: argv0 is the label, and the executable, the pinned CLI and
 * every argument after it stay, so `squeal ps` still finds the daemon by its
 * arguments and pruning still keeps the old copy it runs from.
 */

/** More than a day ago: past the 24 h keep of a copy (row 005-83). */
const DAY_AGO = Date.now() / 1000 - 2 * 24 * 60 * 60;
const LOCK_WAIT = ["--await-lock", "60000"];

interface Snapshot {
  readonly argv: string[];
  readonly argv0: string;
  readonly execPath: string;
  readonly execArgv: string[];
  readonly cmdline: string[];
}

const spawned: EnsuredDaemon[] = [];

afterEach(async () => {
  for (const daemon of spawned.splice(0)) {
    if (daemon.pid !== null && !daemon.ended()) process.kill(daemon.pid, "SIGKILL");
    for (let i = 0; i < 100 && !daemon.ended(); i++) await sleep(20);
  }
});

/** A main checkout `project with spaces` and a linked worktree `linked tree`, git's layout. */
function repo(): { main: AbsolutePath; linked: AbsolutePath; scratch: string } {
  const scratch = realpathSync(tempDir("squeal-label-"));
  const main = join(scratch, "project with spaces") as AbsolutePath;
  const commonDir = join(main, ".git");
  mkdirSync(commonDir, { recursive: true });
  writeFileSync(join(commonDir, "HEAD"), "ref: refs/heads/main\n");
  const linked = join(scratch, "linked tree") as AbsolutePath;
  const gitdir = join(commonDir, "worktrees", "linked");
  mkdirSync(gitdir, { recursive: true });
  mkdirSync(linked);
  writeFileSync(join(gitdir, "commondir"), "../..\n");
  writeFileSync(join(linked, ".git"), `gitdir: ${gitdir}\n`);
  return { main, linked, scratch };
}

/**
 * Version `version`'s copy under `data`, kept as a session start keeps it and
 * dated past the 24 h keep. Its CLI writes what it was started with to
 * `<snapshots>/<pid>.json`, then idles as a daemon would.
 */
function copy(data: string, version: string, snapshots: string): string {
  const root = join(data, "..", "plugin", version);
  mkdirSync(join(root, ".codex-plugin"), { recursive: true });
  mkdirSync(join(root, "dist", "cli"), { recursive: true });
  writeFileSync(join(root, ".codex-plugin", "plugin.json"), JSON.stringify({ version }));
  writeFileSync(
    join(root, "dist", "cli", "squeal.mjs"),
    `import { readFileSync, renameSync, writeFileSync } from "node:fs";
const cmdline = readFileSync("/proc/self/cmdline", "utf8").split("\\0").slice(0, -1);
const snapshot = { argv: process.argv, argv0: process.argv0, execPath: process.execPath, execArgv: process.execArgv, cmdline };
const file = ${JSON.stringify(snapshots)} + "/" + process.pid + ".json";
writeFileSync(file + ".tmp", JSON.stringify(snapshot));
renameSync(file + ".tmp", file);
setTimeout(() => {}, 30_000);
`,
  );
  expect(keepVersion({ root, data, version })).not.toBeNull();
  utimesSync(join(data, "versions", version), DAY_AGO, DAY_AGO);
  return join(data, "versions", version, "dist", "cli", "squeal.mjs");
}

async function snapshotOf(snapshots: string, pid: number): Promise<Snapshot> {
  const file = join(snapshots, `${pid}.json`);
  for (let i = 0; i < 250 && !existsSync(file); i++) await sleep(20);
  return JSON.parse(readFileSync(file, "utf8")) as Snapshot;
}

/** The daemon of `root` spawned from `cli`, as a successor spawns it (no probe), and what it saw. */
async function spawnDaemon(root: AbsolutePath, cli: string, snapshots: string) {
  const { SQUEAL_CLI: _, ...env } = process.env;
  const daemon = await ensureDaemonProcess(root, { cli, env, awaitLockMs: 60_000 });
  spawned.push(daemon);
  expect(daemon.result).toBe("spawned");
  const pid = daemon.pid ?? 0;
  return { daemon, pid, snapshot: await snapshotOf(snapshots, pid) };
}

describe.runIf(process.platform === "linux")(
  "the daemon's spawn shows its project (005-88)",
  () => {
    it.each(["main", "linked"] as const)(
      "labels a %s worktree's daemon and keeps its executable and arguments",
      async (which) => {
        const r = repo();
        const root = r[which];
        const snapshots = join(r.scratch, "snapshots");
        mkdirSync(snapshots);
        const cli = copy(join(r.scratch, "data"), "0.1.1", snapshots);
        const { pid, snapshot } = await spawnDaemon(root, cli, snapshots);

        const id = worktreeIdFor(root);
        const label = `squeal project-with-spaces daemon @${id.slice(0, 8)}`;
        expect(label).toBe(worktreeLabel("daemon", root, resolveCommonDir(root), id));
        const args = [cli, "daemon", root, ...LOCK_WAIT];
        expect(snapshot.cmdline).toEqual([label, ...args]);
        expect(snapshot.argv).toEqual([process.execPath, ...args]);
        expect(snapshot.argv0).toBe(label);
        expect(snapshot.execPath).toBe(process.execPath);
        expect(snapshot.execArgv).toEqual([]);
        expect(readlinkSync(`/proc/${pid}/exe`)).toBe(process.execPath);

        const source = createProcSource();
        const places = { uid: process.getuid?.() ?? 0, runtimeDir: null, tempDir: r.scratch };
        const { daemons } = discover(source, source.processTable([pid]), places);
        expect(daemons).toHaveLength(1);
        expect(daemons[0]).toMatchObject({
          script: cli,
          root,
          worktreeId: id,
          commonDir: resolveCommonDir(r.main),
          lockWaitMs: 60_000,
        });
      },
    );

    it("keeps the old copy a labelled daemon runs from, and prunes it once the daemon exits", async () => {
      const r = repo();
      const data = join(r.scratch, "data");
      const snapshots = join(r.scratch, "snapshots");
      mkdirSync(snapshots);
      const oldest = copy(data, "0.1.1", snapshots);
      copy(data, "0.1.2", snapshots);
      const { daemon, snapshot } = await spawnDaemon(r.main, oldest, snapshots);
      expect(snapshot.cmdline[0]).toMatch(/^squeal project-with-spaces daemon @/);

      // Two newer copies, every copy past the 24 h keep: only a running process keeps 0.1.1.
      copy(data, "0.1.3", snapshots);
      expect(existsSync(oldest)).toBe(true);

      process.kill(daemon.pid ?? 0, "SIGKILL");
      for (let i = 0; i < 100 && !daemon.ended(); i++) await sleep(20);
      expect(daemon.ended()).toBe(true);
      copy(data, "0.1.4", snapshots);
      expect(existsSync(oldest)).toBe(false);
    });
  },
);
