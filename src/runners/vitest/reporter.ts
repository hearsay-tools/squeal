import { appendFileSync } from "node:fs";
import type { Reporter, SerializedError, TestCase, TestModule, Vitest } from "vitest/node";
import { consolePrefix, testFileLabel } from "../../core/run-log.js";
import type { AbsolutePath, CheckRunResult, TestFileRef } from "../../core/types/index.js";
import type { WorktreePaths } from "./paths.js";
import { checkNames, refKey, toCheckRunResult } from "./results.js";

type TestRunEndReason = Parameters<NonNullable<Reporter["onTestRunEnd"]>>[2];

/** How one test module of the run ended, as `onTestModuleEnd` reported it. */
export interface ModuleEnd {
  readonly ref: TestFileRef;
  readonly state: ReturnType<TestModule["state"]>;
  /** Errors outside any test case: import, syntax, `beforeAll`/`afterAll` at file level. */
  readonly errors: readonly SerializedError[];
  /** Ended after a timeout cancel was requested: its results are not trusted. */
  readonly afterCancel: boolean;
  /** The module's own duration (`moduleDuration`), `null` when Vitest reports none. */
  readonly durationMs: number | null;
}

/**
 * Everything the reporter hooks said about one `run` call, and nothing else.
 *
 * Spec 001 D4: "Results come only from the reporter hooks `onTestCaseResult`,
 * `onTestModuleEnd` and `onTestRunEnd`, never from the cumulative
 * `TestRunResult`, which includes stale modules." Modules that were not
 * requested are ignored too.
 */
export class RunCollector {
  readonly results: { readonly ref: TestFileRef; readonly result: CheckRunResult }[] = [];
  readonly modules = new Map<string, ModuleEnd>();
  readonly unhandledErrors: SerializedError[] = [];
  /** Raw output for the run log, absolute paths kept. */
  readonly log: string[] = [];
  reason: TestRunEndReason | null = null;
  cancelRequested = false;
  /** Set once `vitest.log` is written; later notes are appended to it. */
  logFile: AbsolutePath | null = null;
  readonly #requested: Map<string, TestFileRef>;
  readonly #names = new WeakMap<TestModule, Map<string, string>>();

  constructor(
    requested: readonly TestFileRef[],
    readonly paths: WorktreePaths,
  ) {
    this.#requested = new Map(requested.map((r) => [refKey(r), r]));
  }

  #ref(project: string, moduleId: string): TestFileRef | null {
    const path = this.paths.toRelative(moduleId);
    return path === null ? null : (this.#requested.get(refKey({ project, path })) ?? null);
  }

  testCase(testCase: TestCase): void {
    const ref = this.#ref(testCase.project.name, testCase.module.moduleId);
    if (!ref) return;
    const result = toCheckRunResult(testCase, ref, this.paths, this.#name(testCase));
    if (!result) return;
    this.results.push({ ref, result });
    this.log.push(
      `${result.outcome.toUpperCase()} ${label(ref)} > ${result.check.fullName} (${Math.round(result.durationMs)} ms)`,
    );
    for (const error of testCase.result().errors ?? []) this.log.push(indent(errorText(error)));
  }

  /** The check name of a test; modules are fully collected before their tests report. */
  #name(testCase: TestCase): string {
    let names = this.#names.get(testCase.module);
    if (!names) {
      names = checkNames(testCase.module.children.allTests());
      this.#names.set(testCase.module, names);
    }
    return names.get(testCase.id) ?? testCase.fullName;
  }

  moduleEnd(module: TestModule): void {
    const ref = this.#ref(module.project.name, module.moduleId);
    if (!ref) return;
    const errors = module.errors();
    this.modules.set(refKey(ref), {
      ref,
      state: module.state(),
      errors,
      afterCancel: this.cancelRequested,
      durationMs: moduleDuration(module),
    });
    this.log.push(`MODULE ${module.state()} ${label(ref)}`);
    for (const error of errors) this.log.push(indent(`file-level error: ${errorText(error)}`));
  }

  runEnd(unhandledErrors: readonly SerializedError[], reason: TestRunEndReason): void {
    this.unhandledErrors.push(...unhandledErrors);
    this.reason = reason;
    this.log.push(`RUN END ${reason}, ${unhandledErrors.length} unhandled error(s)`);
    for (const error of unhandledErrors) this.log.push(indent(`unhandled: ${errorText(error)}`));
  }

  /**
   * An adapter event for the run log, such as an error from cancelling the
   * run or closing an instance. The styleguide: "Never swallow an error
   * silently" (review N3).
   */
  note(text: string): void {
    const line = `squeal: ${text}`;
    if (this.logFile === null) {
      this.log.push(line);
      return;
    }
    try {
      appendFileSync(this.logFile, `${line}\n`);
    } catch (error) {
      process.emitWarning(`${line} (run log ${this.logFile} not writable: ${String(error)})`);
    }
  }

  /**
   * One `console` output, every line tagged with the requested test file
   * that wrote it (`module`), so `squeal why --include-logs` can keep that
   * file's lines (task 001-173).
   */
  console(type: string, content: string, module: TestModule | null): void {
    const ref = module === null ? null : this.#ref(module.project.name, module.moduleId);
    const prefix = consolePrefix(type, ref === null ? null : label(ref));
    for (const line of content.replace(/\n$/, "").split("\n")) this.log.push(`${prefix}${line}`);
  }
}

/**
 * The Squeal reporter. It forwards to the collector of the run in progress;
 * hooks firing outside a `run` call (none are expected) are dropped.
 */
export function createSquealReporter(current: () => RunCollector | null): Reporter {
  let vitest: Vitest | null = null;
  const moduleOf = (taskId: string | undefined): TestModule | null => {
    const entity = taskId === undefined ? undefined : vitest?.state.getReportedEntityById(taskId);
    if (entity === undefined) return null;
    return entity.type === "module" ? entity : entity.module;
  };
  return {
    onInit: (instance) => {
      vitest = instance;
    },
    onTestCaseResult: (testCase) => current()?.testCase(testCase),
    onTestModuleEnd: (module) => current()?.moduleEnd(module),
    onTestRunEnd: (_modules, unhandledErrors, reason) => current()?.runEnd(unhandledErrors, reason),
    onUserConsoleLog: (log) => current()?.console(log.type, log.content, moduleOf(log.taskId)),
  };
}

/**
 * Environment setup, preparation, collection, setup files, and every test and
 * hook of the module: what running this file alone costs (review wave 4.5,
 * N1). `null` when Vitest has no diagnostic for it or a part is not a number.
 */
function moduleDuration(module: TestModule): number | null {
  const d = module.diagnostic();
  const parts = [
    d.environmentSetupDuration,
    d.prepareDuration,
    d.collectDuration,
    d.setupDuration,
    d.duration,
  ];
  return parts.every((part) => Number.isFinite(part)) ? parts.reduce((a, b) => a + b, 0) : null;
}

const label = (ref: TestFileRef) => testFileLabel(ref.project, ref.path);

const indent = (text: string) => text.replace(/^/gm, "    ");

/** One error as the run log prints it: the stack (or name and message), then the diff. */
export function errorText(error: SerializedError): string {
  const diff = typeof error.diff === "string" ? `\n${error.diff}` : "";
  return `${error.stack ?? `${error.name ?? "Error"}: ${error.message}`}${diff}`;
}
