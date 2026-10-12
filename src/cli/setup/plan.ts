import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadPolicy, POLICY_FILE } from "../../core/daemon/policy.js";
import { isRecord } from "../../core/fs/index.js";
import type { AbsolutePath, Policy } from "../../core/types/index.js";
import { seedNodeTest } from "../node-test-seed.js";
import { type HarnessFact, readHarnesses } from "./harnesses.js";
import { otherWorktrees, type RepoFacts, readJson, readRepoFacts } from "./repo.js";

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
  /** Gate lines of committed instruction files (D5). */
  readonly gates: readonly GateLine[];
  /** The test command in other files, such as skills: listed, never offered as edits (D5). */
  readonly mentions: readonly Mention[];
  readonly slow: SlowFacts;
  readonly codexTrust: CodexTrust;
  readonly warmup: Warmup;
  /** One line per finding that makes `--check` exit 1. */
  readonly outdated: readonly string[];
}

export interface Runners {
  /** `vitest` in a manifest's dependencies, or a Vitest config at the root. */
  readonly vitest: boolean;
  /** `config` when `squeal.config.json` declares `nodeTest`; else what `squeal init` would seed. */
  readonly nodeTest: readonly {
    readonly name: string;
    readonly cwd: string;
    readonly include: readonly string[];
    readonly source: "config" | "seed";
  }[];
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
  readonly missingKeys: readonly ("nodeTest" | "slow")[];
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
  /** `null` when the line cannot be reworded in place (inside a code block). */
  readonly proposed: string | null;
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

/** D3 "Slow tests and their inputs": test files of one directory, one question. */
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
  /** Directories the group may test, each with its evidence, never ranked. */
  readonly artifacts: readonly ArtifactCandidate[];
  /** The candidate every other one lies under, the default answer; `null` for siblings. */
  readonly broader: string | null;
  /** Some declared input lies in or over a candidate. */
  readonly inputsHoldArtifact: boolean;
}

export interface ArtifactCandidate {
  readonly path: string;
  readonly exists: boolean;
  readonly ignored: boolean;
  readonly evidence: readonly Evidence[];
}

export interface Evidence {
  readonly rule: "bin" | "main" | "module" | "exports" | "files" | "build-script" | "named";
  readonly detail: string;
  /** D3 leads from 005-04: `files` lists sources beside artifacts. */
  readonly weak: boolean;
}

/** Spec 005 D3: Codex trust; reading it needs `codex app-server`, which the plan never starts. */
export interface CodexTrust {
  readonly state: "not-checked";
  readonly command: string;
}

export interface Warmup {
  /** `store` when a daemon listed the test files; else counted from the tracked files. */
  readonly source: "store" | "config-text" | "default";
  readonly testFiles: number;
  /** Test files a warm-up would run: those without a current result here. */
  readonly withoutCurrentResult: number;
}

export interface PlanOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
}

export async function buildPlan(root: AbsolutePath, options: PlanOptions): Promise<SetupPlan> {
  const facts = await readRepoFacts(root);
  const { policy, problems } = loadPolicy(root);
  const raw = readJson(join(root, POLICY_FILE));
  const runners = readRunners(facts, policy, raw);
  const exists = existsSync(join(root, POLICY_FILE));
  const config: ConfigFact = {
    path: POLICY_FILE,
    exists,
    tracked: facts.tracked.includes(POLICY_FILE),
    elsewhere: exists ? null : await configElsewhere(root),
    problems,
    missingKeys: exists && runners.nodeTest.some((p) => p.source === "seed") ? ["nodeTest"] : [],
  };
  const { testFiles } = facts;
  return {
    schemaVersion: SETUP_PLAN_SCHEMA_VERSION,
    root,
    harnesses: readHarnesses(root, options.env),
    runners,
    config,
    instructions: [],
    gates: [],
    mentions: [],
    slow: { groups: [], unresolvedScripts: [] },
    codexTrust: { state: "not-checked", command: "squeal init --harness codex --trust" },
    warmup: {
      source: testFiles.source,
      testFiles: testFiles.paths.length,
      withoutCurrentResult: testFiles.paths.length - (testFiles.current ?? 0),
    },
    outdated: outdated(config),
  };
}

function readRunners(facts: RepoFacts, policy: Policy, raw: unknown): Runners {
  const deps = (value: unknown) => (isRecord(value) ? Object.keys(value) : []);
  const vitest =
    facts.manifests.some((m) =>
      [...deps(m.value.dependencies), ...deps(m.value.devDependencies)].includes("vitest"),
    ) || facts.tracked.some((path) => /^vite(st)?\.config\.[cm]?[jt]s$/.test(path));
  const declared = isRecord(raw) && "nodeTest" in raw;
  const projects = declared
    ? policy.nodeTest.map((p) => ({ ...p, source: "config" as const }))
    : seeded(facts.root).map((p) => ({ ...p, source: "seed" as const }));
  return {
    vitest,
    nodeTest: projects.map((p) => ({
      name: p.name,
      cwd: p.cwd ?? "",
      include: p.include,
      source: p.source,
    })),
  };
}

/** What `squeal init` would seed; none when a manifest cannot be read, as init then reports. */
function seeded(root: AbsolutePath) {
  try {
    return seedNodeTest(root).projects;
  } catch {
    return [];
  }
}

async function configElsewhere(root: AbsolutePath): Promise<string | null> {
  for (const other of await otherWorktrees(root)) {
    if (existsSync(join(other, POLICY_FILE))) return join(other, POLICY_FILE);
  }
  return null;
}

function outdated(config: ConfigFact): string[] {
  const lines: string[] = [];
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
  return lines;
}
