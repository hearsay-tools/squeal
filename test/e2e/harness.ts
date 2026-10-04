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
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeAll, type TestContext } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { socketPathFor } from "../../src/core/daemon/paths.js";
import { worktreeIdFor } from "../../src/core/store/index.js";
import type { PingResponse, StatusSnapshot } from "../../src/core/types/index.js";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import { type BundleRun, runNode } from "../harness/bundle-helpers.js";
import { recorded } from "../harness/helpers.js";
import { type Install, vitestInstall } from "./install.js";

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
/** `test/slow.test.ts` sleeps this long per run, so a hook can fire while it is in flight. */
export const SLOW_MS = 5_000;
/** Spec 001 D9: every hook has `timeout: 2`. */
export const HOOK_BUDGET_MS = 2_000;
const DAEMON_WAIT_MS = 45_000;
const SETTLE_WAIT_MS = 90_000;
const POLL_MS = 150;

export const SESSION = "6248afa0-bd5b-459c-83da-3a7cc9d9f9a0";
export const OTHER_SESSION = "0d7c5b1e-3f0a-4b8e-9a51-2c6e8f4d7a90";

export const MATH = (add: "+" | "-" = "+", mul: "*" | "+" = "*") =>
  `export const add = (a: number, b: number) => a ${add} b;\nexport const mul = (a: number, b: number) => a ${mul} b;\n`;
export const STRINGS = (suffix: "!" | "?" = "!") =>
  `export const shout = (s: string) => \`\${s.toUpperCase()}${suffix}\`;\n`;
export const SLOW = (factor: 2 | 3 = 2) =>
  `export const SLOW_MS = ${SLOW_MS};\nexport const double = (n: number) => n * ${factor};\n`;
type Source = "math" | "strings" | "slow";

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

export interface RunRow {
  readonly revision: number;
  readonly testFiles: readonly string[];
  readonly end: string | null;
}

export interface FixtureOptions {
  /** Written as `squeal.config.json`: an object as JSON, a string verbatim. Default `{}`. */
  readonly policy?: object | string;
  /** Adds `test/slow.test.ts`, which takes `SLOW_MS` per run. */
  readonly slow?: boolean;
}

const git = (cwd: string, args: readonly string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });

export function hasNodeModulesAbove(dir: string): boolean {
  for (let at = dirname(dir); ; at = dirname(at)) {
    if (existsSync(join(at, "node_modules"))) return true;
    if (dirname(at) === at) return false;
  }
}

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
    const archive = execFileSync("git", ["archive", "HEAD", "plugins/claude-code"], {
      cwd: REPO_ROOT,
      maxBuffer: 64 * 1024 * 1024,
    });
    mkdirSync(join(base, "archive"));
    execFileSync("tar", ["-x", "-C", join(base, "archive")], { input: archive });
    execFileSync("mv", [join(base, "archive/plugins/claude-code"), e2e.plugin]);
    rmSync(join(base, "archive"), { recursive: true });

    const repo = e2e.main;
    cpSync(join(FIXTURE, "project"), repo, { recursive: true });
    execFileSync("mv", [join(repo, "_gitignore"), join(repo, ".gitignore")]);
    if (options.slow === true) cpSync(join(FIXTURE, "slow"), repo, { recursive: true });
    mkdirSync(join(repo, "src"));
    e2e.write(repo, "math", MATH());
    e2e.write(repo, "strings", STRINGS());
    if (options.slow === true) e2e.write(repo, "slow", SLOW());
    const policy = options.policy ?? {};
    writeFileSync(
      join(repo, "squeal.config.json"),
      typeof policy === "string" ? policy : `${JSON.stringify(policy, null, 2)}\n`,
    );
    e2e.#copyInstall(repo, true);
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["add", "-A"]);
    git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture"]);
    return e2e;
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
    this.write(root, file, body);
    return this.settle(root, `the edit of src/${file}.ts to settle`, accept, before);
  }

  /** Runs of one worktree, oldest first, read straight from the shared store. */
  runs(root: string): RunRow[] {
    const db = new DatabaseSync(join(this.main, ".git/squeal/store.sqlite"), { readOnly: true });
    try {
      const rows = db
        .prepare(
          "SELECT revision, test_files, end_state FROM runs WHERE worktree_id = ? ORDER BY started_at, rowid",
        )
        .all(worktreeIdFor(root)) as {
        revision: number;
        test_files: string;
        end_state: string | null;
      }[];
      return rows.map((r) => ({
        revision: r.revision,
        testFiles: (JSON.parse(r.test_files) as { path: string }[]).map((f) => f.path),
        end: r.end_state,
      }));
    } finally {
      db.close();
    }
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

/** Pids of daemons started from this plugin copy's CLI. */
function daemonPids(plugin: string): number[] {
  const ps = execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" });
  const cli = join(plugin, "dist/cli/squeal.mjs");
  return ps
    .split("\n")
    .filter((line) => line.includes(`${cli} daemon`))
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isInteger(pid) && pid !== process.pid);
}

export async function until<T>(
  what: string,
  ms: number,
  probe: () => Promise<T | null>,
): Promise<T> {
  const deadline = Date.now() + ms;
  let last: unknown = null;
  for (;;) {
    const value = await probe().catch((error: unknown) => {
      last = error;
      return null;
    });
    if (value !== null) return value;
    if (Date.now() > deadline) {
      throw new Error(
        `timed out after ${ms} ms waiting for ${what}${last ? `: ${String(last)}` : ""}`,
      );
    }
    await sleep(POLL_MS);
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
