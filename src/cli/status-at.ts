import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { keysAtCommit } from "../core/commit/at-keys.js";
import { resolveCommit, withStores } from "../core/commit/at-keys-checkout.js";
import type { CheckoutOptions } from "../core/commit/at-keys-walk.js";
import { squealVersion } from "../core/daemon/version.js";
import { readHead } from "../core/daemon-loop/head.js";
import { runGit } from "../core/fs/git.js";
import { findWorktreeRoot, resolveCommonDir, worktreeIdFor } from "../core/fs/git-layout.js";
import { testFileId } from "../core/keys/reverse-index.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import { daemonAdapters } from "./code-gate-stored.js";
import type { CliIo } from "./main.js";
import { nowSide } from "./status-at-now.js";
import {
  type AtReport,
  commitState,
  compareSides,
  exitCode,
  formatAt,
  jsonAt,
} from "./status-at-report.js";

/*
 * Spec 023 D1 and D3 (row 023-06): `squeal status --at <commit> [<path>...]
 * [--json]`, without `--run` (row 023-07). Each test file's result at the
 * commit's key, the keys from the gate's keyer in a temporary checkout
 * there (`keysAtCommit`, D2 as amended), beside its current state, and the
 * comparison. It runs no test and writes nothing shared.
 */

/** What tests set beside the CLI's own: the checkout's place and install. */
export type AtOptions = Pick<CheckoutOptions, "cacheRoot" | "install">;

export interface AtArgs {
  readonly commit: string;
  readonly paths: readonly string[];
  readonly json: boolean;
}

/** `--at <commit>` and what may follow it; a usage problem as a string. */
export function parseAt(args: readonly string[]): AtArgs | string {
  let commit: string | null = null;
  let json = false;
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--at") {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) return "--at needs a commit";
      if (commit !== null) return "--at is given twice";
      commit = value;
      i++;
    } else if (arg.startsWith("--at=")) {
      if (commit !== null) return "--at is given twice";
      commit = arg.slice("--at=".length);
      if (commit === "") return "--at needs a commit";
    } else if (arg === "--json") json = true;
    else if (arg === "--run") return "--run is not available yet";
    else if (arg.startsWith("--")) return `unknown option "${arg}" with --at`;
    else paths.push(arg);
  }
  if (commit === null) return "--at needs a commit";
  return { commit, paths, json };
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
  const given = resolve(io.cwd ?? process.cwd());
  // The root is a real path (`findWorktreeRoot`); paths are read from the real cwd too.
  const cwd = (existsSync(given) ? realpathSync(given) : given) as AbsolutePath;
  const root = findWorktreeRoot(cwd);
  const commonDir = root === null ? null : resolveCommonDir(root);
  if (root === null || commonDir === null) return `${cwd} is not in a git worktree`;
  let commit: string;
  try {
    commit = await resolveCommit(root, args.commit);
  } catch {
    return `"${args.commit}" names no commit here`;
  }
  if (args.paths.length === 0) return { root, commonDir, commit, paths: null };
  const paths: RelativePath[] = [];
  for (const path of args.paths) {
    const rel = inRoot(root, cwd, path);
    if (rel === null) return `${path} lies outside ${root}`;
    paths.push(rel);
  }
  return { root, commonDir, commit, paths };
}

/** D1: exit 0 when every file is known on both sides, 3 when one is not, 2 on a usage or setup error. */
export async function statusAtCommand(
  args: AtArgs,
  io: CliIo,
  options: AtOptions = {},
): Promise<number> {
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
  const at = await keysAtCommit({
    ...keying,
    ...options,
    root,
    commit,
    // A path that selects nothing now is still asked at the commit, which may list it.
    ...(paths === null ? {} : { files: now.refs }),
    note: (text) => io.stderr(`squeal: ${text}\n`),
  });
  const files = compareSides(
    unionRefs(now.refs, paths === null ? at.files.keys() : []),
    (ref) => commitState(at.files.get(testFileId(ref)), worktreeId),
    now.state,
  );
  const head = await readHead(root);
  const report: AtReport = {
    commit,
    commitTimeMs: await commitTime(root, commit),
    head: head.head,
    dirty: head.dirty,
    now: now.source,
    checkoutMs: at.checkoutMs,
    failure: at.failure === null ? null : `${at.failure.reason}: ${at.failure.detail}`,
    files,
  };
  io.stdout(args.json ? jsonAt(report) : formatAt(report, nowMs));
  return exitCode(files);
}

/** `refs`, and each file the commit side lists that they lack, by its `testFileId`. */
function unionRefs(refs: readonly TestFileRef[], atIds: Iterable<string>): TestFileRef[] {
  const all = new Map(refs.map((ref) => [testFileId(ref), ref]));
  for (const id of atIds) {
    const [project = "", path = ""] = id.split("\0");
    if (!all.has(id)) all.set(id, { project, path });
  }
  return [...all.values()];
}

/** `path`, given from `cwd`, relative to `root` in git's form; `null` outside it. */
function inRoot(root: AbsolutePath, cwd: AbsolutePath, path: string): RelativePath | null {
  const rel = relative(root, resolve(cwd, path));
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

async function commitTime(root: AbsolutePath, commit: string): Promise<number> {
  const out = await runGit(root, ["show", "-s", "--format=%ct", commit]);
  return Number(out.trim()) * 1000;
}
