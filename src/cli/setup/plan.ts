import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadPolicy, POLICY_FILE } from "../../core/daemon/policy.js";
import { isRecord } from "../../core/fs/index.js";
import type { AbsolutePath } from "../../core/types/index.js";
import { type CodexHookTrust, readCodexTrust } from "../codex/trust.js";
import type { SeededProject } from "../node-test-seed.js";
import { PLUGIN_ID } from "../plugin-id.js";
import { BLOCK_VERSION, instructionFiles } from "./block.js";
import type { BuildOutputCandidate } from "./build-outputs.js";
import { slowCandidates } from "./candidates.js";
import { scanGates, squealLine } from "./gates.js";
import { type HarnessFact, readHarnesses } from "./harnesses.js";
import { type PytestRunner, pytestRunners } from "./pytest.js";
import { otherWorktrees, readJson, readRepoFacts } from "./repo.js";
import { nodeTestProjects, readRunners, warmupOf } from "./runners.js";
import { testFileUniverse, unselected } from "./test-globs.js";

/*
 * `squeal setup --plan [--json]`, spec 005 D3 step 2: read-only facts of one
 * worktree, and what `--check` calls outdated. The JSON is the interface the
 * setup skill reads (D3, "The skill"), so it is versioned (styleguide).
 */

export const SETUP_PLAN_SCHEMA_VERSION = 1;

export interface SetupPlan {
  readonly schemaVersion: typeof SETUP_PLAN_SCHEMA_VERSION;
  readonly root: AbsolutePath;
  readonly harnesses: readonly HarnessFact[];
  readonly runners: Runners;
  readonly config: ConfigFact;
  /** The instruction file each harness reads (D4), one entry per file they resolve to. */
  readonly instructions: readonly InstructionFile[];
  /** Each instruction file's first line naming Squeal outside the managed block (row 005-47). */
  readonly squealMentions: readonly Mention[];
  /** Gate lines of committed instruction files (D5). */
  readonly gates: readonly GateLine[];
  /** The test command where it is no gate: other files, negated or naming Squeal (D5, 005-47). */
  readonly mentions: readonly Mention[];
  readonly slow: SlowFacts;
  /**
   * Policy `vitest.exclude` (004 D7 as amended 2026-10-18, task 004-81):
   * Vitest test-file globs Squeal does not cover. Absent from older plans.
   */
  readonly excluded?: { readonly vitest: readonly string[] };
  readonly codexTrust: CodexTrust;
  readonly warmup: Warmup;
  /** One line per finding that makes `--check` exit 1. */
  readonly outdated: readonly string[];
}

export interface Runners {
  /** Vitest as 003 D7 detects it, as the daemon does (`vitestDetected`, row 005-79). */
  readonly vitest: boolean;
  /**
   * Row 005-79 (003 D7 as amended 2026-10-22): directories below the root
   * whose `package.json` lists `vitest` while `vitest` is false. Squeal loads
   * Vitest from the root only and runs none of their tests. Absent from older plans.
   */
  readonly vitestBelowRoot?: readonly string[];
  /** `config` when `squeal.config.json` declares `nodeTest`; else what `squeal init` would seed. */
  readonly nodeTest: readonly {
    readonly name: string;
    readonly cwd: string;
    readonly include: readonly string[];
    readonly source: "config" | "seed";
  }[];
  /** Row 005-80: the `node --test` scripts the config leaves out. Absent from older plans. */
  readonly nodeTestLeftOut?: NodeTestLeftOut;
  /** Spec 007 D1: `config` when `squeal.config.json` lists `pytest` projects; else what setup would seed. */
  readonly pytest?: readonly PytestRunner[];
  /** Row 005-80: each pair of `pytest` projects that select the same test files. Absent from older plans. */
  readonly pytestOverlaps?: readonly PytestOverlap[];
}

/**
 * While the config declares no node:test project, each `package.json`
 * script that runs `node --test` (003 D1): empty once it declares one.
 */
export interface NodeTestLeftOut {
  /** The seed's note on each refused script, and one per script it would take. */
  readonly notes: readonly string[];
  /** The `nodeTest` entry for each, as `squeal init` prints it: a refused one's to complete by hand. */
  readonly templates: readonly SeededProject[];
}

/** Two pytest projects that both select some test files: each runs them, once per project. */
export interface PytestOverlap {
  readonly projects: readonly [string, string];
  /** How many tracked test files both select. */
  readonly testFiles: number;
  /** How to run each once, as one clause. */
  readonly fix: string;
}

export interface ConfigFact {
  readonly path: typeof POLICY_FILE;
  readonly exists: boolean;
  readonly tracked: boolean;
  /** Another worktree's config, the main checkout's first, when this worktree has none. */
  readonly elsewhere: string | null;
  /** What `loadPolicy` reports: unknown keys, wrong types, unreadable JSON. */
  readonly problems: readonly string[];
  /** Keys specs 002 to 005 added that the repository's evidence calls for and the file lacks. */
  readonly missingKeys: readonly ("nodeTest" | "slow" | "pytest" | "vitest.exclude")[];
}

export interface InstructionFile {
  /** Worktree-relative, as a harness reads it. */
  readonly path: string;
  /** Other paths that resolve to the same file (D4: one block per file). */
  readonly aliases: readonly string[];
  readonly harnesses: readonly HarnessFact["id"][];
  readonly exists: boolean;
  readonly tracked: boolean;
  readonly block: BlockState;
}

/** D4: the managed block in a file. */
export type BlockState =
  | { readonly state: "absent" }
  | { readonly state: "current" | "outdated"; readonly version: number; readonly line: number }
  | { readonly state: "unterminated"; readonly line: number };

export interface GateLine {
  /** `<file>:<line>`, as `squeal init --gate <id>=<reword|keep>` takes it. */
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly text: string;
  /** The test command the line runs, as written. */
  readonly command: string;
  /** `null` when the line cannot be reworded in place; `reason` says why. */
  readonly proposed: string | null;
  /** Why `proposed` is `null`: inside a code block, or more than the test command runs. */
  readonly reason: string | null;
}

export interface Mention {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export interface SlowFacts {
  readonly groups: readonly SlowGroup[];
  /** Candidate npm scripts no static rule resolves to test files (`<dir>:<name> = <text>`). */
  readonly unresolvedScripts: readonly string[];
}

/** D3 "Slow tests and build-output tests": test files of one directory, one question. */
export interface SlowGroup {
  readonly dir: string;
  readonly files: readonly string[];
  /** Why each file is a candidate, deduplicated. */
  readonly reasons: readonly string[];
  /** The question's default: `false` for a node:test project no other rule agrees on. */
  readonly defaultSlow: boolean;
  /** `slow.include` (or a `slow` node:test project) already holds some of the files. */
  readonly declaredSlow: boolean;
  /** The `inputs` globs that apply to the group's files. */
  readonly declaredInputs: readonly string[];
  /**
   * Row 005-70: the build outputs the group's tests name, gitignored or
   * written by a build script, each with its evidence. Absent from older plans.
   */
  readonly buildOutputs?: readonly BuildOutputCandidate[];
  /** Row 005-70: where the group goes when excluded; `null` without build-output evidence. */
  readonly exclude?: ExcludeProposal | null;
}

/**
 * D3 step 4: each runner's `exclude` an excluded group is written to. Wave 13
 * B1: the globs select only test files that name a build output, so a yes by
 * default never drops a source test.
 */
export interface ExcludeProposal {
  /**
   * Worktree-relative, as `squeal setup --exclude` takes them: the group's
   * `<dir>/**` when every test file it selects names a build output,
   * descendants included; else each of the group's files that names one.
   */
  readonly globs: readonly string[];
  /** Each glob's targets; a node:test project's glob is relative to its `cwd`, as its `exclude` takes it. */
  readonly into: readonly (
    | { readonly runner: "vitest"; readonly glob: string }
    | { readonly runner: "nodeTest"; readonly project: string; readonly glob: string }
  )[];
  /** The group's files no glob selects: they name no build output and stay slow candidates. */
  readonly kept: readonly string[];
}

/**
 * Spec 005 D3: Codex trust of the plugin's hooks, read through `codex
 * app-server` only when `PlanOptions.codexTrust` asks and Codex is on the
 * PATH with the plugin; `command` applies it.
 */
export type CodexTrust = (
  | { readonly state: "not-checked" }
  | Exclude<CodexHookTrust, { readonly state: "unavailable" }>
  | { readonly state: "unavailable"; readonly reason: string }
) & { readonly command: string };

export interface Warmup {
  /** `store` when a daemon listed the test files; else counted from the tracked files. */
  readonly source: "store" | "config-text" | "default";
  /** One per project and test file, as the daemon runs them (row 005-80). */
  readonly testFiles: number;
  /** The distinct test-file paths among them (row 005-80). Absent from older plans. */
  readonly paths?: number;
  /** Of `testFiles`, those a warm-up would run: without a current result here. Never negative. */
  readonly withoutCurrentResult: number;
}

export interface PlanOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Read Codex trust through `codex app-server` (`readCodexTrust`); default not checked. */
  readonly codexTrust?: boolean;
}

const TRUST_COMMAND = "squeal init --harness codex --trust";

export async function buildPlan(root: AbsolutePath, options: PlanOptions): Promise<SetupPlan> {
  return (await readPlan(root, options)).plan;
}

/** The plan and the test files a `--slow` or `--input` test glob must select (row 005-40). */
export async function readPlan(
  root: AbsolutePath,
  options: PlanOptions,
): Promise<{ readonly plan: SetupPlan; readonly testFiles: readonly string[] }> {
  const facts = await readRepoFacts(root);
  const { policy, problems } = loadPolicy(root);
  const raw = readJson(join(root, POLICY_FILE));
  const nodeTest = nodeTestProjects(facts, policy, raw);
  const { projects } = nodeTest;
  const pytest = pytestRunners(facts, policy, raw, options.env);
  const runners = readRunners(facts, nodeTest, pytest);
  const exists = existsSync(join(root, POLICY_FILE));
  const slow = await slowCandidates(facts, policy, runners);
  const config: ConfigFact = {
    path: POLICY_FILE,
    exists,
    tracked: facts.tracked.includes(POLICY_FILE),
    elsewhere: exists ? null : await configElsewhere(root),
    problems,
    missingKeys: [
      ...(exists && runners.nodeTest.some((p) => p.source === "seed") ? ["nodeTest" as const] : []),
      // Row 005-70: an exclude candidate's default is the runner's `exclude`, not `slow`;
      // B1: the files it keeps are still slow candidates.
      ...(exists &&
      !(isRecord(raw) && "slow" in raw) &&
      slow.groups.some((g) => g.defaultSlow && (g.exclude?.kept.length ?? 1) > 0)
        ? ["slow" as const]
        : []),
      // Spec 007 D1: only an absent key; init's default `pytest: []` is seeded over, not reported.
      ...(exists && !(isRecord(raw) && "pytest" in raw) && pytest.some((p) => p.source === "seed")
        ? ["pytest" as const]
        : []),
      // Row 005-70: an exclude candidate for Vitest not kept slow, and no `vitest.exclude`.
      ...(exists &&
      !(isRecord(raw) && isRecord(raw.vitest) && "exclude" in raw.vitest) &&
      slow.groups.some(
        (g) => !g.declaredSlow && g.exclude?.into.some((i) => i.runner === "vitest") === true,
      )
        ? ["vitest.exclude" as const]
        : []),
    ],
  };
  const instructions = instructionFiles(root, facts.tracked);
  const { gates, mentions } = scanGates(root, facts.tracked, {
    nodeTest: runners.nodeTest.length > 0,
  });
  const harnesses = readHarnesses(root, options.env);
  const universe = testFileUniverse(facts, [...projects, ...pytest]);
  const plan: SetupPlan = {
    schemaVersion: SETUP_PLAN_SCHEMA_VERSION,
    root,
    harnesses,
    runners,
    config,
    instructions,
    squealMentions: instructions.flatMap((f) => squealLine(root, f.path) ?? []),
    gates,
    mentions,
    slow,
    excluded: { vitest: policy.vitest.exclude },
    codexTrust: await codexTrust(root, harnesses, options),
    warmup: warmupOf(facts, runners, [...projects, ...pytest]),
    outdated: [...outdated(config, instructions), ...unselected(policy, universe)],
  };
  return { plan, testFiles: universe };
}

async function codexTrust(
  root: AbsolutePath,
  harnesses: readonly HarnessFact[],
  options: PlanOptions,
): Promise<CodexTrust> {
  const codex = harnesses.find((h) => h.id === "codex");
  if (options.codexTrust !== true || codex?.onPath !== true || codex.plugin === null) {
    return { state: "not-checked", command: TRUST_COMMAND };
  }
  return { ...(await readCodexTrust(root, options.env, PLUGIN_ID)), command: TRUST_COMMAND };
}

async function configElsewhere(root: AbsolutePath): Promise<string | null> {
  for (const other of await otherWorktrees(root)) {
    if (existsSync(join(other, POLICY_FILE))) return join(other, POLICY_FILE);
  }
  return null;
}

function outdated(config: ConfigFact, instructions: readonly InstructionFile[]): string[] {
  const lines: string[] = [];
  // An unusable config is something to fix, like an outdated one (review 005-13 S1).
  for (const problem of config.problems) lines.push(`${POLICY_FILE}: ${problem}`);
  if (!config.exists) {
    lines.push(
      config.elsewhere === null
        ? `${POLICY_FILE} is missing: worktrees run on defaults`
        : `${POLICY_FILE} is only in ${config.elsewhere}: this worktree runs on defaults`,
    );
  } else if (!config.tracked) {
    lines.push(`${POLICY_FILE} is not tracked by git: other worktrees run on defaults`);
  }
  for (const key of config.missingKeys) lines.push(`${POLICY_FILE} has no "${key}" key`);
  for (const { path, block } of instructions) {
    if (block.state === "outdated") {
      lines.push(`${path}: the Squeal block is v${block.version}, older than v${BLOCK_VERSION}`);
    } else if (block.state === "unterminated") {
      lines.push(`${path}:${block.line}: a Squeal block begins with no end; fix it by hand`);
    }
  }
  return lines;
}
