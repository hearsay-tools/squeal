import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import {
  type PartEnd,
  type PartFile,
  type PartProject,
  type PartShard,
  type RunDescriptor,
  snapshotFields,
} from "../../core/ci/parts.js";
import { compare } from "../../core/fs/compare.js";
import type { WorktreePaths } from "../../core/fs/worktree-paths.js";
import { coreEnvironmentInputs } from "../../core/keys/environment.js";
import { describeEnvironment, sawCi } from "../../core/keys/environment-descriptor.js";
import { KEY_FORMAT_VERSION } from "../../core/keys/key-format.js";
import type { AbsolutePath, ProjectName } from "../../core/types/common.js";
import type { TestFileRef } from "../../core/types/keys.js";
import { observedInputs } from "../observe/inputs.js";
import type { RecordedFile } from "../observe/read.js";
import { RECORDER_VERSION } from "../observe/runtime.js";
import type { RecordedRun } from "./ci-record.js";
import { canonicalConfig } from "./environment.js";
import { diagnosticDuration } from "./reporter.js";
import { checkNames, compareRefs, refKey, runOutcome } from "./results.js";
import { VITEST_ADAPTER_VERSION } from "./version.js";

/*
 * Spec 018 D8 (row 018-16): the files `vitest-ci.cjs` writes, one per Vitest
 * process, and the part body each becomes. A test file's outcome follows the
 * daemon's reporter: module and suite errors fail it (task 001-360), an
 * unhandled error naming it fails it, one naming no file trusts nothing (D12).
 */

/** How `vitest-ci.cjs` writes a RegExp of a serialized config. */
const REGEXP = "squeal:regexp";

interface RawTest {
  readonly id: string;
  readonly fullName: string;
  readonly location: { readonly line: number; readonly column: number } | null;
  readonly state: string;
  readonly durationMs: number;
}

interface RawModule {
  readonly project: ProjectName;
  readonly moduleId: AbsolutePath;
  readonly state: string;
  readonly diagnostic: Parameters<typeof diagnosticDuration>[0];
  readonly errors: number;
  readonly tests: readonly RawTest[];
}

interface RawProject {
  readonly name: ProjectName;
  readonly config: Record<string, unknown>;
  readonly globalSetup: readonly AbsolutePath[];
}

/** One Vitest process's run, as `vitest-ci.cjs` wrote it at the run's end. */
export interface RawRun {
  readonly vitest: string;
  /** The run's `--shard`; `null` without one. */
  readonly shard: PartShard | null;
  readonly node: { readonly version: string; readonly platform: string; readonly arch: string };
  readonly reason: string;
  /** Per unhandled error, the test file it names, or `null`. */
  readonly unhandled: readonly (AbsolutePath | null)[];
  readonly projects: readonly RawProject[];
  readonly modules: readonly RawModule[];
  /** The allow-listed variables the process saw, with their values. */
  readonly env: Readonly<Record<string, string>>;
}

/** Each ended run in `dir`, and a note for each process that ended none. */
export function readRawRuns(dir: AbsolutePath): { runs: RawRun[]; notes: string[] } {
  const runs: RawRun[] = [];
  const notes: string[] = [];
  for (const name of readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()) {
    const pid = name.slice(0, -".json".length);
    let value: { state?: unknown; reason?: unknown };
    try {
      value = JSON.parse(readFileSync(join(dir, name), "utf8"), revive);
    } catch (error) {
      notes.push(`Vitest process ${pid}: its run file is not JSON (${String(error)}); no part`);
      continue;
    }
    if (value.state === "ended") runs.push(value as unknown as RawRun);
    else if (value.state === "failed") {
      notes.push(`Vitest process ${pid}: could not record (${String(value.reason)}); no part`);
    } else notes.push(`Vitest process ${pid} ended without the end of a run; no part`);
  }
  return { runs, notes };
}

function revive(_key: string, value: unknown): unknown {
  if (typeof value !== "object" || value === null || !Object.hasOwn(value, REGEXP)) return value;
  const text = String((value as Record<string, unknown>)[REGEXP]);
  const end = text.lastIndexOf("/");
  return new RegExp(text.slice(1, end), text.slice(end + 1));
}

interface RunContext {
  readonly paths: WorktreePaths;
  readonly env: NodeJS.ProcessEnv;
  readonly allowlist: readonly string[];
  readonly squealVersion: string;
  readonly observing: boolean;
  readonly recorded: ReadonlyMap<AbsolutePath, RecordedFile> | null;
}

/** The part body of `run`: no test file unless the run ended without a cancel or an unowned error. */
export function recordedRun(run: RawRun, context: RunContext): RecordedRun {
  const end = endOf(run);
  return {
    end,
    runnerVersion: run.vitest,
    shard: run.shard ?? { index: 1, count: 1 },
    observing: context.observing,
    projects: run.projects.map((project) => partProject(project, run, context)),
    testFiles: end === "completed" ? testFiles(run, context) : [],
  };
}

function endOf(run: RawRun): PartEnd {
  if (run.unhandled.some((path) => path === null)) return "crashed";
  return run.reason === "interrupted" ? "interrupted" : "completed";
}

/** Module states of a module that ran to its end. */
const ENDED = new Set(["passed", "failed", "skipped"]);

function testFiles(run: RawRun, context: RunContext): PartFile[] {
  const { paths } = context;
  // Every project that ran the file: an unhandled error names a path, no project.
  const named = new Set(
    run.unhandled.flatMap((path) => (path === null ? [] : [paths.toRelative(path) ?? path])),
  );
  const files: { ref: TestFileRef; file: Omit<PartFile, "observed"> }[] = [];
  for (const module of run.modules) {
    const path = paths.toRelative(module.moduleId);
    if (path === null || !ENDED.has(module.state)) continue;
    const ref = { project: module.project, path };
    files.push({ ref, file: { ...ref, ...outcomes(module, named.has(path)) } });
  }
  files.sort((a, b) => compareRefs(a.ref, b.ref));
  const observed = new Map(
    context.recorded === null
      ? []
      : observedInputs(
          context.recorded,
          files.map((f) => f.ref),
          paths,
        ).map(({ testFile, ...reads }) => [refKey(testFile), reads] as const),
  );
  return files.map(({ ref, file }) => {
    const reads = observed.get(refKey(ref));
    return reads === undefined ? file : { ...file, observed: reads };
  });
}

function outcomes(
  module: RawModule,
  namedByError: boolean,
): Pick<PartFile, "outcome" | "durationMs" | "checks" | "sharedNames"> {
  const names = checkNames(module.tests);
  const shared = sharedNames(module.tests);
  const checks = module.tests.flatMap((test) => {
    const outcome = runOutcome(test.state);
    if (outcome === undefined) return [];
    const fullName = names.get(test.id) ?? test.fullName;
    return [{ fullName, outcome, durationMs: test.durationMs, location: test.location }];
  });
  const failed =
    module.state === "failed" ||
    module.errors > 0 ||
    namedByError ||
    checks.some((check) => check.outcome === "fail");
  const outcome = failed ? "fail" : module.state === "skipped" ? "skip" : "pass";
  const durationMs = diagnosticDuration(module.diagnostic);
  return { outcome, durationMs, checks, ...(shared.length > 0 ? { sharedNames: shared } : {}) };
}

/**
 * The full names two or more of `tests` share, sorted. `checkNames` names
 * the later ones by their line, which the project's own run does not
 * collect, so the part cannot give the daemon's names (D9; review of
 * 0.1.421 B4).
 */
function sharedNames(tests: readonly RawTest[]): string[] {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const { fullName } of tests) {
    if (seen.has(fullName)) shared.add(fullName);
    seen.add(fullName);
  }
  return [...shared].sort(compare);
}

/**
 * Spec 018 D1's descriptor of `project` as the run had it: its own resolved
 * config, canonical as the daemon keys it (`canonicalConfig`), the Vitest
 * process's Node and allow-listed variables. `ci` reads the command's env.
 */
function partProject(project: RawProject, run: RawRun, context: RunContext): PartProject {
  const configured = {
    serializedConfig: project.config as unknown as TestProject["serializedConfig"],
    config: { globalSetup: [...project.globalSetup] },
  };
  const core = {
    ...coreEnvironmentInputs({
      squealVersion: context.squealVersion,
      installedDependencies: "none",
      allowlist: context.allowlist,
      env: run.env,
    }),
    nodeVersion: run.node.version,
    platform: run.node.platform,
    arch: run.node.arch,
  };
  const runner = {
    project: project.name,
    runnerName: "vitest",
    runnerVersion: run.vitest,
    // As `VitestObserver.adapterVersion` gives it; `test/runners/vitest/ci-record.test.ts` holds them equal.
    adapterVersion: context.observing
      ? `${VITEST_ADAPTER_VERSION}+observe.${RECORDER_VERSION}`
      : VITEST_ADAPTER_VERSION,
    resolvedConfig: canonicalConfig(configured, context.paths),
    files: [],
  };
  const full = describeEnvironment(KEY_FORMAT_VERSION, core, runner, [], sawCi(context.env));
  const { installedDependencies: _installed, files: _files, ...descriptor } = full;
  const snapshot = project.config.snapshotOptions as { updateSnapshot?: unknown } | undefined;
  return {
    descriptor: descriptor satisfies RunDescriptor,
    updateSnapshot: String(snapshot?.updateSnapshot ?? "unknown"),
    snapshotOptions: snapshotFields(runner.resolvedConfig),
  };
}
