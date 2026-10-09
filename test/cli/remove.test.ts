import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { removeCommand } from "../../src/cli/remove.js";
import { acquireDaemonLock } from "../../src/core/daemon/lock.js";
import { preparePrivateDir, socketPathFor, userTmpDir } from "../../src/core/daemon/paths.js";
import { daemonScratch } from "../../src/core/daemon/scratch.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/index.js";
import { lockFileFor } from "../../src/core/store/paths.js";
import { runHook } from "../../src/harness/claude-code/index.js";
import { daemonSuite, SLOW, spawnCli, waitFor, waitReady } from "../daemon/helpers.js";
import { recorded } from "../harness/helpers.js";
import { git } from "../hash/git-repo.js";

/*
 * Task 001-90: `squeal remove` takes Squeal out of a repository. Every
 * worktree's daemon stops, `<common-dir>/squeal/` and the daemons' temp
 * directories go, and nothing is deleted while a daemon still holds its lock.
 */

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function capture(cwd: string) {
  const out = { stdout: "", stderr: "" };
  const io: CliIo = {
    stdout: (text) => {
      out.stdout += text;
    },
    stderr: (text) => {
      out.stderr += text;
    },
    cwd,
  };
  return { io, out };
}

async function run(argv: string[], cwd: string) {
  const { io, out } = capture(cwd);
  const code = await main(argv, io);
  return { code, ...out };
}

/** A git repository with a store that records its worktree, and the daemon's temp directory a crashed daemon left. */
function storedRepo() {
  const root = realpathSync(mkdtempSync("/tmp/squeal-remove-"));
  dirs.push(root);
  git(root, ["init", "-q"]);
  const commonDir = join(root, ".git");
  const store = openStore(commonDir);
  if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
  const id = worktreeIdFor(root);
  store.worktrees.upsert({ id, root, commonDir, isMain: true, registeredAt: 1, daemon: null });
  store.close();
  const scratch = daemonScratch(commonDir, root);
  preparePrivateDir(scratch.userDir, undefined, "temp directory");
  mkdirSync(scratch.tempDir, { recursive: true });
  dirs.push(scratch.tempDir);
  return { root, commonDir, id, storeDir: join(commonDir, "squeal"), tempDir: scratch.tempDir };
}

describe("squeal remove", () => {
  const suite = daemonSuite();

  it(
    "stops the daemons of two worktrees and deletes the store and their temp directories",
    async () => {
      const repo = suite.fixture();
      const linked = join(dirname(repo.root), "linked");
      git(repo.root, ["worktree", "add", "-q", linked, "-b", "linked"]);
      const linkedRepo = {
        ...repo,
        root: realpathSync(linked),
        worktreeId: worktreeIdFor(realpathSync(linked)),
        socketPath: socketPathFor(worktreeIdFor(realpathSync(linked)), {
          XDG_RUNTIME_DIR: repo.runtimeDir,
        }),
      };
      const daemons = [suite.daemon(repo), suite.daemon(linkedRepo)];
      await waitReady(repo, daemons[0]);
      await waitReady(linkedRepo, daemons[1]);
      const scratches = [repo, linkedRepo].map((r) => daemonScratch(repo.commonDir, r.root));
      for (const { tempDir } of scratches) expect(existsSync(tempDir)).toBe(true);
      // A fallback directory an earlier daemon left; no daemon of the key removes it on exit.
      const fallback = `${userTmpDir()}-${scratches[1]?.tempDir.split("/").pop()}-left`;
      mkdirSync(fallback);
      suite.cleanup(() => rmSync(fallback, { recursive: true, force: true }));

      const remove = spawnCli(suite.cli, ["remove"], { cwd: repo.root, env: repo.env });
      expect(await remove.exited, remove.stderr()).toEqual({ code: 0, signal: null });
      for (const daemon of daemons) {
        await waitFor(() => daemon.child.exitCode !== null, 10_000, "daemon exit");
      }
      expect(remove.stdout()).toContain(`  ${repo.root}\n`);
      expect(remove.stdout()).toContain(`  ${linkedRepo.root}\n`);
      expect(remove.stdout()).toContain(`  ${fallback} (a daemon's temp directory)\n`);
      expect(remove.stdout()).toContain("Removed:\n");
      expect(remove.stdout()).toContain(`\n  ${repo.commonDir}/squeal (store, `);
      expect(remove.stdout()).toContain("claude plugin uninstall squeal");
      expect(existsSync(join(repo.commonDir, "squeal"))).toBe(false);
      for (const { tempDir } of scratches) expect(existsSync(tempDir)).toBe(false);
      expect(existsSync(fallback)).toBe(false);

      // A worktree without a config: SessionStart says nothing and starts nothing.
      let ensured = 0;
      const out = await runHook("session-start", recorded("session-start", linkedRepo.root), {
        env: {},
        ensureDaemon: async () => {
          ensured++;
          return "spawned";
        },
      });
      expect(out).toEqual({ stdout: "", stderr: "", exitCode: 0 });
      expect(ensured).toBe(0);
      expect(existsSync(join(repo.commonDir, "squeal"))).toBe(false);

      const again = spawnCli(suite.cli, ["remove"], { cwd: linkedRepo.root, env: repo.env });
      expect((await again.exited).code).toBe(0);
      expect(again.stdout()).toMatch(/^Nothing to remove: no Squeal store for this repository\./);
    },
    SLOW.timeout,
  );

  it("deletes nothing and exits 1 while a daemon will not let go of its lock", async () => {
    const repo = storedRepo();
    const lock = acquireDaemonLock(lockFileFor(repo.commonDir, repo.id));
    try {
      const { io, out } = capture(repo.root);
      expect(await removeCommand([], io, { stopWaitMs: 300 })).toBe(1);
      expect(out.stderr).toContain(`the daemon for ${repo.root} did not stop; nothing was removed`);
      expect(existsSync(join(repo.storeDir, "store.sqlite"))).toBe(true);
      expect(existsSync(join(repo.storeDir, "repository-id"))).toBe(true);
      expect(existsSync(repo.tempDir)).toBe(true);
    } finally {
      lock?.release();
    }
  });

  it("keeps squeal.config.json and says so, and --config deletes it", async () => {
    const repo = storedRepo();
    const config = join(repo.root, "squeal.config.json");
    writeFileSync(config, "{}\n");

    const kept = await run(["remove"], repo.root);
    expect(kept.code).toBe(0);
    expect(existsSync(repo.storeDir)).toBe(false);
    expect(existsSync(repo.tempDir)).toBe(false);
    expect(existsSync(config)).toBe(true);
    expect(kept.stdout).toContain(
      `${config}: the next Claude Code session here starts Squeal again`,
    );

    const removed = await run(["remove", "--config"], repo.root);
    expect(removed.code).toBe(0);
    expect(removed.stdout).toContain(`Removed:\n  ${config}\n`);
    expect(existsSync(config)).toBe(false);

    const nothing = await run(["remove", "--config"], repo.root);
    expect(nothing.stdout).toMatch(/^Nothing to remove/);
    expect(nothing.stdout).not.toContain("squeal.config.json");
  });

  it("removes the temp directories it can and the store, lists the one it cannot, and exits 3", async () => {
    const repo = storedRepo();
    // A test the daemon ran left a read-only directory in its TMPDIR (review wave 10c, S2).
    const readOnly = join(repo.tempDir, "ro");
    mkdirSync(readOnly);
    writeFileSync(join(readOnly, "f"), "x");
    chmodSync(readOnly, 0o555);
    try {
      const result = await run(["remove"], repo.root);
      expect(result.code, result.stderr).toBe(3);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(`Removed:\n  ${repo.storeDir} (store,`);
      expect(result.stdout).not.toContain(`${repo.tempDir} (a daemon's temp directory)`);
      expect(result.stdout).toContain(
        `Still there:\n  ${repo.tempDir}: could not delete it (EACCES); delete it by hand\n`,
      );
      expect(existsSync(repo.storeDir)).toBe(false);
      expect(existsSync(join(readOnly, "f"))).toBe(true);
    } finally {
      chmodSync(readOnly, 0o755);
    }
  });

  it("leaves a temp directory under a /tmp/squeal-<uid> it does not own", async () => {
    const repo = storedRepo();
    const uid = 4242;
    vi.spyOn(process, "getuid").mockReturnValue(uid);
    const scratch = daemonScratch(repo.commonDir, repo.root, uid);
    expect(existsSync(scratch.userDir), `${scratch.userDir} exists already`).toBe(false);
    dirs.push(scratch.userDir);
    // Made by this test's real user, so not by uid 4242: the daemon would refuse it.
    mkdirSync(join(scratch.tempDir, "sub"), { recursive: true, mode: 0o700 });
    writeFileSync(join(scratch.tempDir, "sub", "f"), "x");

    const result = await run(["remove"], repo.root);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).not.toContain(scratch.tempDir);
    expect(existsSync(join(scratch.tempDir, "sub", "f"))).toBe(true);
    expect(existsSync(repo.storeDir)).toBe(false);
  });

  it("--config in a linked worktree says the main checkout keeps its config", async () => {
    const repo = storedRepo();
    writeFileSync(join(repo.root, "squeal.config.json"), "{}\n");
    git(repo.root, ["add", "squeal.config.json"]);
    git(repo.root, ["commit", "-q", "-m", "config"]);
    const linked = `${repo.root}-linked`;
    dirs.push(linked);
    git(repo.root, ["worktree", "add", "-q", linked, "-b", "linked"]);
    const linkedConfig = join(linked, "squeal.config.json");
    expect(existsSync(linkedConfig)).toBe(true);

    const result = await run(["remove", "--config"], linked);
    expect(result.code, result.stderr).toBe(0);
    expect(existsSync(linkedConfig)).toBe(false);
    expect(result.stdout).toContain(
      `  ${linkedConfig} (tracked by git: the deletion is a change to commit)\n`,
    );
    expect(result.stdout).toContain(
      `Still there:\n  ${join(repo.root, "squeal.config.json")}: the next Claude Code session ` +
        `there starts Squeal again.`,
    );
    expect(result.stdout).not.toContain(`${linkedConfig}: the next`);
  });

  it("names squeal@hearsay's uninstall when settings name no Squeal id", async () => {
    const repo = storedRepo();
    const result = await run(["remove"], repo.root);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "  The plugin: claude plugin uninstall squeal@hearsay --scope project (the scope it was installed with).\n",
    );
  });

  it("names the previous squeal@squeal and the entries settings still hold (001-164)", async () => {
    const repo = storedRepo();
    mkdirSync(join(repo.root, ".claude"));
    writeFileSync(
      join(repo.root, ".claude", "settings.json"),
      JSON.stringify({
        extraKnownMarketplaces: { squeal: {}, team: {} },
        enabledPlugins: { "squeal@squeal": true, "formatter@team": true },
      }),
    );
    const result = await run(["remove"], repo.root);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "  The plugin: claude plugin uninstall squeal@squeal --scope project (the scope it was " +
        "installed with), and the entries squeal init added to .claude/settings.json: " +
        'extraKnownMarketplaces.squeal, enabledPlugins["squeal@squeal"].\n',
    );
    expect(result.stdout).not.toContain("squeal@hearsay");
  });

  it("rejects other arguments", async () => {
    const result = await run(["remove", "--all"], "/");
    expect(result).toMatchObject({ code: 2, stderr: "usage: squeal remove [--config]\n" });
  });
});
