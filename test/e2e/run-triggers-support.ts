import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import { type BundleRun, runNode } from "../harness/bundle-helpers.js";
import { recorded } from "../harness/helpers.js";
import type { E2E, Hooked } from "./harness.js";
import { codexEnvironment, copyPlugin } from "./plugins.js";
import { until } from "./support.js";

/*
 * Spec 019 Testing, "Proof" (row 019-17): what `run-triggers.test.ts` needs
 * beside `harness.ts`. The harness drives one handler per event; Stop has two
 * in both plugins, the 2 s entry and the waiting entry (`stop-slow`), and the
 * harness runs them at once. A turn starts at a user prompt (019 D4 step 3).
 * Codex runs each handler's command string from its `hooks/hooks.json`, as
 * `plugins.ts` does.
 */

const CODEX_FIXTURES = join(REPO_ROOT, "test/fixtures/codex-hooks/app-server");
const SETTLE_MS = 180_000;

/** The handlers this file runs beyond the harness's own. */
type Extra = "stop-slow" | "user-prompt-submit";

const codexInput = (name: string) =>
  JSON.parse(readFileSync(join(CODEX_FIXTURES, `${name}.json`), "utf8")) as Record<string, unknown>;

/** The command of `event`'s handler number `index` in the Codex copy's `hooks/hooks.json`. */
function codexCommand(copy: string, event: string, index: number): string {
  const json = JSON.parse(readFileSync(join(copy, "hooks/hooks.json"), "utf8")) as {
    hooks: Record<string, readonly { hooks: readonly { command: string }[] }[]>;
  };
  const command = json.hooks[event]?.[0]?.hooks[index]?.command;
  if (command === undefined) throw new Error(`no ${event}[${index}] handler in ${copy}`);
  return command;
}

/** The private runtime the harness gives every hook and daemon of `e`. */
function envOf(e: E2E): Record<string, string> {
  return {
    XDG_RUNTIME_DIR: e.runtime,
    ...(e.kind.name === "codex" ? codexEnvironment(e.plugin) : {}),
  };
}

/** Runs one handler `extra` of `e`'s plugin copy in `root`, as its harness runs it. */
export async function hookExtra(
  e: E2E,
  extra: Extra,
  root: string,
  overrides: object = {},
  env: Readonly<Record<string, string>> = {},
): Promise<Hooked> {
  const run =
    e.kind.name === "claude-code"
      ? claude(e, extra, root, overrides, env)
      : codex(e, extra, root, overrides, env);
  const done = await run;
  const json = done.stdout.trim() === "" ? null : (JSON.parse(done.stdout) as Hooked["json"]);
  const out = json?.hookSpecificOutput;
  const text = out?.additionalContext ?? json?.reason ?? null;
  return { ...done, json, text };
}

type Run = (
  e: E2E,
  extra: Extra,
  root: string,
  overrides: object,
  env: object,
) => Promise<BundleRun>;

const claude: Run = (e, extra, root, overrides, env) => {
  const input = recorded(extra === "stop-slow" ? "stop" : extra, root, overrides);
  const bundle = join(e.plugin, "dist", `${extra}.mjs`);
  return runNode(["--disable-warning=ExperimentalWarning", bundle], input, { ...envOf(e), ...env });
};

const codex: Run = (e, extra, root, overrides, env) => {
  const name = extra === "stop-slow" ? "stop" : extra;
  const start = codexInput("session-start");
  const input = { ...codexInput(name), session_id: start.session_id, cwd: root, ...overrides };
  const command =
    extra === "stop-slow"
      ? codexCommand(e.plugin, "Stop", 1)
      : codexCommand(e.plugin, "UserPromptSubmit", 0);
  return shell(command, JSON.stringify(input), root, {
    PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    PWD: root,
    PLUGIN_ROOT: e.plugin,
    ...envOf(e),
    ...env,
  });
};

function shell(
  command: string,
  stdin: string,
  cwd: string,
  env: Readonly<Record<string, string>>,
): Promise<BundleRun> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn("bash", ["-c", command], {
      cwd,
      env: { HOME: process.env.HOME ?? "", ...env },
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => err.push(b));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        code,
        ms: performance.now() - started,
      }),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
  });
}

/** What a Stop gave: the 2 s entry, the waiting entry, and the wall time of the two. */
export interface StopBoth {
  readonly quick: Hooked;
  readonly waiting: Hooked;
  readonly ms: number;
}

/** Both Stop handlers at once, as Claude Code and Codex run them; `overrides` go into both. */
export async function stopBoth(e: E2E, root: string, overrides: object = {}): Promise<StopBoth> {
  const started = performance.now();
  const [quick, waiting] = await Promise.all([
    e.hook("stop", root, overrides),
    hookExtra(e, "stop-slow", root, overrides),
  ]);
  return { quick, waiting, ms: performance.now() - started };
}

/** The harness continues a turn after a Stop that blocked: its next Stop says so. */
export const CONTINUED = { stop_hook_active: true };

/** A run row with its times, as `readRuns` reads it with no Squeal code. */
export interface TimedRun {
  readonly revision: number;
  readonly testFiles: readonly string[];
  readonly started: number;
  readonly ended: number | null;
}

/** Runs of `root`'s worktree, oldest first, with their start and end. */
export function timedRuns(e: E2E, root: string): TimedRun[] {
  const db = new DatabaseSync(join(e.main, ".git/squeal/store.sqlite"), { readOnly: true });
  try {
    const rows = db
      .prepare(
        "SELECT revision, test_files, started_at, ended_at FROM runs WHERE worktree_id = ? ORDER BY started_at, rowid",
      )
      .all(worktreeIdFor(root)) as {
      revision: number;
      test_files: string;
      started_at: number;
      ended_at: number | null;
    }[];
    return rows.map((r) => ({
      revision: r.revision,
      testFiles: (JSON.parse(r.test_files) as { path: string }[]).map((f) => f.path),
      started: r.started_at,
      ended: r.ended_at,
    }));
  } finally {
    db.close();
  }
}

/** The test files the runs of `root` after its first `from` ran. */
export const ranAfter = (e: E2E, root: string, from: number) =>
  new Set(
    timedRuns(e, root)
      .slice(from)
      .flatMap((r) => r.testFiles),
  );

/**
 * Status once every group at `edit` is current (019 D6's group lines), a
 * daemon validating with its runner part applied, a revision after `after`,
 * and `accept`: the groups at a later moment stay pending. `lanePending`
 * counts every configured group, those at `edit` too, so it cannot say this.
 */
export function settleEdit(
  e: E2E,
  root: string,
  what: string,
  accept: (s: StatusSnapshot) => boolean,
  after = -1,
): Promise<StatusSnapshot> {
  return until(what, SETTLE_MS, async () => {
    const s = await e.status(root);
    const edits = (s.groupTiers ?? []).filter((g) => g.at === "edit");
    const quiet =
      s.daemon.state === "alive" &&
      s.revision > after &&
      s.runnerPartPending !== true &&
      edits.length > 0 &&
      edits.every((g) => g.current === g.testFiles);
    return quiet && accept(s) ? s : null;
  });
}

/**
 * The user's first prompt, in an interactive session, once the daemon the
 * SessionStart spawned made the store. With no store a hook registers
 * nothing (task 001-88); then no agent is in a turn, the worktree reads as
 * paused, and a group at `stop` runs at the start. Claude Code's prompt
 * registers only in an attended session (`isInteractive`); Codex's always.
 */
export async function promptOnceStored(e: E2E): Promise<Hooked> {
  const store = join(e.main, ".git/squeal/store.sqlite");
  await until("the store", 30_000, async () => (existsSync(store) ? true : null));
  return hookExtra(e, "user-prompt-submit", e.main, {}, { CLAUDE_CODE_SESSION_ATTENDED: "1" });
}

/** Links this repository's oxlint into the fixture `root`, as `test/lint/oxlint` does. */
export function installOxlint(root: string): void {
  mkdirSync(join(root, "node_modules"), { recursive: true });
  symlinkSync(
    realpathSync(join(REPO_ROOT, "node_modules/oxlint")),
    join(root, "node_modules/oxlint"),
  );
}

/** `git add -A && git commit` in `root`; returns the new `HEAD`. */
export function commitAll(root: string, message: string): string {
  const git = (args: readonly string[]) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe", encoding: "utf8" });
  git(["add", "-A"]);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", message]);
  return git(["rev-parse", "HEAD"]).trim();
}

/**
 * The plugin `e.kind` as the commit `ref` shipped it (this worktree's files
 * when `ref` is absent), in place of `e`'s copy, as `codex-migration.test.ts`
 * unpacks an old release; call before the first hook. Codex's adapter runs
 * the runtime its data folder selects, else its seed (spec 002 D8), which is
 * older than the release: the runtime of the same commit is installed and
 * selected there, as an update leaves it.
 */
export function pluginAt(e: E2E, ref?: string): void {
  if (ref !== undefined) unpack(ref, `plugins/${e.kind.name}`, e.plugin);
  if (e.kind.name !== "codex") return;
  const data = `${e.plugin}.data`;
  const staged = join(data, "staged");
  if (ref === undefined) copyPlugin("codex-runtime", staged);
  else unpack(ref, "plugins/codex-runtime", staged);
  const { version } = JSON.parse(readFileSync(join(staged, "runtime.json"), "utf8")) as {
    version: string;
  };
  mkdirSync(join(data, "versions"), { recursive: true });
  renameSync(staged, join(data, "versions", version));
  writeFileSync(join(data, "runtime/current.json"), `${JSON.stringify({ schema: 1, version })}\n`);
}

/** `git archive <ref> <prefix>` unpacked into `dest`, the prefix stripped. */
function unpack(ref: string, prefix: string, dest: string): void {
  const archive = execFileSync("git", ["archive", ref, prefix], {
    cwd: REPO_ROOT,
    maxBuffer: 256 * 1024 * 1024,
  });
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const depth = String(prefix.split("/").length);
  const done = spawnSync("tar", ["-xf", "-", "-C", dest, `--strip-components=${depth}`], {
    input: archive,
  });
  if (done.status !== 0) throw new Error(`tar: ${done.stderr.toString()}`);
}
