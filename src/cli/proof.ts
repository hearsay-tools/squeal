import { resolveCommit, withStores } from "../core/commit/at-keys-checkout.js";
import { commitEntries } from "../core/commit/at-keys-verify.js";
import { changedPaths } from "../core/commit/tree.js";
import { squealVersion } from "../core/daemon/version.js";
import { runGit, splitNul } from "../core/fs/git.js";
import { worktreeIdFor } from "../core/fs/git-layout.js";
import { testFileId } from "../core/keys/reverse-index.js";
import {
  defaultCase,
  type ProofCase,
  type Side,
  sidesOf,
  testSideCopies,
} from "../core/proof/sides.js";
import { proofExit, redOnAssertion, verdictOf } from "../core/proof/verdict.js";
import { plural } from "../core/text.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import { daemonAdapters } from "./code-gate-stored.js";
import type { CliIo } from "./main.js";
import { type ProofArgs, parseProof } from "./proof-args.js";
import { formatProof, jsonProof, type ProofFile } from "./proof-report.js";
import { runSide, type SideFile } from "./proof-side.js";
import { type AtOptions, inRoot, worktreeOf } from "./status-at.js";
import { type NowSide, nowSide } from "./status-at-now.js";

/*
 * Spec 023 D5 (row 023-08): `squeal proof <test file>... --base <commit>
 * [--case source|test] [--timeout <seconds>] [--json]`. Per named test
 * file, a red side and a green side (D5's table) over committed `HEAD`,
 * each read from the store first (D5.1): the green side as `status --at`
 * reads the current side, the red side keyed in a temporary checkout at
 * its code version with its test version copied in (D5.2). Only a side
 * with no usable result runs, in that checkout; the green side runs only
 * when the red side failed on an assertion, the one verdict it decides.
 * Verdicts and exit codes are D5.5's and D5.6's (`core/proof/verdict.ts`).
 */

export { parseProof };

/** Exit 0 when every file is proven, 1 not red or not green, 3 unknown, 2 on a usage error. */
export async function proofCommand(
  args: ProofArgs,
  io: CliIo,
  options: AtOptions = {},
): Promise<number> {
  const started = performance.now();
  const fail = (text: string) => {
    io.stderr(`squeal proof: ${text}\n`);
    return 2;
  };
  const at = await locate(args, io);
  if (typeof at === "string") return fail(at);
  const { root, commonDir, base, head, paths } = at;
  const own = worktreeIdFor(root);
  const env = { ...(io.env ?? process.env) } as NodeJS.ProcessEnv;
  const keying = { adapters: daemonAdapters, squealVersion: squealVersion(), env, ...options };
  const now = await greenNow(root, commonDir, own, paths, keying, (io.now ?? Date.now)());
  const refs = namedRefs(now, paths);
  const named = new Set(paths);
  const loads = (ref: TestFileRef) => now.loads(ref) ?? [];
  const dirty = await dirtyLoads(root, refs, loads);
  const kind = args.case ?? (await caseOf(root, base, head, refs, loads, named));
  if (typeof kind === "object") return fail(kind.usage);
  const sides = sidesOf(kind, base, head);
  const note = (text: string) => io.stderr(`squeal: ${text}\n`);
  const common: Common = {
    root,
    own,
    keying: { ...keying, note },
    relaunch: io.relaunch,
    env,
    deadline: started + args.timeoutSeconds * 1000,
    forward: (text) => (args.json ? undefined : io.stderr(text)),
  };
  if (!args.json) note(`proving ${plural(refs.length, "test file")} against ${base.slice(0, 9)}`);
  const red = await sideOf(common, sides.red, refs, named);
  // The green side decides only after a red side that failed on an assertion.
  const deciding = refs.filter((ref) => redOnAssertion(endOf(red.files, ref).end));
  const green = await greenSide(
    common,
    sides.green,
    deciding,
    named,
    dirty.length > 0 ? null : now,
  );
  const files: ProofFile[] = refs.map((ref) => {
    const redSide = endOf(red.files, ref);
    const greenSide = green.files.get(testFileId(ref)) ?? null;
    const { verdict, reason } = verdictOf(redSide.end, greenSide?.end ?? null);
    return { ref, verdict, reason, red: redSide, green: greenSide };
  });
  const report = {
    case: kind,
    base,
    head,
    red: sides.red,
    green: sides.green,
    dirty,
    timeoutSeconds: args.timeoutSeconds,
    usedMs: Math.round(performance.now() - started),
    runs: red.ran + green.ran,
    files,
  };
  io.stdout(args.json ? jsonProof(report) : formatProof(report));
  return proofExit(files.map((f) => f.verdict));
}

interface Located {
  readonly root: AbsolutePath;
  readonly commonDir: AbsolutePath;
  readonly base: string;
  readonly head: string;
  /** The named files, relative to the root. */
  readonly paths: readonly RelativePath[];
}

/** The worktree, both commits and the named files; a setup problem as a string. */
async function locate(args: ProofArgs, io: CliIo): Promise<Located | string> {
  const where = worktreeOf(io);
  if (typeof where === "string") return where;
  const { cwd, root, commonDir } = where;
  const commit = async (name: string, problem: string) => {
    try {
      return await resolveCommit(root, name);
    } catch {
      return { problem };
    }
  };
  const base = await commit(args.base, `"${args.base}" names no commit here`);
  if (typeof base !== "string") return base.problem;
  const head = await commit("HEAD", "HEAD names no commit: commit the test first");
  if (typeof head !== "string") return head.problem;
  const paths: RelativePath[] = [];
  for (const file of args.files) {
    const rel = inRoot(root, cwd, file);
    if (rel === null) return `${file} lies outside ${root}`;
    paths.push(rel);
  }
  return { root, commonDir, base, head, paths };
}

/**
 * The green side of `refs`: read as `status --at` reads the current side
 * when `now` is given (the working tree holds `HEAD` on every path the
 * named tests load); else, and for a file with no result now, keyed and
 * run in a checkout at `HEAD`.
 */
async function greenSide(
  common: Common,
  side: Side,
  refs: readonly TestFileRef[],
  named: ReadonlySet<RelativePath>,
  now: NowSide | null,
): Promise<{ files: ReadonlyMap<string, SideFile>; ran: number }> {
  const files = new Map<string, SideFile>();
  const toRun: TestFileRef[] = [];
  for (const ref of refs) {
    const read = now === null ? null : greenOf(now, ref);
    if (read === null) toRun.push(ref);
    else files.set(testFileId(ref), read);
  }
  if (toRun.length === 0) return { files, ran: 0 };
  const ran = await sideOf(common, side, toRun, named);
  for (const [id, file] of ran.files) files.set(id, file);
  return { files, ran: ran.ran };
}

type Keying = Parameters<typeof nowSide>[0]["adapters"] extends infer A
  ? { adapters: A; squealVersion: string; env: NodeJS.ProcessEnv } & AtOptions
  : never;

/** The current side of the named files, keyed in the working tree when the daemon's closures are not this worktree's. */
async function greenNow(
  root: AbsolutePath,
  commonDir: AbsolutePath,
  worktreeId: ReturnType<typeof worktreeIdFor>,
  paths: readonly RelativePath[],
  keying: Keying,
  nowMs: number,
): Promise<NowSide> {
  const input = { ...keying, root, commonDir, worktreeId, paths, now: nowMs };
  const now = await withStores(commonDir, (main) => nowSide({ ...input, main }));
  if (now.refs.every((ref) => now.loads(ref) !== undefined)) return now;
  return withStores(commonDir, (main) => nowSide({ ...input, main, keyed: true }));
}

/** The named files as listed now; a path no runner lists now is a file of the default project. */
function namedRefs(now: NowSide, paths: readonly RelativePath[]): TestFileRef[] {
  const refs = new Map(now.refs.map((ref) => [testFileId(ref), ref]));
  for (const path of paths) {
    if (![...refs.values()].some((ref) => ref.path === path))
      refs.set(testFileId({ project: "", path }), { project: "", path });
  }
  return [...refs.values()];
}

/**
 * D5's default case: one for every named file, from the diff `base..HEAD`
 * and each file's closure now; a usage problem when the files need
 * different ones, or one needs neither.
 */
async function caseOf(
  root: AbsolutePath,
  base: string,
  head: string,
  refs: readonly TestFileRef[],
  loads: (ref: TestFileRef) => readonly RelativePath[],
  named: ReadonlySet<RelativePath>,
): Promise<ProofCase | { usage: string }> {
  const changed = await changedPaths(root, base, head);
  const cases = new Map<RelativePath, ProofCase | null>();
  for (const ref of refs) cases.set(ref.path, defaultCase(ref.path, loads(ref), changed, named));
  const none = [...cases].filter(([, kind]) => kind === null).map(([path]) => path);
  if (none.length > 0)
    return {
      usage: `${base.slice(0, 9)}..HEAD changes nothing ${none.join(", ")} loads; give --case source or --case test`,
    };
  const kinds = new Set(cases.values());
  if (kinds.size > 1) {
    const each = [...cases].map(([path, kind]) => `${path}: ${kind}`).join(", ");
    return {
      usage: `the named files need different cases (${each}); give --case or prove them in separate calls`,
    };
  }
  return [...kinds][0] as ProofCase;
}

/**
 * The paths a named test loads (and the test itself) that the working
 * tree holds otherwise than `HEAD`: changed, staged, deleted or untracked.
 */
async function dirtyLoads(
  root: AbsolutePath,
  refs: readonly TestFileRef[],
  loads: (ref: TestFileRef) => readonly RelativePath[],
): Promise<RelativePath[]> {
  const changed = await runGit(root, ["diff", "--name-only", "--no-renames", "-z", "HEAD", "--"]);
  const untracked = await runGit(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const differs = new Set([...splitNul(changed), ...splitNul(untracked)]);
  const loaded = new Set(refs.flatMap((ref) => [ref.path, ...loads(ref)]));
  return [...loaded].filter((path) => differs.has(path)).sort();
}

interface Common {
  readonly root: AbsolutePath;
  readonly own: ReturnType<typeof worktreeIdFor>;
  readonly keying: Parameters<typeof runSide>[0]["keying"];
  readonly relaunch: readonly string[] | undefined;
  readonly env: NodeJS.ProcessEnv;
  readonly deadline: number;
  readonly forward: (text: string) => void;
}

/** One side of `refs` in its checkout: D5.2's copies are the test-side files the versions hold otherwise. */
async function sideOf(
  common: Common,
  side: Side,
  refs: readonly TestFileRef[],
  named: ReadonlySet<RelativePath>,
) {
  const tests = await commitEntries(common.root, side.tests);
  const code = await commitEntries(common.root, side.code);
  const also = side.tests === side.code ? [] : testSideCopies(tests, code, named);
  return runSide({ ...common, side, files: refs, also, tests, code, named });
}

function endOf(files: ReadonlyMap<string, SideFile>, ref: TestFileRef): SideFile {
  return (
    files.get(testFileId(ref)) ?? {
      end: { end: "unknown", reason: "not keyed" },
      from: null,
      stored: false,
      notStored: null,
    }
  );
}

/** The green side read as `status --at` reads the current side; `null` when it must run. */
function greenOf(now: NowSide, ref: TestFileRef): SideFile | null {
  const state = now.state(ref);
  const from = now.source.kind === "daemon" ? "daemon" : "store";
  if (state.state === "pass") return { end: { end: "pass" }, from, stored: true, notStored: null };
  if (state.state === "fail") {
    const failures = state.failed.map((test) => ({ test, errors: [] }));
    return { end: { end: "fail", failures }, from, stored: true, notStored: null };
  }
  return null;
}
