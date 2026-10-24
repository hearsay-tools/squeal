import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { storePaths } from "../../src/core/store/index.js";
import { type Consumer, MAIN_AGENT, type StatusSnapshot } from "../../src/core/types/index.js";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import { type BundleRun, runNode } from "../harness/bundle-helpers.js";
import { atGate, gateCall, type PiWorld } from "../harness/pi/real-pi.js";
import { runMissingConfig } from "../helpers/baseline.js";
import { type PiRun, type PiRunOptions, piBase, runPi } from "../helpers/pi.js";
import { copyPlugin } from "./plugins.js";
import { MATH, SLOW, SOURCE_PATH, type Source, STRINGS } from "./sources.js";
import { daemonPids, registeredSessions, until } from "./support.js";

/*
 * Spec 009 Testing, end to end: `plugins/pi` as it ships (its tracked files,
 * `copyPlugin`), installed with the real `pi install` into each run's
 * isolated agent dir (`runPi`'s `install`), so Pi loads it from its settings;
 * a fixture repository with its own Vitest; and the daemon the extension
 * spawns from the copy's CLI. No `SQUEAL_CLI` anywhere: Pi gets a private
 * `XDG_RUNTIME_DIR` and the gate directory only. The worktree's tracked
 * bundles are what runs, so build before trusting a local result.
 */

const FIXTURE = join(REPO_ROOT, "test/fixtures/e2e");
const DAEMON_WAIT_MS = 45_000;
const SETTLE_WAIT_MS = 60_000;

const git = (cwd: string, args: readonly string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });

export interface PiE2EOptions {
  readonly squeal?: boolean;
  readonly slow?: boolean;
}

export type PiE2ERunOptions = Omit<PiRunOptions, "install" | "env" | "cwd" | "extensions">;

/** One fixture: the package copy, a repository, and every Pi run made in it. */
export class PiE2E {
  readonly plugin: string;
  readonly project: string;
  readonly #runs: PiRun[] = [];
  #edits = 0;

  private constructor(
    readonly base: string,
    readonly runtime: string,
  ) {
    this.plugin = join(base, "plugin");
    this.project = join(base, "repo");
  }

  /**
   * With `squeal: false` the repository has no `squeal.config.json`: Squeal is not set up. With
   * `slow`, it has the slow fixture: `test/slow.test.ts` takes `SLOW_MS` per run.
   */
  static create(install: string, options: PiE2EOptions = {}): PiE2E {
    const base = realpathSync(mkdtempSync(join(piBase(), "squeal-e2e-pi-")));
    const e2e = new PiE2E(base, realpathSync(mkdtempSync("/tmp/sq-")));
    try {
      e2e.#build(install, options);
    } catch (error) {
      rmSync(base, { recursive: true, force: true });
      rmSync(e2e.runtime, { recursive: true, force: true });
      throw error;
    }
    return e2e;
  }

  #build(install: string, options: PiE2EOptions): void {
    copyPlugin("pi", this.plugin);
    const repo = this.project;
    cpSync(join(FIXTURE, "project"), repo, { recursive: true });
    execFileSync("mv", [join(repo, "_gitignore"), join(repo, ".gitignore")]);
    if (options.slow === true) {
      cpSync(join(FIXTURE, "slow"), repo, { recursive: true });
      this.#write(SOURCE_PATH.slow, SLOW());
    }
    this.#write(SOURCE_PATH.math, MATH());
    this.#write(SOURCE_PATH.strings, STRINGS());
    for (const file of ["package.json", "package-lock.json"]) {
      cpSync(join(install, file), join(repo, file));
    }
    execFileSync("cp", ["-a", join(install, "node_modules"), join(repo, "node_modules")]);
    // The scenarios wait for the start to run every file (row 011-159: not the shipped default).
    if (options.squeal !== false)
      writeFileSync(join(repo, "squeal.config.json"), runMissingConfig());
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["add", "-A"]);
    git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture"]);
  }

  /**
   * A planned `write` of `file` with a fresh counter comment: `MATH("-")` fails `math > adds`,
   * `SLOW(3)` fails `doubles slowly` after `SLOW_MS`.
   */
  writeCall(file: Source, body: string) {
    return {
      name: "write",
      arguments: { path: SOURCE_PATH[file], content: `// edit ${this.#edits++}\n${body}` },
    };
  }

  /** Writes `file` as `writeCall` would, from outside Pi: a change no tool call made. */
  edit(file: Source, body: string): void {
    this.#write(SOURCE_PATH[file], body);
  }

  #write(path: string, body: string): void {
    const at = join(this.project, path);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, `// edit ${this.#edits++}\n${body}`);
  }

  get cliPath(): string {
    return join(this.plugin, "dist/cli/squeal.mjs");
  }

  /** The copy's CLI in the repository, with the fixture's runtime dir and `env`. */
  cli(args: readonly string[], env: Record<string, string> = {}): Promise<BundleRun> {
    return runNode(
      ["--disable-warning=ExperimentalWarning", this.cliPath, ...args],
      "",
      { XDG_RUNTIME_DIR: this.runtime, ...env },
      this.project,
    );
  }

  /** `squeal status --json`; throws when status is unavailable. */
  async status(): Promise<StatusSnapshot> {
    const run = await this.cli(["status", "--json"]);
    const status = JSON.parse(run.stdout) as StatusSnapshot | { available: false; message: string };
    if (!status.available) throw new Error(`status unavailable: ${status.message}`);
    return status;
  }

  /** Until a daemon validates and `math > adds` passes (`pass`) or fails (`fail`) at the latest revision. */
  settled(state: "pass" | "fail"): Promise<StatusSnapshot> {
    return until(`a ${state}ing math > adds`, SETTLE_WAIT_MS, async () => {
      const s = await this.status();
      if (s.daemon.state !== "alive" || s.counts.pending > 0 || s.counts.current === 0) return null;
      if (state === "pass") return s.knownFailures.length === 0 ? s : null;
      return s.knownFailures.some((f) => f.validity === "current") ? s : null;
    });
  }

  /** Until the daemon spawned from this copy answers status. */
  daemon(): Promise<number[]> {
    return until("the copy's daemon", DAEMON_WAIT_MS, async () => {
      const pids = daemonPids(this.plugin);
      return pids.length > 0 && (await this.status()).daemon.state === "alive" ? pids : null;
    });
  }

  /** The Pi session's consumer in this repository, by session id. */
  consumer(sessionId: string): Consumer {
    return { worktreeId: worktreeIdFor(this.project), sessionId, agentId: MAIN_AGENT };
  }

  get store(): ReturnType<typeof storePaths> {
    return storePaths(join(this.project, ".git"));
  }

  /** Session ids registered in the store. */
  sessions(): string[] {
    return registeredSessions(this.store.database);
  }

  /**
   * Runs Pi in the repository with the package installed, a fresh gate directory, and `beside`
   * alongside until Pi exits. The run stays until `cleanup`: the daemon it spawned lives in its
   * `HOME` and `TMPDIR`.
   */
  async run(
    options: PiE2ERunOptions,
    beside: (world: PiWorld, done: () => boolean) => Promise<void> = async () => {},
  ): Promise<PiRun> {
    const marks = mkdtempSync(join(this.base, "marks-"));
    const env = { XDG_RUNTIME_DIR: this.runtime, SQUEAL_TEST_MARKS: marks };
    const world: PiWorld = { env, marks, spawnedDaemon: () => daemonPids(this.plugin).length > 0 };
    let finished = false;
    const run = runPi({ ...options, cwd: this.project, env, install: [this.plugin] }).finally(
      () => {
        finished = true;
      },
    );
    const [result] = await Promise.all([run, beside(world, () => finished)]);
    this.#runs.push(result);
    return result;
  }

  /** A `-p` run whose one gate waits for the daemon and a passing baseline. */
  async baseline(): Promise<{ run: PiRun; pids: number[] }> {
    let pids: number[] = [];
    const run = await this.run(
      { mode: "print", prompts: ["start"], plan: [{ tools: [gateCall(0)] }, { text: "ready" }] },
      async (world, done) => {
        await atGate(world, 0, done, async () => {
          pids = await this.daemon();
          await this.settled("pass");
        });
      },
    );
    return { run, pids };
  }

  /** Stops the copy's daemon, then removes the runs, the repository and the runtime dir. */
  async cleanup(): Promise<void> {
    await this.cli(["stop"]).catch(() => null);
    await until("the copy's daemon to exit", 10_000, async () =>
      daemonPids(this.plugin).length === 0 ? true : null,
    ).catch(() => {
      for (const pid of daemonPids(this.plugin)) process.kill(pid, "SIGKILL");
    });
    for (const run of this.#runs.splice(0)) run.cleanup();
    rmSync(this.base, { recursive: true, force: true });
    rmSync(this.runtime, { recursive: true, force: true });
  }
}

/** Every file under `dir`, relative to it. */
export function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)));
}

/** The package sources Pi's user settings in `agentDir` declare, a local path resolved as Pi records it: from `agentDir`. */
export function installedPackages(agentDir: string): string[] {
  const settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")) as {
    packages?: (string | { source: string })[];
  };
  return (settings.packages ?? []).map((entry) =>
    resolve(agentDir, typeof entry === "string" ? entry : entry.source),
  );
}
