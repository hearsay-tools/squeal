import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { type CheckoutHooks, resolveCommit, withStores } from "../core/commit/at-keys-checkout.js";
import type { CheckoutOptions } from "../core/commit/at-keys-walk.js";
import { squealVersion } from "../core/daemon/version.js";
import { readHead } from "../core/daemon-loop/head.js";
import { runGit } from "../core/fs/git.js";
import { findWorktreeRoot, resolveCommonDir, worktreeIdFor } from "../core/fs/git-layout.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import { daemonAdapters } from "./code-gate-stored.js";
import type { CliIo } from "./main.js";
import { workingTree } from "./status-at-both.js";
import { commitSide } from "./status-at-commit.js";
import { headRefusal, nextOf, nextProbe } from "./status-at-next.js";
import { listLate, nowSide } from "./status-at-now.js";
import { unionRefs } from "./status-at-refs.js";
import { type AtReport, compareSides, exitCode, formatAt, jsonAt } from "./status-at-report.js";
import {
  type AtRun,
  type AtRunInput,
  atRun,
  RUN_TIMEOUT_SECONDS,
  type RunArgs,
} from "./status-at-run.js";
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

/** The checkout's own install budget (row 023-16), when `--run`'s is longer. */
const INSTALL_TIMEOUT_MS = 300_000;

/**
 * What tests set beside the CLI's own: the checkout's place and install;
 * row 023-19, `--run`'s paths per batch (else sized from this machine).
 */
export type AtOptions = Pick<CheckoutOptions, "cacheRoot" | "install"> & {
  readonly batchFiles?: number;
  /** Tests of the commit side's run only: `false` keeps `--run` off the working tree (R1). */
  readonly workingTree?: false;
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

/** `--at <commit>` and what may follow it; a usage problem as a string. */
export function parseAt(args: readonly string[]): AtArgs | string {
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
  const run = flags.has("--run");
  const allMissing = flags.has("--all-missing");
  const timeout = values.get("--timeout");
  if (!run && allMissing) return "--all-missing needs --run";
  if (!run && timeout !== undefined) return "--timeout needs --run";
  if (timeout !== undefined && !/^[1-9][0-9]*$/.test(timeout))
    return "--timeout takes whole seconds above 0";
  const timeoutSeconds = timeout === undefined ? RUN_TIMEOUT_SECONDS : Number(timeout);
  const json = flags.has("--json");
  const full = flags.has("--full") ? { full: true } : {};
  return { commit, paths, json, ...full, run: run ? { allMissing, timeoutSeconds } : null };
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

/** D1: exit 0 when every file is known on both sides, 3 when one is not, 2 on a usage or setup error. */
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
  const input = { ...keying, root, commonDir, worktreeId, paths, now: nowMs };
  const now = await withStores(commonDir, (main) => nowSide({ ...input, main }));
  if (!args.json)
    io.stderr(`squeal: keying test files at ${commit.slice(0, 9)} in a temporary checkout\n`);
  const note = (text: string) => io.stderr(`squeal: ${text}\n`);
  const runArgs = args.run ?? null;
  const { batchFiles, workingTree: onTree, ...checkoutOptions } = options;
  const forward = (text: string) => (args.json ? undefined : io.stderr(text));
  const batch = batchFiles === undefined ? {} : { batchFiles };
  // Row 023-29 (R1): the working tree's side, which takes its turn inside the commit side's run.
  const tree = workingTree({
    now,
    read: input,
    timeoutSeconds: runArgs?.timeoutSeconds ?? 0,
    relaunch: io.relaunch,
    forward,
    ...batch,
  });
  const ran = startRun(args, runArgs, {
    root,
    commonDir,
    own: worktreeId,
    commit,
    env,
    relaunch: io.relaunch,
    // The estimate goes to stderr in both modes (D4.5); the run's own notes in text mode.
    note,
    forward,
    ...batch,
    ...(onTree === false ? {} : { now: tree }),
  });
  // Row 023-24 (Q1): without `--run`, what it would run, for the report's last line.
  const probe =
    ran === null ? nextProbe({ root, commit, given: args.commit, paths: args.paths }) : null;
  const at = await commitSide({
    ...keying,
    ...checkoutOptions,
    root,
    commit,
    paths,
    worktreeId,
    note,
    ...hooksOf(ran, probe, runArgs),
  });
  const state = ran === null ? at.state : (ref: TestFileRef) => ran.state(ref, at.state(ref));
  const sides = { now: now.sources, at: at.sources, failed: at.failure !== null };
  const { refs, unmatched } = unionRefs(now.refs, at.refs, paths, sides, root, commit);
  // Row 023-19 (P5): the files a listing daemon does not list yet, keyed in the working tree.
  const listed = await listLate(input, now, refs);
  // Row 023-29 (R1): `--run` fills the working tree's side too, then reads it again.
  const both = ran === null || onTree === false ? null : await tree.finish(ran, refs, listed);
  const current = both?.current ?? listed;
  const files = compareSides(refs, state, current.state);
  const head = await readHead(root);
  const report: AtReport = {
    commit,
    commitTimeMs: await commitTime(root, commit),
    head: head.head,
    dirty: head.dirty,
    now: current.source,
    checkoutMs: at.checkoutMs,
    inputCheckMs: at.inputCheckMs,
    changed: at.changed,
    failure: at.failure,
    files,
    ...(unmatched.length === 0 ? {} : { unmatched }),
    ...(ran === null ? {} : { run: ran.use(both?.part) }),
    ...nextOf(probe, at),
  };
  io.stdout(args.json ? jsonAt(report) : formatAt(report, nowMs, args.full === true));
  // Review wave-6 B4: a checkout that gave no keys never reads as every file known.
  return at.failure === null && unmatched.length === 0 ? exitCode(files) : 3;
}

/** D4: `--run`'s hooks for the commit's checkout, its budget from now; `null` without `--run`. */
function startRun(
  args: AtArgs,
  runArgs: RunArgs | null,
  base: Omit<AtRunInput, "args" | "given" | "paths" | "started">,
): AtRun | null {
  if (runArgs === null) return null;
  const started = performance.now();
  return atRun({ ...base, args: runArgs, given: args.commit, paths: args.paths, started });
}

/** The checkout's hooks: `--run`'s, with its install inside the one budget (D4.6), or Q1's probe. */
function hooksOf(
  ran: AtRun | null,
  probe: ReturnType<typeof nextProbe> | null,
  runArgs: RunArgs | null,
): Pick<CheckoutOptions, "installTimeoutMs"> & CheckoutHooks {
  if (ran === null) return probe === null ? {} : { whileOpen: probe.whileOpen };
  return {
    whileOpen: ran.whileOpen,
    beforeRemove: ran.beforeRemove,
    installTimeoutMs: Math.min(INSTALL_TIMEOUT_MS, (runArgs?.timeoutSeconds ?? 0) * 1000),
  };
}

/** `path`, given from `cwd`, relative to `root` in git's form; `null` outside it. */
export function inRoot(root: AbsolutePath, cwd: AbsolutePath, path: string): RelativePath | null {
  const rel = relative(root, resolve(cwd, path));
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

async function commitTime(root: AbsolutePath, commit: string): Promise<number> {
  const out = await runGit(root, ["show", "-s", "--format=%ct", commit]);
  return Number(out.trim()) * 1000;
}
