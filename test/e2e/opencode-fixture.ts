import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { storePaths } from "../../src/core/store/index.js";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import {
  PLANNED_MODEL,
  type ScriptedRequest,
  type ScriptedStep,
} from "../fixtures/opencode/scripted-provider.js";
import { type BundleRun, runNode } from "../harness/bundle-helpers.js";
import { runMissingConfig } from "../helpers/baseline.js";
import { type OpenCodeLive, type OpenCodeRun, runOpenCode } from "../helpers/opencode.js";
import { piBase } from "../helpers/pi.js";
import { copyPlugin } from "./plugins.js";
import { MATH, SLOW, SOURCE_PATH, type Source, STRINGS } from "./sources.js";
import { daemonPids, registeredSessions, until } from "./support.js";

/*
 * Spec 008 Testing, end to end: `plugins/opencode` as it ships (its tracked
 * files, `copyPlugin`), unpacked as `install.sh` lays it out (D1), a versioned
 * directory and a `current` link to it, and installed with the real
 * `opencode plugin file:<...>/current -g` into each run's isolated config
 * (`runOpenCode`'s `install`), so OpenCode loads it from its global config; a
 * fixture repository with its own Vitest; and the daemon the bridge spawns
 * from the copy's CLI. No `SQUEAL_CLI` anywhere: OpenCode gets a private
 * `XDG_RUNTIME_DIR` only. The worktree's tracked bundles are what runs, so
 * build before trusting a local result.
 */

const FIXTURE = join(REPO_ROOT, "test/fixtures/e2e");
const DAEMON_WAIT_MS = 45_000;
const SETTLE_WAIT_MS = 60_000;

/**
 * The gates' marks, relative to the project: OpenCode rejects a `bash` command naming a path
 * outside it (`external_directory`), and under `.git` they are no change of the worktree.
 */
const GATES = ".git/e2e-gates";

const git = (cwd: string, args: readonly string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });

export interface OpenCodeE2EOptions {
  /** Without it, the repository has no `squeal.config.json`: Squeal is not set up. */
  readonly squeal?: boolean;
  /** With it, `test/slow.test.ts` takes `SLOW_MS` per run. */
  readonly slow?: boolean;
  /**
   * With it, the copy's daemon is started (`squeal start`) and the baseline passes before
   * OpenCode starts, as `squeal setup`'s warm-up leaves a repository; without it the store does
   * not exist at OpenCode's first message, and the bridge spawns the daemon.
   */
  readonly started?: boolean;
  /**
   * The repository's `stop.waitMs`; the default is 0, which leaves Stop at idle 500 ms (D4), a
   * deadline a loaded host can miss (review 008-27 S1). Stop waits only for pending checks, so a
   * test that settles before the turn ends sets it to keep the deadline out of what it tests.
   */
  readonly stopWaitMs?: number;
}

export interface OpenCodeE2ERunOptions {
  readonly mode: "run" | "serve";
  readonly plan: ScriptedStep[];
  readonly prompt?: string;
  readonly afterReply?: (live: OpenCodeLive) => Promise<void>;
  readonly timeoutMs?: number;
}

/** What a test acts on while OpenCode runs. */
export interface OpenCodeWorld {
  /** Requests to the planned model so far, live. */
  planned(): ScriptedRequest[];
  /** True once OpenCode has exited. */
  done(): boolean;
}

/** One fixture: the unpacked package, its install, a repository, and the one OpenCode run in it. */
export class OpenCodeE2E {
  /** The versioned package directory the plugin loads from: `current`'s target. */
  readonly plugin: string;
  /** The stable path installed into OpenCode's config, as `install.sh` installs it. */
  readonly current: string;
  /** The provider's release files (`releasePath`); the gates' marks live in the project (`GATES`). */
  readonly releases: string;
  #project: string | undefined;
  #run: OpenCodeRun | undefined;
  #edits = 0;

  private constructor(
    readonly base: string,
    readonly runtime: string,
    readonly options: OpenCodeE2EOptions,
    readonly install: string,
  ) {
    const version = (
      JSON.parse(readFileSync(join(REPO_ROOT, "plugins/opencode/package.json"), "utf8")) as {
        version: string;
      }
    ).version;
    this.plugin = join(base, "squeal/opencode", version);
    this.current = join(base, "squeal/opencode/current");
    this.releases = join(base, "releases");
  }

  static create(install: string, options: OpenCodeE2EOptions = {}): OpenCodeE2E {
    const base = realpathSync(mkdtempSync(join(piBase(), "squeal-e2e-oc-")));
    // Short: the daemon's socket path lives under it.
    const e2e = new OpenCodeE2E(base, realpathSync(mkdtempSync("/tmp/sq-")), options, install);
    copyPlugin("opencode", e2e.plugin);
    symlinkSync(e2e.plugin, e2e.current);
    mkdirSync(e2e.releases);
    return e2e;
  }

  get project(): string {
    if (this.#project === undefined) throw new Error("the run has not set up its project");
    return this.#project;
  }

  /** The project OpenCode made, filled as the fixture repository and committed. */
  async #build(repo: string): Promise<void> {
    this.#project = realpathSync(repo);
    cpSync(join(FIXTURE, "project"), repo, { recursive: true });
    execFileSync("mv", [join(repo, "_gitignore"), join(repo, ".gitignore")]);
    if (this.options.slow === true) {
      cpSync(join(FIXTURE, "slow"), repo, { recursive: true });
      this.#write(SOURCE_PATH.slow, SLOW());
    }
    this.#write(SOURCE_PATH.math, MATH());
    this.#write(SOURCE_PATH.strings, STRINGS());
    for (const file of ["package.json", "package-lock.json"]) {
      cpSync(join(this.install, file), join(repo, file));
    }
    execFileSync("cp", ["-a", join(this.install, "node_modules"), join(repo, "node_modules")]);
    if (this.options.squeal !== false) {
      const { stopWaitMs } = this.options;
      const config = stopWaitMs === undefined ? {} : { stop: { waitMs: stopWaitMs } };
      // The scenarios wait for the start to run every file (row 011-159: not the shipped default).
      writeFileSync(join(repo, "squeal.config.json"), runMissingConfig(JSON.stringify(config)));
    }
    git(repo, ["add", "-A"]);
    git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture"]);
    mkdirSync(join(repo, GATES));
    if (this.options.started === true) {
      await this.cli(["start"]);
      await this.baseline();
    }
  }

  /** A planned `write` of `file` with a fresh counter comment, as the agent's edit. */
  writeCall(file: Source, body: string) {
    return {
      name: "write",
      arguments: { filePath: SOURCE_PATH[file], content: `// edit ${this.#edits++}\n${body}` },
    };
  }

  /** Writes `file` from outside OpenCode: a change no tool call made. */
  edit(file: Source, body: string): void {
    this.#write(SOURCE_PATH[file], body);
  }

  #write(path: string, body: string): void {
    const at = join(this.#project ?? "", path);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, `// edit ${this.#edits++}\n${body}`);
  }

  /** A `bash` call that waits at gate `n` until the test opens it (`atGate`). */
  gateCall(n: number) {
    const go = `${GATES}/go.${n}`;
    const open = `${GATES}/open.${n}`;
    return {
      name: "bash",
      arguments: {
        command: `touch '${go}'; while [ ! -f '${open}' ]; do sleep 0.05; done; echo gate ${n}`,
        description: `gate ${n}`,
      },
    };
  }

  /** Runs `then` once gate `n`'s `bash` reached it, then opens it; false when OpenCode ended first. */
  async atGate(world: OpenCodeWorld, n: number, then: () => Promise<unknown>): Promise<boolean> {
    const gates = () => join(this.#project ?? "", GATES);
    while (this.#project === undefined || !existsSync(join(gates(), `go.${n}`))) {
      if (world.done()) return false;
      await sleep(20);
    }
    try {
      await then();
    } finally {
      writeFileSync(join(gates(), `open.${n}`), "");
    }
    return true;
  }

  /** The release file of a planned step: `release(n)` lets its response go. */
  releasePath(n: number): string {
    return join(this.releases, `release.${n}`);
  }

  release(n: number): void {
    writeFileSync(this.releasePath(n), "");
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

  /** Until the daemon spawned from this copy answers status and the baseline passes. */
  async baseline(): Promise<number[]> {
    const pids = await until("the copy's daemon", DAEMON_WAIT_MS, async () => {
      const pids = daemonPids(this.plugin);
      return pids.length > 0 && (await this.status()).daemon.state === "alive" ? pids : null;
    });
    await this.settled("pass");
    return pids;
  }

  get store(): ReturnType<typeof storePaths> {
    return storePaths(join(this.project, ".git"));
  }

  /** Session ids registered in the store. */
  sessions(): string[] {
    return registeredSessions(this.store.database);
  }

  /** The run's global OpenCode config directory, where `opencode plugin -g` writes. */
  get globalConfig(): string {
    if (this.#run === undefined) throw new Error("no run");
    return join(this.#run.dir, "xdg/config/opencode");
  }

  /**
   * One OpenCode run in a fresh fixture repository with the package installed, and `beside`
   * alongside until it exits. The run stays until `cleanup`: the daemon it spawned lives in its
   * `HOME` and `TMPDIR`.
   */
  async run(
    options: OpenCodeE2ERunOptions,
    beside: (world: OpenCodeWorld) => Promise<void> = async () => {},
  ): Promise<OpenCodeRun> {
    if (this.#run !== undefined) throw new Error("one run per fixture");
    let requests: ScriptedRequest[] = [];
    let finished = false;
    const world: OpenCodeWorld = {
      planned: () => requests.filter((request) => request.model === PLANNED_MODEL),
      done: () => finished,
    };
    const run = runOpenCode({
      mode: options.mode,
      plan: options.plan,
      prompt: options.prompt ?? "work",
      install: [this.current],
      env: { XDG_RUNTIME_DIR: this.runtime },
      setup: (cwd) => this.#build(cwd),
      onRequests: (live) => {
        requests = live;
      },
      timeoutMs: options.timeoutMs ?? 120_000,
      ...(options.afterReply === undefined ? {} : { afterReply: options.afterReply }),
    }).finally(() => {
      finished = true;
    });
    // OpenCode's run is recorded for cleanup even when `beside` fails first.
    const [result, alongside] = await Promise.allSettled([run, beside(world)]);
    if (result.status === "fulfilled") this.#run = result.value;
    if (alongside.status === "rejected") throw alongside.reason;
    if (result.status === "rejected") throw result.reason;
    return result.value;
  }

  /**
   * `opencode run --continue` after the fixture's `run`, in its directory and project: it resumes
   * the session that run left, with a fresh provider playing `plan`.
   */
  continue(options: Omit<OpenCodeE2ERunOptions, "mode" | "afterReply">): Promise<OpenCodeRun> {
    if (this.#run === undefined) throw new Error("no run to continue");
    return runOpenCode({
      mode: "run",
      plan: options.plan,
      prompt: options.prompt ?? "work",
      env: { XDG_RUNTIME_DIR: this.runtime },
      continue: this.#run,
      timeoutMs: options.timeoutMs ?? 120_000,
    });
  }

  /** Stops the copy's daemon, then removes the run, the package and the runtime dir. */
  async cleanup(): Promise<void> {
    if (this.#project !== undefined) await this.cli(["stop"]).catch(() => null);
    await until("the copy's daemon to exit", 10_000, async () =>
      daemonPids(this.plugin).length === 0 ? true : null,
    ).catch(() => {
      for (const pid of daemonPids(this.plugin)) process.kill(pid, "SIGKILL");
    });
    this.#run?.cleanup();
    rmSync(this.base, { recursive: true, force: true });
    rmSync(this.runtime, { recursive: true, force: true });
  }
}
