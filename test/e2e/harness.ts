import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, type TestContext } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { socketPathFor } from "../../src/core/daemon/paths.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import type { PingResponse, StatusSnapshot } from "../../src/core/types/index.js";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import { type BundleRun, runNode } from "../harness/bundle-helpers.js";
import { recorded } from "../harness/helpers.js";
import { type Install, vitestInstall } from "./install.js";
import { MATH, SLOW, type Source, STRINGS } from "./sources.js";
import { daemonPids, metric, type RunRow, readRuns, until } from "./support.js";

export { MATH, SLOW, SLOW_MS, STRINGS } from "./sources.js";
export { hasNodeModulesAbove, until } from "./support.js";

/*
 * Spec 001 Testing, end to end, and review wave 3 "Inputs for wave 4": the
 * plugin as a marketplace install copies it (`git archive HEAD
 * plugins/claude-code` under /tmp, no `node_modules` above it), a fixture
 * repository with its own Vitest, hook bundles driven by recorded hook JSON,
 * daemons spawned by those bundles from the shipped CLI, and no `SQUEAL_CLI`
 * anywhere: the hooks get PATH, HOME and a private XDG_RUNTIME_DIR only.
 * Committed bundles are what runs, so build and commit before trusting a
 * local result.
 */

const FIXTURE = join(REPO_ROOT, "test/fixtures/e2e");
/** Spec 001 D9: every hook has `timeout: 2`. */
export const HOOK_BUDGET_MS = 2_000;
const DAEMON_WAIT_MS = 45_000;
const SETTLE_WAIT_MS = 90_000;

/** The recorded hook JSON's session is the default consumer; this is a second one. */
export const OTHER_SESSION = "0d7c5b1e-3f0a-4b8e-9a51-2c6e8f4d7a90";

export type HookName =
  | "session-start"
  | "post-tool-batch"
  | "pre-tool-use"
  | "stop"
  | "session-end";

export interface Hooked extends BundleRun {
  /** additionalContext, permissionDecisionReason or a block reason; `null` when the hook printed nothing. */
  readonly text: string | null;
  readonly json: HookJson | null;
}

interface HookJson {
  readonly decision?: string;
  readonly reason?: string;
  readonly hookSpecificOutput?: {
    readonly additionalContext?: string;
    readonly permissionDecision?: string;
    readonly permissionDecisionReason?: string;
  };
}

export interface FixtureOptions {
  /** Written as `squeal.config.json`: an object as JSON, a string verbatim. Default `{}`. */
  readonly policy?: object | string;
  /** Adds `test/slow.test.ts`, which takes `SLOW_MS` per run. */
  readonly slow?: boolean;
}

const git = (cwd: string, args: readonly string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });

/** One fixture: a plugin copy, a repository, its worktrees and their daemons. */
export class E2E {
  readonly plugin: string;
  readonly main: string;
  readonly #env: Readonly<Record<string, string>>;
  #edits = 0;

  private constructor(
    readonly base: string,
    readonly runtime: string,
    readonly install: string,
  ) {
    this.plugin = join(base, "plugin");
    this.main = join(base, "repo");
    this.#env = { XDG_RUNTIME_DIR: runtime };
  }

  static create(install: string, options: FixtureOptions = {}): E2E {
    // Under /tmp: the OS temp dir can sit inside a checkout that has node_modules.
    const base = realpathSync(mkdtempSync("/tmp/squeal-e2e-"));
    const e2e = new E2E(base, realpathSync(mkdtempSync("/tmp/sq-")), install);
    try {
      e2e.#build(options);
    } catch (error) {
      rmSync(base, { recursive: true, force: true });
      rmSync(e2e.runtime, { recursive: true, force: true });
      throw error;
    }
    return e2e;
  }

  #build(options: FixtureOptions): void {
    const archive = execFileSync("git", ["archive", "HEAD", "plugins/claude-code"], {
      cwd: REPO_ROOT,
      maxBuffer: 64 * 1024 * 1024,
    });
    const unpacked = join(this.base, "archive");
    mkdirSync(unpacked);
    execFileSync("tar", ["-x", "-C", unpacked], { input: archive });
    execFileSync("mv", [join(unpacked, "plugins/claude-code"), this.plugin]);
    rmSync(unpacked, { recursive: true });

    const repo = this.main;
    cpSync(join(FIXTURE, "project"), repo, { recursive: true });
    execFileSync("mv", [join(repo, "_gitignore"), join(repo, ".gitignore")]);
    if (options.slow === true) cpSync(join(FIXTURE, "slow"), repo, { recursive: true });
    mkdirSync(join(repo, "src"));
    this.write(repo, "math", MATH());
    this.write(repo, "strings", STRINGS());
    if (options.slow === true) this.write(repo, "slow", SLOW());
    const policy = options.policy ?? {};
    writeFileSync(
      join(repo, "squeal.config.json"),
      typeof policy === "string" ? policy : `${JSON.stringify(policy, null, 2)}\n`,
    );
    this.#copyInstall(repo, true);
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["add", "-A"]);
    git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture"]);
  }

  /** package.json, its lockfile and node_modules from the cached install, as `npm install` leaves them. */
  #copyInstall(root: string, manifests: boolean): void {
    if (manifests) {
      for (const file of ["package.json", "package-lock.json"]) {
        cpSync(join(this.install, file), join(root, file));
      }
    }
    execFileSync("cp", ["-a", join(this.install, "node_modules"), join(root, "node_modules")]);
  }

  /** `git worktree add`, then the same install the main worktree has, as a user would run it. */
  addWorktree(name = "wt2"): string {
    const root = join(this.base, name);
    git(this.main, ["worktree", "add", "-q", "-b", name, root]);
    this.#copyInstall(root, false);
    return realpathSync(root);
  }

  /** Writes `src/<file>.ts` with a fresh counter comment, so its content is new to the store. */
  write(root: string, file: Source, body: string): void {
    writeFileSync(join(root, "src", `${file}.ts`), `// edit ${this.#edits++}\n${body}`);
  }

  /** Runs a hook bundle the way hooks.json does, fed the recorded input with `cwd` set to `root`. */
  async hook(name: HookName, root: string, overrides: object = {}): Promise<Hooked> {
    const run = await runNode(
      ["--disable-warning=ExperimentalWarning", join(this.plugin, "dist", `${name}.mjs`)],
      recorded(name, root, overrides),
      this.#env,
    );
    const json = run.stdout === "" ? null : (JSON.parse(run.stdout) as HookJson);
    const out = json?.hookSpecificOutput;
    const text = out?.additionalContext ?? out?.permissionDecisionReason ?? json?.reason ?? null;
    metric({ hook: name, ms: Math.round(run.ms), delivered: text !== null });
    return { ...run, json, text };
  }

  /** The shipped CLI, as `bin/squeal` runs it. */
  cli(root: string, args: readonly string[]): Promise<BundleRun> {
    return runNode(
      ["--disable-warning=ExperimentalWarning", join(this.plugin, "dist/cli/squeal.mjs"), ...args],
      "",
      this.#env,
      root,
    );
  }

  /** `squeal status --json` from the shipped CLI; throws when status is unavailable. */
  async status(root: string): Promise<StatusSnapshot> {
    const run = await this.cli(root, ["status", "--json"]);
    const status = JSON.parse(run.stdout) as StatusSnapshot | { available: false; message: string };
    if (!status.available) throw new Error(`status unavailable: ${status.message}`);
    return status;
  }

  async ping(root: string): Promise<PingResponse | null> {
    const socket = socketPathFor(worktreeIdFor(root), this.#env);
    const response = await requestDaemon(socket, { type: "ping" }, 1_000).catch(() => null);
    return response?.ok === true && response.type === "ping" ? response : null;
  }

  /** Waits for a daemon in `phase: ready`; with `not`, for one with another pid. */
  daemonReady(root: string, not?: number): Promise<PingResponse> {
    return until(`a ready daemon in ${root}`, DAEMON_WAIT_MS, async () => {
      const ping = await this.ping(root);
      return ping?.phase === "ready" && ping.pid !== not ? ping : null;
    });
  }

  /**
   * Waits until status has nothing pending, a daemon validating, a revision
   * after `after` (when given) and `accept` holds.
   */
  settle(
    root: string,
    what: string,
    accept: (s: StatusSnapshot) => boolean = () => true,
    after = -1,
  ): Promise<StatusSnapshot> {
    return until(what, SETTLE_WAIT_MS, async () => {
      const s = await this.status(root);
      const quiet =
        s.daemon.state === "alive" &&
        s.revision > after &&
        s.counts.pending + s.testFilesWithoutChecks.pending + s.testFilesWithoutChecks.unknown ===
          0;
      return quiet && accept(s) ? s : null;
    });
  }

  /** Writes `src/<file>.ts` and waits for the revision it makes to settle. */
  async edit(
    root: string,
    file: Source,
    body: string,
    accept?: (s: StatusSnapshot) => boolean,
  ): Promise<StatusSnapshot> {
    const before = (await this.status(root)).revision;
    const started = performance.now();
    this.write(root, file, body);
    const settled = await this.settle(root, `the edit of src/${file}.ts to settle`, accept, before);
    metric({ settle: file, ms: Math.round(performance.now() - started) });
    return settled;
  }

  /** Runs of one worktree, oldest first, read straight from the shared store. */
  runs(root: string): RunRow[] {
    return readRuns(join(this.main, ".git/squeal/store.sqlite"), worktreeIdFor(root));
  }

  /** `squeal stop` in every worktree, then SIGKILL for any daemon of this plugin copy still alive. */
  async cleanup(): Promise<void> {
    const roots = [this.main, join(this.base, "wt2")].filter((r) => existsSync(r));
    await Promise.all(roots.map((root) => this.cli(root, ["stop"]).catch(() => null)));
    for (const pid of daemonPids(this.plugin)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Gone between the listing and the kill.
      }
    }
    rmSync(this.base, { recursive: true, force: true });
    rmSync(this.runtime, { recursive: true, force: true });
  }
}

/**
 * Registers the suite's install and cleanup; returns a fixture factory that
 * skips the test, with the reason, when Vitest cannot be installed.
 */
export function e2eSuite(): (ctx: TestContext, options?: FixtureOptions) => E2E {
  let install: Install = { ok: false, reason: "the install did not run" };
  const fixtures: E2E[] = [];
  beforeAll(async () => {
    install = await vitestInstall();
  }, 400_000);
  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
  }, 120_000);
  return (ctx, options) => {
    const ready = install;
    if (!ready.ok) return ctx.skip(`end to end skipped: ${ready.reason}`);
    const fixture = E2E.create(ready.dir, options);
    fixtures.push(fixture);
    return fixture;
  };
}
