import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { resolveCommit, withStores } from "../core/commit/at-keys-checkout.js";
import type { CheckoutOptions } from "../core/commit/at-keys-walk.js";
import { squealVersion } from "../core/daemon/version.js";
import { findWorktreeRoot, resolveCommonDir, worktreeIdFor } from "../core/fs/git-layout.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";
import { daemonAdapters } from "./code-gate-stored.js";
import type { CliIo } from "./main.js";
import { assembleReport } from "./status-at-assemble.js";
import { daemonCall } from "./status-at-call.js";
import { commitRun } from "./status-at-commit-run.js";
import type { AtDaemons } from "./status-at-daemons.js";
import { headRefusal } from "./status-at-next.js";
import { listLate, nowSide } from "./status-at-now.js";
import { unionRefs } from "./status-at-refs.js";
import { exitCode, formatAt, jsonAt } from "./status-at-report.js";
import { RUN_WAIT_MS } from "./status-at-report-queued.js";
import { runChild, takeRunRequest } from "./status-at-run-child.js";

/*
 * Spec 023 D1 and D3 (row 023-06): `squeal status --at <commit> [<path>...]
 * [--json]`. Each test file's result at the commit's key, the keys from the
 * gate's keyer in a temporary checkout there (`keysAtCommit`, D2 as
 * amended), beside its current state, and the comparison. It runs no test
 * and writes nothing shared. Row 023-40 (D7.3): with `--run`, the files
 * the change selects run in the commit daemon and in this worktree's
 * daemon, and the call waits for them up to `--wait` (`status-at-call.ts`).
 */

/**
 * What tests set beside the CLI's own: the checkout's place and install;
 * row 023-19, `--run`'s paths per batch (else sized from this machine).
 * Row 023-40: the daemons the call talks to, and how long a new commit
 * waits for a place under the ceiling.
 */
export type AtOptions = Pick<CheckoutOptions, "cacheRoot" | "install"> & {
  readonly batchFiles?: number;
  readonly daemons?: AtDaemons;
  readonly placeWaitMs?: number;
};

/** Row 023-40 (D7.3): `--run [--all-missing]`. */
export interface AtRunArgs {
  readonly allMissing: boolean;
}

export interface AtArgs {
  readonly commit: string;
  readonly paths: readonly string[];
  readonly json: boolean;
  /** Row 023-19 (P6): list every unknown file in the text, not by group; absent when not given. */
  readonly full?: boolean;
  /** Row 023-40: `--run [--all-missing]`; absent or `null` without `--run`. */
  readonly run?: AtRunArgs | null;
  /**
   * Row 023-40 (D7.3): `--wait <ms>`; `Infinity` for a bare `--wait`;
   * absent or `null` without it (`--run` then waits `RUN_WAIT_MS`).
   */
  readonly waitMs?: number | null;
}

/** The options that take a value, and what their value is. */
const VALUED = { "--at": "a commit" } as const;
type Valued = keyof typeof VALUED;
const FLAGS = new Set(["--json", "--full", "--run", "--all-missing"]);

/**
 * Row 023-40 (D7.3, replacing row 023-34's T5 line): `--timeout` with
 * `--at`, a problem `main` prints as this one line: the call waits, and
 * the work goes on in the daemons after it.
 */
export const AT_NO_TIMEOUT = `--at takes no --timeout; --run waits up to --wait <ms> (${RUN_WAIT_MS} by default) and its runs go on in the daemons after it`;

/** `--at <commit>` and what may follow it; a usage problem as a string. */
export function parseAt(args: readonly string[]): AtArgs | string {
  if (args.some((arg) => arg === "--timeout" || arg.startsWith("--timeout="))) return AT_NO_TIMEOUT;
  const wait = takeAtWait(args);
  if (typeof wait === "string") return wait;
  const values = new Map<Valued, string>();
  const flags = new Set<string>();
  const paths: string[] = [];
  const rest = wait.rest;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] ?? "";
    const option = valuedOption(rest, i);
    if (typeof option === "string") return option;
    if (option !== null) {
      if (values.has(option.name)) return `${option.name} is given twice`;
      values.set(option.name, option.value);
      i += option.taken;
    } else if (FLAGS.has(arg)) flags.add(arg);
    else if (arg.startsWith("--")) return `unknown option "${arg}" with --at`;
    else paths.push(arg);
  }
  const commit = values.get("--at");
  if (commit === undefined || commit === "") return "--at needs a commit";
  const run = runOf(flags);
  if (typeof run === "string") return run;
  const json = flags.has("--json");
  const full = flags.has("--full") ? { full: true } : {};
  const waitMs = wait.waitMs === null ? {} : { waitMs: wait.waitMs };
  return { commit, paths, json, ...full, run, ...waitMs };
}

/**
 * `--wait <ms>`, `--wait=<ms>`, or a bare `--wait` (`Infinity`), as `run
 * <group> --wait` takes it: a word after it that is not a whole number is a path.
 */
function takeAtWait(
  args: readonly string[],
): { readonly waitMs: number | null; readonly rest: readonly string[] } | string {
  const at = args.findIndex((a) => a === "--wait" || a.startsWith("--wait="));
  if (at === -1) return { waitMs: null, rest: args };
  if (args.slice(at + 1).some((a) => a === "--wait" || a.startsWith("--wait=")))
    return "--wait is given twice";
  const arg = args[at] as string;
  if (arg.startsWith("--wait=")) {
    const value = arg.slice("--wait=".length);
    if (!/^\d+$/.test(value)) return "--wait takes a whole number of milliseconds";
    return { waitMs: Number(value), rest: args.filter((_, i) => i !== at) };
  }
  const next = args[at + 1] ?? "";
  if (/^\d+$/.test(next))
    return { waitMs: Number(next), rest: args.filter((_, i) => i !== at && i !== at + 1) };
  return { waitMs: Number.POSITIVE_INFINITY, rest: args.filter((_, i) => i !== at) };
}

/** `--run` and its flags, `null` without it; a usage problem as a string. */
function runOf(flags: ReadonlySet<string>): AtRunArgs | null | string {
  const run = flags.has("--run");
  const allMissing = flags.has("--all-missing");
  if (!run && allMissing) return "--all-missing needs --run";
  return run ? { allMissing } : null;
}

/** The valued option at `args[i]`, with how many more words it took; `null` when it is none. */
function valuedOption(
  args: readonly string[],
  i: number,
): { readonly name: Valued; readonly value: string; readonly taken: 0 | 1 } | string | null {
  const arg = args[i] ?? "";
  for (const name of Object.keys(VALUED) as Valued[]) {
    if (arg === name) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) return `${name} needs ${VALUED[name]}`;
      return { name, value, taken: 1 };
    }
    if (arg.startsWith(`${name}=`)) return { name, value: arg.slice(name.length + 1), taken: 0 };
  }
  return null;
}

/** Whether `args` ask for `status --at`. */
export function asksAt(args: readonly string[]): boolean {
  return args.some((arg) => arg === "--at" || arg.startsWith("--at="));
}
/** Where the command runs: the worktree, its store, the commit and the paths. */
interface Located {
  readonly root: AbsolutePath;
  readonly commonDir: AbsolutePath;
  readonly commit: string;
  /** Relative to the root; `null` for every test file. */
  readonly paths: readonly RelativePath[] | null;
}

/** The worktree, the commit and the paths `args` name; a setup problem as a string. */
async function locate(args: AtArgs, io: CliIo): Promise<Located | string> {
  const where = worktreeOf(io);
  if (typeof where === "string") return where;
  const { cwd, root, commonDir } = where;
  let commit: string;
  try {
    commit = await resolveCommit(root, args.commit);
  } catch {
    return `"${args.commit}" names no commit here`;
  }
  // Row 023-24 (Q2): a clean tree at the commit compares HEAD with itself; nothing is keyed.
  // Row 023-29 (R2): with `--run` too, since `--run` ran both sides of HEAD against each other.
  const refusal = await headRefusal(root, commit, { ...args, run: (args.run ?? null) !== null });
  if (refusal !== null) return refusal;
  if (args.paths.length === 0) return { root, commonDir, commit, paths: null };
  const paths: RelativePath[] = [];
  for (const path of args.paths) {
    const rel = inRoot(root, cwd, path);
    if (rel === null) return `${path} lies outside ${root}`;
    paths.push(rel);
  }
  return { root, commonDir, commit, paths };
}

/** The worktree the command runs in, from the real cwd; a setup problem as a string. */
export function worktreeOf(
  io: CliIo,
): { cwd: AbsolutePath; root: AbsolutePath; commonDir: AbsolutePath } | string {
  const given = resolve(io.cwd ?? process.cwd());
  // The root is a real path (`findWorktreeRoot`); paths are read from the real cwd too.
  const cwd = (existsSync(given) ? realpathSync(given) : given) as AbsolutePath;
  const root = findWorktreeRoot(cwd);
  const commonDir = root === null ? null : resolveCommonDir(root);
  if (root === null || commonDir === null) return `${cwd} is not in a git worktree`;
  return { cwd, root, commonDir };
}

/**
 * D1: exit 0 when every file is known on both sides, 3 when one is not, 2
 * on a usage or setup error. The order: HEAD's refusal before any keying
 * (`locate`), the current side, the commit side's keys, then, with `--run`
 * or `--wait`, the daemons' part (`daemonCall`, row 023-40), else the report.
 */
export async function statusAtCommand(
  args: AtArgs,
  io: CliIo,
  options: AtOptions = {},
): Promise<number> {
  // Row 023-07 (B3): `proof`'s gate child runs through this command (`status-at-run-child.ts`).
  const request = takeRunRequest(io.env ?? process.env);
  if (request !== undefined) return runChild(request);
  const startedMs = Date.now();
  const located = await locate(args, io);
  if (typeof located === "string") {
    io.stderr(`squeal status --at: ${located}\n`);
    return 2;
  }
  const { root, commonDir, commit, paths } = located;
  const env = { ...(io.env ?? process.env) } as NodeJS.ProcessEnv;
  const nowMs = (io.now ?? Date.now)();
  const worktreeId = worktreeIdFor(root);
  const keying = { adapters: daemonAdapters, squealVersion: squealVersion(), env };
  const read = { ...keying, root, commonDir, worktreeId, paths, now: nowMs };
  const now = await withStores(commonDir, (main) => nowSide({ ...read, main }));
  if (!args.json)
    io.stderr(`squeal: keying test files at ${commit.slice(0, 9)} in a temporary checkout\n`);
  if ((args.run ?? null) !== null || (args.waitMs ?? null) !== null) {
    const place = { root, commonDir, worktreeId, commit, paths };
    return daemonCall({ args, place, read, now, env, startedMs, io, options });
  }
  const note = (text: string) => io.stderr(`squeal: ${text}\n`);
  const side = await commitRun({
    root,
    commonDir,
    worktreeId,
    commit,
    given: args.commit,
    givenPaths: args.paths,
    paths,
    run: null,
    env,
    relaunch: io.relaunch,
    note,
    forward: () => undefined,
    options,
  });
  const sides = { now: now.sources, at: side.at.sources, failed: side.at.failure !== null };
  const { refs, unmatched } = unionRefs(now.refs, side.at.refs, paths, sides, root, commit);
  // Row 023-19 (P5): the files a listing daemon does not list yet, keyed in the working tree.
  const current = await listLate(read, now, refs);
  const report = await assembleReport({ root, commit, refs, unmatched, current, side, part: null });
  io.stdout(args.json ? jsonAt(report) : formatAt(report, nowMs, args.full === true));
  // Review wave-6 B4: a checkout that gave no keys never reads as every file known.
  return side.at.failure === null && unmatched.length === 0 ? exitCode(report.files) : 3;
}

/** `path`, given from `cwd`, relative to `root` in git's form; `null` outside it. */
export function inRoot(root: AbsolutePath, cwd: AbsolutePath, path: string): RelativePath | null {
  const rel = relative(root, resolve(cwd, path));
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}
