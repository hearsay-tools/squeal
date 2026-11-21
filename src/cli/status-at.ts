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
import { workingTree } from "./status-at-both.js";
import { commitRun } from "./status-at-commit-run.js";
import { headRefusal } from "./status-at-next.js";
import { listLate, nowSide } from "./status-at-now.js";
import { unionRefs } from "./status-at-refs.js";
import { exitCode, formatAt, jsonAt } from "./status-at-report.js";
import { RUN_TIMEOUT_SECONDS, type RunArgs } from "./status-at-run.js";
import { runChild, takeRunRequest } from "./status-at-run-child.js";

/*
 * Spec 023 D1 and D3 (row 023-06): `squeal status --at <commit> [<path>...]
 * [--json]`. Each test file's result at the commit's key, the keys from the
 * gate's keyer in a temporary checkout there (`keysAtCommit`, D2 as
 * amended), beside its current state, and the comparison. It runs no test
 * and writes nothing shared. Row 023-07 (D4): with `--run`, the files with
 * no result run in that same checkout before it is removed
 * (`status-at-run.ts`), and are stored at the commit's keys.
 */

/**
 * What tests set beside the CLI's own: the checkout's place and install;
 * row 023-19, `--run`'s paths per batch (else sized from this machine).
 */
export type AtOptions = Pick<CheckoutOptions, "cacheRoot" | "install"> & {
  readonly batchFiles?: number;
};

export interface AtArgs {
  readonly commit: string;
  readonly paths: readonly string[];
  readonly json: boolean;
  /** Row 023-19 (P6): list every unknown file in the text, not by group; absent when not given. */
  readonly full?: boolean;
  /** Row 023-07: `--run [--all-missing] [--timeout <seconds>]`; absent or `null` without `--run`. */
  readonly run?: RunArgs | null;
}

/** The options that take a value, and what their value is. */
const VALUED = { "--at": "a commit", "--timeout": "whole seconds" } as const;
type Valued = keyof typeof VALUED;
const FLAGS = new Set(["--json", "--full", "--run", "--all-missing"]);

/**
 * Row 023-34 (T5, lessons round 5): `--wait` with `--at`, a problem `main`
 * prints as this one line, not with the whole help. Three round-5 sessions
 * read the help to find that `--run` is the wait.
 */
export const AT_NO_WAIT = `--at takes no --wait; --run waits up to --timeout (${RUN_TIMEOUT_SECONDS} s)`;

/** `--at <commit>` and what may follow it; a usage problem as a string. */
export function parseAt(args: readonly string[]): AtArgs | string {
  if (args.some((arg) => arg === "--wait" || arg.startsWith("--wait="))) return AT_NO_WAIT;
  const values = new Map<Valued, string>();
  const flags = new Set<string>();
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    const option = valuedOption(args, i);
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
  const run = runOf(flags, values.get("--timeout"));
  if (typeof run === "string") return run;
  const json = flags.has("--json");
  const full = flags.has("--full") ? { full: true } : {};
  return { commit, paths, json, ...full, run };
}

/** `--run` and its flags, `null` without it; a usage problem as a string. */
function runOf(flags: ReadonlySet<string>, timeout: string | undefined): RunArgs | null | string {
  const run = flags.has("--run");
  const allMissing = flags.has("--all-missing");
  if (!run && allMissing) return "--all-missing needs --run";
  if (!run && timeout !== undefined) return "--timeout needs --run";
  if (timeout !== undefined && !/^[1-9][0-9]*$/.test(timeout))
    return "--timeout takes whole seconds above 0";
  if (!run) return null;
  const timeoutSeconds = timeout === undefined ? RUN_TIMEOUT_SECONDS : Number(timeout);
  // Row 023-34 (T1): with neither `--timeout` nor `--all-missing`, a selection that cannot fit runs nothing.
  const fitCheck = !allMissing && timeout === undefined ? { fitCheck: true as const } : {};
  return { allMissing, timeoutSeconds, ...fitCheck };
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
 * (`locate`), the current side, the commit side with `--run`'s run and the
 * working tree's turn inside it (`commitRun`, whose run owns the one
 * deadline), the working tree's last pass and its read again, the report.
 */
export async function statusAtCommand(
  args: AtArgs,
  io: CliIo,
  options: AtOptions = {},
): Promise<number> {
  // Row 023-07 (B3): this process is `--run`'s child, which runs the gate and nothing else.
  const request = takeRunRequest(io.env ?? process.env);
  if (request !== undefined) return runChild(request);
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
  const run = args.run ?? null;
  // The estimate goes to stderr in both modes (D4.5); the run's own notes in text mode.
  const note = (text: string) => io.stderr(`squeal: ${text}\n`);
  const forward = (text: string) => (args.json ? undefined : io.stderr(text));
  const batch = options.batchFiles === undefined ? {} : { batchFiles: options.batchFiles };
  const relaunch = io.relaunch;
  // Row 023-29 (R1): the working tree's side, which takes its turn inside the commit side's run.
  const timeoutSeconds = run?.timeoutSeconds ?? 0;
  const tree = workingTree({ now, read, timeoutSeconds, relaunch, forward, ...batch });
  const side = await commitRun({
    root,
    commonDir,
    worktreeId,
    commit,
    given: args.commit,
    givenPaths: args.paths,
    paths,
    run,
    env,
    relaunch,
    note,
    forward,
    options,
    now: tree,
  });
  const sides = { now: now.sources, at: side.at.sources, failed: side.at.failure !== null };
  const { refs, unmatched } = unionRefs(now.refs, side.at.refs, paths, sides, root, commit);
  // Row 023-19 (P5): the files a listing daemon does not list yet, keyed in the working tree.
  const listed = await listLate(read, now, refs);
  // R1: the working tree's last pass, to the run's deadline, then its read again.
  const both = side.ran === null ? null : await tree.finish(side.ran, refs, listed);
  const current = both?.current ?? listed;
  const part = both?.part ?? null;
  const report = await assembleReport({ root, commit, refs, unmatched, current, side, part });
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
