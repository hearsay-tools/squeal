import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { remoteSettingsPath } from "../../src/core/runner-host/remote/settings.js";
import {
  type DaemonSuite,
  type FixtureRepo,
  runnerHosts,
  spawnCli,
  waitReady,
} from "../daemon/helpers.js";
import { git } from "../hash/git-repo.js";
import { fakeSshAt } from "../runner-host/remote/providers/agent37-api-mock.js";

/*
 * Spec 026 row 026-16, Track 2: what the remote end-to-end tests share. A
 * "remote" login is a directory of this machine reached by a fake `ssh`
 * first on the daemon's PATH (`fakeSshAt`): it records each call and runs
 * the command there with that directory as HOME and its own private
 * XDG_RUNTIME_DIR (keeping the fake machine's capacity pool separate from
 * the local daemon's). The directory sits under
 * the scheduler fixtures' scratch, inside this repository, so a remote
 * tree resolves Vitest from its `node_modules` as a remote with an
 * install would. The user's `remote.json`, `remote-machines.json` and
 * HOME all live in the fixture's runtime directory: nothing reads the real
 * HOME, the real `~/.ssh` or the network.
 */

const scratch = resolve(import.meta.dirname, "../fixtures/scheduler/.tmp");

/** The variables a CLI or daemon must not inherit from the harness running the tests. */
const HARNESS = [
  "CODEX_SESSION_ID",
  "PI_SESSION_ID",
  "OPENCODE_SESSION_ID",
  "ANTIGRAVITY_CONVERSATION_ID",
  "CLAUDECODE",
] as const;

export interface RemoteWorld {
  readonly repo: FixtureRepo;
  /** The remote login's HOME. */
  readonly home: string;
  /** The `ssh` argument lists the daemon and CLI ran, oldest first. */
  readonly ssh: () => string[][];
  /** Writes the user's `remote.json` with `entry` for this repository; `null` names none. */
  remote(entry: Record<string, unknown> | null): void;
}

/**
 * `repo` with a fake remote: `ssh` first on PATH, HOME, XDG config and
 * state dirs of its own, and the harness identities removed.
 */
export function withRemote(suite: DaemonSuite, repo: FixtureRepo): RemoteWorld {
  const dir = join(scratch, `${randomUUID()}-remote`);
  suite.cleanup(() => rmSync(dir, { recursive: true, force: true }));
  const fake = fakeSshAt(dir);
  const home = join(repo.runtimeDir, "home");
  mkdirSync(home, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...repo.env,
    HOME: home,
    XDG_STATE_HOME: join(home, "state"),
    PATH: `${fake.bin}:${repo.env.PATH ?? ""}`,
  };
  for (const name of HARNESS) delete env[name];
  Object.assign(repo, { env });
  return {
    repo,
    home: fake.home,
    ssh: fake.argv,
    remote: (entry) => {
      const path = remoteSettingsPath(env);
      mkdirSync(join(path, ".."), { recursive: true });
      const repositories = entry === null ? {} : { [repo.root]: entry };
      writeFileSync(path, JSON.stringify({ repositories }));
    },
  };
}

export interface Hooks {
  /** `providerConfig` naming the four hooks. */
  readonly config: Record<string, unknown>;
  /** Each hook call, oldest first: its name and, for `release`, its reason. */
  calls(): string[];
}

/**
 * The `command` provider's four hooks as Node scripts: `acquire` prints
 * `answer`; each logs its call with `SQUEAL_RELEASE_REASON` when set.
 */
export function commandHooks(dir: string, answer: Record<string, unknown>): Hooks {
  mkdirSync(dir, { recursive: true });
  const log = join(dir, "hooks.log");
  const hook = (name: string, out = "") => {
    const path = join(dir, `${name}.mjs`);
    writeFileSync(
      path,
      [
        'import { appendFileSync } from "node:fs";',
        `appendFileSync(${JSON.stringify(log)}, ${JSON.stringify(name)} + (process.env.SQUEAL_RELEASE_REASON ? " " + process.env.SQUEAL_RELEASE_REASON : "") + "\\n");`,
        out,
        "",
      ].join("\n"),
    );
    return [process.execPath, path];
  };
  appendFileSync(log, "");
  return {
    config: {
      acquire: hook("acquire", `console.log(${JSON.stringify(JSON.stringify(answer))});`),
      wake: hook("wake"),
      sleep: hook("sleep"),
      release: hook("release"),
    },
    calls: () => readFileSync(log, "utf8").split("\n").filter(Boolean),
  };
}

/** `squeal <args>` in `repo` as its own process: exit code, combined output, and stdout alone. */
export async function cliIn(suite: DaemonSuite, repo: FixtureRepo, ...args: string[]) {
  const run = spawnCli(suite.cli, args, { cwd: repo.root, env: repo.env });
  const { code } = await run.exited;
  return { code, out: `${run.stdout()}${run.stderr()}`, stdout: run.stdout() };
}

/**
 * Samples the local runner hosts of `root` every 200 ms until stopped: the
 * most seen at once. A remote host runs in the remote login's tree, never
 * as ` runner-host <root> `, so it does not count.
 */
export function sampleLocalHosts(root: string): { stop(): number } {
  let most = runnerHosts(root).length;
  const timer = setInterval(() => {
    most = Math.max(most, runnerHosts(root).length);
  }, 200);
  return {
    stop: () => {
      clearInterval(timer);
      return Math.max(most, runnerHosts(root).length);
    },
  };
}

/**
 * A remote `node` at `<dir>/node`: this process's Node with `preload`
 * (CommonJS source) required first, as a remote with another machine or
 * another disk would answer.
 */
export function nodeWith(dir: string, preload: string): string {
  mkdirSync(dir, { recursive: true });
  const script = join(dir, "preload.cjs");
  writeFileSync(script, preload);
  const node = join(dir, "node");
  writeFileSync(
    node,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} --require ${JSON.stringify(script)} "$@"\n`,
  );
  chmodSync(node, 0o755);
  return node;
}

/** Makes each 4 KiB write of the connect-time disk probe take 25 ms: a degraded disk (D11). */
export const SLOW_DISK = `if ((process.argv[1] || "").endsWith("/squeal")) {
  const fs = require("fs");
  const write = fs.writeSync;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  fs.writeSync = function (...args) {
    const written = write.apply(this, args);
    Atomics.wait(pause, 0, 0, 25);
    return written;
  };
}
`;

/**
 * Reports `riscv64` as the arch to Squeal's own code (the bundle and its
 * `-e` probes), and the real one to everything under `node_modules`, whose
 * native bindings must still load: a remote of another machine (D10).
 */
export const OTHER_ARCH = `const real = process.arch;
Object.defineProperty(process, "arch", {
  configurable: true,
  get() {
    const caller = (new Error().stack || "").split("\\n")[2] || "";
    return caller.includes("node_modules") ? real : "riscv64";
  },
});
`;

const NODE_TEST = {
  "nt/sum.test.mjs":
    'import assert from "node:assert/strict";\nimport { test } from "node:test";\n\ntest("sums", () => assert.equal(1 + 1, 2));\n',
  "slow/wait.test.mjs":
    'import assert from "node:assert/strict";\nimport { test } from "node:test";\n\ntest("waits", async () => {\n  await new Promise((r) => setTimeout(r, 300));\n  assert.ok(true);\n});\n',
};

/** A Python with pytest on this machine, or `null`: the pytest case is skipped without one. */
export function pytestPython(): string | null {
  for (const python of [process.env.SQUEAL_E2E_PYTHON, "python3"]) {
    if (python === undefined || python === "") continue;
    const probe = spawnSync(python, ["-c", "import pytest, sys; print(sys.executable)"], {
      encoding: "utf8",
    });
    if (probe.status === 0) return probe.stdout.trim();
  }
  return null;
}

/** A fixture: Vitest, two node:test projects (one slow), a manual group, and a remote world. */
export function remoteFixture(
  suite: DaemonSuite,
  extra: Record<string, unknown> = {},
  files: Record<string, string> = {},
): RemoteWorld {
  const repo = suite.fixture({
    "squeal.config.json": `${JSON.stringify({
      baseline: { onStart: "lookup-then-run-missing" },
      checks: [{ name: "later", runner: "vitest", tests: ["test/plain.test.ts"], at: "manual" }],
      nodeTest: [
        { name: "nt", include: ["nt/*.test.mjs"] },
        { name: "slow", include: ["slow/*.test.mjs"] },
      ],
      // High maxLoadPerCpu (as in slow-shape.ts): on a busy CI shard or shared host,
      // the load guard would otherwise defer slow/wait.test.mjs past every wait.
      slow: { include: ["slow/*.test.mjs"], maxLoadPerCpu: 1_000 },
      complexity: { enabled: true },
      coverage: { enabled: true },
      ...extra,
    })}\n`,
    ...NODE_TEST,
    ...files,
  });
  // The fixture's `test/gen.test.ts` reads a gitignored file, which never reaches a remote tree.
  git(repo.root, ["rm", "-q", "test/gen.test.ts"]);
  git(repo.root, ["commit", "-qm", "no ignored input"]);
  return withRemote(suite, repo);
}

/** A `command` machine answering with `node` and `.squeal-remote`. */
export function commandLane(
  world: RemoteWorld,
  node = process.execPath,
  entry: Record<string, unknown> = {},
): Hooks {
  const hooks = commandHooks(join(world.repo.runtimeDir, "hooks"), {
    v: 1,
    id: "lan-1",
    destination: "dev@lan-box",
    node,
    cache: ".squeal-remote",
    sleepOnIdle: true,
  });
  world.remote({
    provider: "command",
    providerConfig: hooks.config,
    lanes: "all",
    runners: "all",
    whenLost: "not-run",
    ...entry,
  });
  return hooks;
}

/** The daemon of `repo`, ready. */
export async function served(suite: DaemonSuite, repo: FixtureRepo) {
  const spawned = suite.daemon(repo);
  await waitReady(repo, spawned, 120_000);
  return spawned;
}
