import { commitEntries } from "../core/commit/at-keys-verify.js";
import { changedPaths } from "../core/commit/tree.js";
import { squealVersion } from "../core/daemon/version.js";
import { worktreeIdFor } from "../core/fs/git-layout.js";
import { testFileId } from "../core/keys/reverse-index.js";
import { type Conditions, hasConditions, NO_CONDITIONS } from "../core/proof/conditions.js";
import {
  defaultCase,
  type ProofCase,
  type Side,
  sidesOf,
  testSideCopies,
} from "../core/proof/sides.js";
import { NOT_RUN_BUDGET, proofExit, redOnAssertion } from "../core/proof/verdict.js";
import { plural } from "../core/text.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import { daemonAdapters } from "./code-gate-stored.js";
import type { CliIo } from "./main.js";
import { type ProofArgs, parseProof } from "./proof-args.js";
import { endOf, provedFiles } from "./proof-files.js";
import { dirtyPaths, locate } from "./proof-locate.js";
import { formatProof, jsonProof, type ProofReport, rerunCommand } from "./proof-report.js";
import { runSide, withSide } from "./proof-side.js";
import type { AtOptions } from "./status-at.js";

/*
 * Spec 023 D5 (row 023-08): `squeal proof <test file>... --base <commit>
 * [--case source|test] [--timeout <seconds>] [--json]`. Per named test
 * file, a red side and a green side (D5's table) over committed `HEAD`,
 * each keyed by the gate's keyer in a temporary checkout of its own after
 * a frozen install, then read from the store at that key first (D5.1):
 * the green side at `HEAD`, the red side at its code version with its
 * test version copied in (D5.2). Only a side with no usable result runs,
 * in its checkout; the green side runs only when the red side failed on
 * an assertion, the one verdict it decides.
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
  const deadline = started + args.timeoutSeconds * 1000;
  const at = await locate(args, io, deadline);
  if (typeof at === "string") return fail(at);
  const { root, base, head, paths, conditions } = at;
  const env = { ...(io.env ?? process.env) } as NodeJS.ProcessEnv;
  const note = (text: string) => io.stderr(`squeal: ${text}\n`);
  const common: Common = {
    root,
    own: worktreeIdFor(root),
    keying: { adapters: daemonAdapters, squealVersion: squealVersion(), env, ...options, note },
    relaunch: io.relaunch,
    env,
    deadline,
    forward: (text) => (args.json ? undefined : io.stderr(text)),
    conditions,
    repeat: args.repeat ?? 1,
  };
  const named = new Set(paths);
  if (!args.json)
    note(
      `proving ${plural(paths.length, "test file")} against ${base.slice(0, 9)} in temporary checkouts`,
    );
  const proved = await prove(common, args, base, head, named);
  if ("usage" in proved) return fail(proved.usage);
  // Row 023-20 (P9): a control run the budget left not started counts as not run too.
  const notRun = proved.files.filter(
    (f) =>
      f.reason === "budget" ||
      (f.control?.end.end === "unknown" && f.control.end.reason === NOT_RUN_BUDGET),
  ).length;
  const report: ProofReport = {
    ...proved,
    base,
    head,
    dirty: await dirtyPaths(root),
    timeoutSeconds: args.timeoutSeconds,
    usedMs: Math.round(performance.now() - started),
    conditions,
    repeat: common.repeat,
    notRun,
    rerun: notRun === 0 ? null : rerunCommand(args, conditions),
  };
  io.stdout(args.json ? jsonProof(report) : formatProof(report));
  return proofExit(report.files.map((f) => f.verdict));
}

type Proved = Omit<
  ProofReport,
  | "base"
  | "head"
  | "dirty"
  | "timeoutSeconds"
  | "usedMs"
  | "conditions"
  | "repeat"
  | "notRun"
  | "rerun"
>;

/**
 * D5 (the human, 2026-11-18, "A: clean checkout"): the green side is
 * keyed in a checkout at committed `HEAD` after its frozen install, as
 * the red side is at its code version; never read from the working tree.
 * Its runners there list the named files' projects. While it is open, the
 * case is decided from each file's closure there, and the red side is
 * keyed, read or run in a checkout of its own (the sides' expected trees
 * differ in every case, so they never share one). The green side runs, in
 * its checkout, only for files whose red side failed on assertions alone
 * and that it holds no result for. Row 023-20 (lessons P9): under a
 * condition, those files' red side then runs once more without the
 * conditions, in a checkout of its own, read from and written to the
 * store like any unconditioned side.
 */
async function prove(
  common: Common,
  args: ProofArgs,
  base: string,
  head: string,
  named: ReadonlySet<RelativePath>,
): Promise<Proved | { usage: string }> {
  const headEntries = await commitEntries(common.root, head);
  const greenSide = { tests: head, code: head };
  const asked = [...named].map((path) => ({ project: "", path }));
  const green = await withSide(
    {
      ...common,
      side: greenSide,
      files: asked,
      also: [],
      tests: headEntries,
      code: headEntries,
      named,
      listed: true,
    },
    async (open) => {
      const refs = open.keyed.filter((f) => "key" in f.at).map((f) => f.ref);
      if (refs.length === 0) return { kind: args.case, red: null, control: null };
      const loads = new Map(
        open.keyed.map((f) => [testFileId(f.ref), "key" in f.at ? (f.at.loads ?? []) : []]),
      );
      const kind =
        args.case ??
        (await caseOf(
          common.root,
          base,
          head,
          refs,
          (ref) => loads.get(testFileId(ref)) ?? [],
          named,
        ));
      if (typeof kind === "object") return kind;
      const red = await sideOf(common, sidesOf(kind, base, head).red, refs, named);
      // The green side decides only after a red side that failed on an assertion.
      const decided = refs.filter((ref) => redOnAssertion(endOf(red.files, ref).end));
      await open.run(decided);
      // P9: after the green side, so a short budget cuts the control run, not the verdict.
      const control =
        hasConditions(common.conditions) && decided.length > 0
          ? await sideOf(
              { ...common, conditions: NO_CONDITIONS },
              sidesOf(kind, base, head).red,
              decided,
              named,
            )
          : null;
      return { kind, red, control };
    },
  );
  const value = green.value;
  if (value !== undefined && "usage" in value) return value;
  const kind = value?.kind ?? null;
  const sides = kind === null ? null : sidesOf(kind, base, head);
  const at = { case: kind, red: sides?.red ?? null, green: greenSide };
  return {
    ...at,
    ...provedFiles(green, value?.red ?? null, value?.control ?? null, common.conditions),
  };
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

interface Common {
  readonly root: AbsolutePath;
  readonly own: ReturnType<typeof worktreeIdFor>;
  readonly keying: Parameters<typeof runSide>[0]["keying"];
  readonly relaunch: readonly string[] | undefined;
  readonly env: NodeJS.ProcessEnv;
  readonly deadline: number;
  readonly forward: (text: string) => void;
  readonly conditions: Conditions;
  readonly repeat: number;
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
