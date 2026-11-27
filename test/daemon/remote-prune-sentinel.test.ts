import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { readMachines, recordMachine } from "../../src/core/runner-host/remote/machines-store.js";
import { remoteSettingsPath } from "../../src/core/runner-host/remote/settings.js";
import type { AbsolutePath, WorktreeId } from "../../src/core/types/common.js";
import { testProcessEnv } from "../harness/bundle-helpers.js";
import {
  daemonSuite,
  delay,
  type FixtureRepo,
  SLOW,
  spawnCli,
  stopProcess,
  waitFor,
  waitReady,
} from "./helpers.js";

/*
 * Review 0.1.658 B5: the shipped `squeal daemon` prunes, at each start, the
 * remote machines of removed worktrees in the user's registry, running each
 * one's release hook. A test's CLI daemon must never reach the real user's.
 * Here a stand-in user HOME holds a `command` lane whose release hook writes
 * a marker, and a record of a removed worktree. A daemon started with each
 * helper's environment, HOME that user's, runs no hook and changes no
 * record. The control, the same daemon pointed at that user's config and
 * state, runs the hook: the sentinel can see a leak.
 */

const suite = daemonSuite();

/** A stand-in for the real user: remote files under HOME, the defaults when no XDG path is set. */
function standInUser() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "squeal-sentinel-home-")));
  onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  const own = { HOME: home };
  const marker = join(home, "release-hook-ran");
  const hook = join(home, "release-hook.mjs");
  writeFileSync(
    hook,
    `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, process.env.SQUEAL_RELEASE_REASON ?? "");\n`,
  );
  mkdirSync(join(home, ".config", "squeal"), { recursive: true });
  writeFileSync(
    remoteSettingsPath(own),
    JSON.stringify({
      repositories: {
        "/elsewhere": {
          provider: "command",
          providerConfig: { acquire: ["unused"], release: [process.execPath, hook] },
        },
      },
    }),
  );
  recordMachine(
    {
      provider: "command",
      id: "cmd:users-own",
      worktreeId: "users-worktree" as WorktreeId,
      worktreeRoot: join(home, "removed-worktree") as AbsolutePath,
      repositoryKey: "/elsewhere",
      destination: "dev@host",
      sshArgs: [],
      places: { node: "node", cache: "c" },
      capabilities: { hasGitRepository: false, sleepOnIdle: true, ephemeralHostKey: false },
      status: "detached",
      createdAt: 1,
      lastUsedAt: 2,
    },
    own,
  );
  return {
    home,
    marker,
    /** The registry as the user's own Squeal reads it. */
    machines: () => readMachines(own).machines.map((m) => m.id),
    xdg: { XDG_CONFIG_HOME: join(home, ".config"), XDG_STATE_HOME: join(home, ".local", "state") },
  };
}

/** Starts `squeal daemon` for `repo` with `env`, waits until it is ready and its start's prune had time, stops it. */
async function startStop(repo: FixtureRepo, env: NodeJS.ProcessEnv, settle: () => Promise<void>) {
  const spawned = spawnCli(suite.cli, ["daemon", repo.root], { cwd: repo.root, env });
  try {
    await waitReady(repo, spawned);
    await settle();
  } finally {
    await stopProcess(spawned);
  }
}

describe(
  "a test's CLI daemon never prunes the user's remote machines (review 0.1.658 B5)",
  SLOW,
  () => {
    it("with runNode's environment (bundle and e2e hooks)", async () => {
      const user = standInUser();
      const repo = suite.fixture();
      const env = testProcessEnv({ HOME: user.home, XDG_RUNTIME_DIR: repo.runtimeDir });
      await startStop(repo, env, () => delay(2_000));
      expect(existsSync(user.marker)).toBe(false);
      expect(user.machines()).toEqual(["cmd:users-own"]);
    });

    it("with the daemon helpers' environment (childEnv)", async () => {
      const user = standInUser();
      const repo = suite.fixture();
      // The helpers' config dir is the test's own. A test that names a lane there for the
      // user's key would let a leaked registry reach the hook, so this one does.
      const config = remoteSettingsPath(repo.env);
      mkdirSync(join(config, ".."), { recursive: true });
      writeFileSync(config, readFileSync(remoteSettingsPath({ HOME: user.home }), "utf8"));
      await startStop(repo, { ...repo.env, HOME: user.home }, () => delay(2_000));
      expect(existsSync(user.marker)).toBe(false);
      expect(user.machines()).toEqual(["cmd:users-own"]);
    });

    it("control: pointed at the user's config and state, the same daemon runs the hook", async () => {
      const user = standInUser();
      const repo = suite.fixture();
      const env = testProcessEnv({
        HOME: user.home,
        XDG_RUNTIME_DIR: repo.runtimeDir,
        ...user.xdg,
      });
      await startStop(repo, env, () =>
        waitFor(() => existsSync(user.marker), 30_000, "the user's release hook ran").then(
          () => {},
        ),
      );
      expect(user.machines()).toEqual([]);
    });
  },
);
