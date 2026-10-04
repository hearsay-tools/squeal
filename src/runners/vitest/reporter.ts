import type { Reporter, SerializedError, TestCase, TestModule } from "vitest/node";
import type { CheckRunResult, TestFileRef } from "../../core/types/index.js";
import type { WorktreePaths } from "./paths.js";
import { refKey, toCheckRunResult } from "./results.js";

type TestRunEndReason = Parameters<NonNullable<Reporter["onTestRunEnd"]>>[2];

/** How one test module of the run ended, as `onTestModuleEnd` reported it. */
export interface ModuleEnd {
  readonly ref: TestFileRef;
  readonly state: ReturnType<TestModule["state"]>;
  /** Errors outside any test case: import, syntax, `beforeAll`/`afterAll` at file level. */
  readonly errors: readonly SerializedError[];
  /** Ended after a timeout cancel was requested: its results are not trusted. */
  readonly afterCancel: boolean;
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
  readonly #requested: Map<string, TestFileRef>;

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
    const result = toCheckRunResult(testCase, ref, this.paths);
    if (!result) return;
    this.results.push({ ref, result });
    this.log.push(
      `${result.outcome.toUpperCase()} ${label(ref)} > ${result.check.fullName} (${Math.round(result.durationMs)} ms)`,
    );
    for (const error of testCase.result().errors ?? []) this.log.push(indent(errorText(error)));
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

  console(type: string, content: string): void {
    this.log.push(`[${type}] ${content.replace(/\n$/, "")}`);
  }
}

/**
 * The Squeal reporter. It forwards to the collector of the run in progress;
 * hooks firing outside a `run` call (none are expected) are dropped.
 */
export function createSquealReporter(current: () => RunCollector | null): Reporter {
  return {
    onTestCaseResult: (testCase) => current()?.testCase(testCase),
    onTestModuleEnd: (module) => current()?.moduleEnd(module),
    onTestRunEnd: (_modules, unhandledErrors, reason) => current()?.runEnd(unhandledErrors, reason),
    onUserConsoleLog: (log) => current()?.console(log.type, log.content),
  };
}

const label = (ref: TestFileRef) => (ref.project ? `[${ref.project}] ${ref.path}` : ref.path);

const indent = (text: string) => text.replace(/^/gm, "    ");

function errorText(error: SerializedError): string {
  const diff = typeof error.diff === "string" ? `\n${error.diff}` : "";
  return `${error.stack ?? `${error.name ?? "Error"}: ${error.message}`}${diff}`;
}
