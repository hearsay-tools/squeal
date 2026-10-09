import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, type TestContext } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { socketPathFor } from "../../src/core/daemon/paths.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import type { PingResponse, StatusSnapshot } from "../../src/core/types/index.js";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import { type BundleRun, runNode } from "../harness/bundle-helpers.js";
import { fixtureInstall, type Install, type InstallKind } from "./install.js";
import { copyPlugin, type HookName, type Plugin } from "./plugins.js";
import { DEMO, MATH, SLOW, SOURCE_PATH, type Source, STRINGS } from "./sources.js";
import { daemonPids, metric, type RunRow, readRuns, registeredSessions, until } from "./support.js";

export { type HookName, PLUGINS, type Plugin } from "./plugins.js";
export { DEMO, MATH, SLOW, SLOW_MS, STRINGS } from "./sources.js";
export { hasNodeModulesAbove, until } from "./support.js";

/*
 * Spec 001 Testing, end to end, and review wave 3 "Inputs for wave 4": the
 * plugin as a marketplace install copies it (the tracked files of
 * `plugins/<name>` under /tmp, no `node_modules` above it), a fixture
 * repository with its own Vitest, hook bundles driven by recorded hook JSON,
 * daemons spawned by those bundles from the shipped CLI, and no `SQUEAL_CLI`
 * anywhere: the hooks get PATH, HOME and a private XDG_RUNTIME_DIR only.
 * The worktree's tracked files are what runs, not HEAD's (002-24): Squeal
 * keys these files by worktree content, so a result always belongs to what
 * ran; untracked files still do not ship, as a marketplace install would not
 * have them. Build before trusting a local result. Spec 002 runs every scenario for the Codex plugin too, each
 * hook as its harness runs it (`plugins.ts`).
 */

const FIXTURE = join(REPO_ROOT, "test/fixtures/e2e");
/** Spec 001 D9: every hook has `timeout: 2`. */
export const HOOK_BUDGET_MS = 2_000;
const DAEMON_WAIT_MS = 45_000;
/** The integration test's budget (`test/integration/node-test.test.ts`): node:test runs a process per file. */
const SETTLE_WAIT_MS = 120_000;

/** The recorded hook JSON's session is the default consumer; this is a second one. */
export const OTHER_SESSION = "0d7c5b1e-3f0a-4b8e-9a51-2c6e8f4d7a90";

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
  /** A directory under `test/fixtures/e2e` copied over the repository, after the others. */
  readonly overlay?: string;
  /** Files written by `writeAt` before the first commit, by repository path, such as a built artifact. */
  readonly files?: Readonly<Record<string, string>>;
  /**
   * Edits `squeal.config.json` before the first commit, after `policy` or
   * `squeal init` wrote it: a node:test fixture marks a project slow this way.
   */
  readonly amendPolicy?: (policy: Record<string, unknown>) => object;
}

interface BuildOptions extends FixtureOptions {
  /**
   * The install is the node:test workspace's, and the fixture adds
   * `test/fixtures/e2e/node-test`, shaped like `test/fixtures/node-test/reference`;
   * `squeal.config.json` is then written by the shipped CLI's `squeal init`
   * from its scripts, and `policy` is unused.
   */
  readonly nodeTest?: boolean;
}

const git = (cwd: string, args: readonly string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });

/** One fixture: a plugin copy, a repository, its worktrees and their daemons. */
export class E2E {
  readonly plugin: string;
  readonly main: string;
  readonly #env: Readonly<Record<string, string>>;
  #edits = 0;
  /** Linked worktrees `addWorktree` made, stopped at cleanup. */
  readonly #worktrees: string[] = [];

  private constructor(
    readonly kind: Plugin,
    readonly base: string,
    readonly runtime: string,
    readonly install: string,
  ) {
    this.plugin = join(base, "plugin");
    this.main = join(base, "repo");
    this.#env = { XDG_RUNTIME_DIR: runtime };
  }

  static create(kind: Plugin, install: string, options: BuildOptions = {}): E2E {
    // Under /tmp: the OS temp dir can sit inside a checkout that has node_modules.
    const base = realpathSync(mkdtempSync("/tmp/squeal-e2e-"));
    const e2e = new E2E(kind, base, realpathSync(mkdtempSync("/tmp/sq-")), install);
    try {
      e2e.#build(options);
    } catch (error) {
      rmSync(base, { recursive: true, force: true });
      rmSync(e2e.runtime, { recursive: true, force: true });
      throw error;
    }
    return e2e;
  }

  #build(options: BuildOptions): void {
    copyPlugin(this.kind.name, this.plugin);

    const repo = this.main;
    const nodeTest = options.nodeTest === true;
    cpSync(join(FIXTURE, "project"), repo, { recursive: true });
    execFileSync("mv", [join(repo, "_gitignore"), join(repo, ".gitignore")]);
    if (options.slow === true) cpSync(join(FIXTURE, "slow"), repo, { recursive: true });
    if (nodeTest) cpSync(join(FIXTURE, "node-test"), repo, { recursive: true });
    if (options.overlay !== undefined) {
      cpSync(join(FIXTURE, options.overlay), repo, { recursive: true });
    }
    this.write(repo, "math", MATH());
    this.write(repo, "strings", STRINGS());
    if (options.slow === true) this.write(repo, "slow", SLOW());
    if (nodeTest) this.write(repo, "demo", DEMO());
    for (const [path, body] of Object.entries(options.files ?? {})) this.writeAt(repo, path, body);
    this.#copyInstall(repo, true);
    git(repo, ["init", "-q", "-b", "main"]);
    if (nodeTest) {
      // Spec 003 D1: the configuration a user gets, seeded from the packages' scripts.
      execFileSync(
        process.execPath,
        ["--disable-warning=ExperimentalWarning", this.#cliPath, ...this.kind.init],
        {
          cwd: repo,
          stdio: "pipe",
          env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...this.#env },
        },
      );
    } else {
      const policy = options.policy ?? {};
      writeFileSync(
        join(repo, "squeal.config.json"),
        typeof policy === "string" ? policy : `${JSON.stringify(policy, null, 2)}\n`,
      );
    }
    if (options.amendPolicy !== undefined) {
      const file = join(repo, "squeal.config.json");
      const policy = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      writeFileSync(file, `${JSON.stringify(options.amendPolicy(policy), null, 2)}\n`);
    }
    git(repo, ["add", "-A"]);
    git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture"]);
  }

  get #cliPath(): string {
    return join(this.plugin, "dist/cli/squeal.mjs");
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
    this.#worktrees.push(root);
    this.#copyInstall(root, false);
    return realpathSync(root);
  }

  /** Writes the source `file` with a fresh counter comment, so its content is new to the store. */
  write(root: string, file: Source, body: string): void {
    this.writeAt(root, SOURCE_PATH[file], body);
  }

  /** Writes `body` at the repository path `path` with a fresh counter comment, as `write` does. */
  writeAt(root: string, path: string, body: string): void {
    const at = join(root, path);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, `// edit ${this.#edits++}\n${body}`);
  }

  /** Runs a hook the way the plugin's harness does, fed the recorded input with `cwd` set to `root`. */
  async hook(name: HookName, root: string, overrides: object = {}): Promise<Hooked> {
    const run = await this.kind.run(this.plugin, name, root, overrides, this.#env);
    const json = run.stdout === "" ? null : (JSON.parse(run.stdout) as HookJson);
    const out = json?.hookSpecificOutput;
    const text = out?.additionalContext ?? out?.permissionDecisionReason ?? json?.reason ?? null;
    metric({
      plugin: this.kind.name,
      hook: name,
      ms: Math.round(run.ms),
      delivered: text !== null,
    });
    return { ...run, json, text };
  }

  /** The shipped CLI, as `bin/squeal` runs it. */
  cli(root: string, args: readonly string[]): Promise<BundleRun> {
    return runNode(
      ["--disable-warning=ExperimentalWarning", this.#cliPath, ...args],
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
   * after `after` (when given) and `accept` holds. The runner part of a
   * revision counts as pending (001 D2): a node:test observed-only path
   * re-keys its test file only in the refinement, as the integration test
   * found under load.
   */
  settle(
    root: string,
    what: string,
    accept: (s: StatusSnapshot) => boolean = () => true,
    after = -1,
  ): Promise<StatusSnapshot> {
    return this.#settle(root, what, accept, after, false);
  }

  /**
   * `settle` for the fast tier alone (spec 004 D2): slow files may stay
   * pending, as they do while a consumer is in a turn.
   */
  settleFast(
    root: string,
    what: string,
    accept: (s: StatusSnapshot) => boolean = () => true,
    after = -1,
  ): Promise<StatusSnapshot> {
    return this.#settle(root, what, accept, after, true);
  }

  #settle(
    root: string,
    what: string,
    accept: (s: StatusSnapshot) => boolean,
    after: number,
    fastOnly: boolean,
  ): Promise<StatusSnapshot> {
    return until(what, SETTLE_WAIT_MS, async () => {
      const s = await this.status(root);
      const slow = fastOnly ? s.slowPending : undefined;
      const pending =
        s.counts.pending -
        (slow?.checks ?? 0) +
        s.testFilesWithoutChecks.pending -
        (slow?.testFilesWithoutChecks ?? 0) +
        s.testFilesWithoutChecks.unknown;
      const quiet =
        s.daemon.state === "alive" &&
        s.revision > after &&
        s.runnerPartPending !== true &&
        pending === 0;
      return quiet && accept(s) ? s : null;
    });
  }

  /** Writes the source `file` and waits for the revision it makes to settle. */
  async edit(
    root: string,
    file: Source,
    body: string,
    accept?: (s: StatusSnapshot) => boolean,
  ): Promise<StatusSnapshot> {
    const before = (await this.status(root)).revision;
    const started = performance.now();
    this.write(root, file, body);
    const what = `the edit of ${SOURCE_PATH[file]} to settle`;
    const settled = await this.settle(root, what, accept, before);
    metric({ plugin: this.kind.name, settle: file, ms: Math.round(performance.now() - started) });
    return settled;
  }

  /** Runs of one worktree, oldest first, read straight from the shared store. */
  runs(root: string): RunRow[] {
    return readRuns(join(this.main, ".git/squeal/store.sqlite"), worktreeIdFor(root));
  }

  /**
   * Ends every session still registered with the plugin's SessionEnd, as its
   * harness would, so no daemon keeps a consumer; then `squeal stop` in every
   * worktree, SIGKILL for any daemon of this plugin copy still alive, and the
   * fixture removed whatever failed before (lessons, defect 24: a fixture
   * daemon outlived its suite by 10 hours). Daemons a hook spawned meanwhile
   * are killed after the removal, and one that escapes exits on its root.
   */
  async cleanup(): Promise<void> {
    try {
      const sessions = registeredSessions(join(this.main, ".git/squeal/store.sqlite"));
      for (const session_id of sessions) {
        await this.hook("session-end", this.main, { session_id }).catch(() => null);
      }
      const roots = [this.main, ...this.#worktrees].filter((r) => existsSync(r));
      await Promise.all(roots.map((root) => this.cli(root, ["stop"]).catch(() => null)));
      this.#killDaemons();
    } finally {
      rmSync(this.base, { recursive: true, force: true, maxRetries: 3 });
      rmSync(this.runtime, { recursive: true, force: true, maxRetries: 3 });
      this.#killDaemons();
    }
  }

  #killDaemons(): void {
    for (const pid of daemonPids(this.plugin)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Gone between the listing and the kill.
      }
    }
  }
}

/**
 * Registers the suite's install and cleanup; returns a fixture factory that
 * skips the test, with the reason, when the install cannot be made. Every
 * fixture of a `node-test` suite is the node:test workspace (`BuildOptions`).
 */
export function e2eSuite(
  kind: InstallKind = "vitest",
): (ctx: TestContext, plugin: Plugin, options?: FixtureOptions) => E2E {
  let install: Install = { ok: false, reason: "the install did not run" };
  const fixtures: E2E[] = [];
  beforeAll(async () => {
    install = await fixtureInstall(kind);
  }, 400_000);
  const plugins: string[] = [];
  afterEach(async () => {
    const done = fixtures.splice(0);
    plugins.push(...done.map((f) => f.plugin));
    await Promise.all(done.map((f) => f.cleanup()));
  }, 120_000);
  // Lessons, defect 24: the suite leaves no daemon of its fixtures running.
  afterAll(async () => {
    await until("no fixture daemon left", 10_000, async () =>
      plugins.every((plugin) => daemonPids(plugin).length === 0) ? true : null,
    );
  }, 20_000);
  return (ctx, plugin, options = {}) => {
    const ready = install;
    if (!ready.ok) return ctx.skip(`end to end skipped: ${ready.reason}`);
    const fixture = E2E.create(plugin, ready.dir, { ...options, nodeTest: kind === "node-test" });
    fixtures.push(fixture);
    return fixture;
  };
}
