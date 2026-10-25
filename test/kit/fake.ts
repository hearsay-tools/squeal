import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AbsolutePath,
  AffectedTestFiles,
  CheckRunResult,
  FileLevelError,
  ObservedInputs,
  RunnerAdapter,
  RunOptions,
  RunReport,
  Store,
  TestFileRef,
} from "../../src/core/types/index.js";
import type { Gap, Pack } from "./driver.js";
import { isTest, type Module } from "./scenarios/index.js";

/*
 * A pack whose runner is this file, to prove the driver's verdicts without
 * a real one (spec 016 D1). Modules are their own JSON; a test file's
 * check passes when the value its import chain reaches equals `expect`.
 * `stale` keeps the first text each module had, as a cache that misses
 * edits would: a gap every scenario with an edit meets. A held file passes
 * its first check, writes its marker and holds until its run is aborted;
 * it does not complete. What a computed import or a child process loads is
 * outside the static closure: a run reports it among `observed`, and keeps
 * the child's loads as `direct` marks, in the store as a daemon's injected
 * one would, or in memory.
 */

export interface FakeOptions {
  readonly stale?: boolean;
  /** The first run crashes before any test starts (review 0.1.303 B2's probe). */
  readonly crashFirst?: boolean;
  readonly known?: Readonly<Record<string, Gap>>;
  /** Where a child's loads are kept as `direct` marks; default the store. */
  readonly marks?: "store" | "memory";
  /** `false`: a run reports nothing it observed. */
  readonly observes?: false;
}

type Held = Extract<Module, { kind: "held" }>;
type Tested = Extract<Module, { kind: "test" | "computed" | "spawns" }> | Held;

/** The meta key of the fake's `direct` marks: test file to paths. */
const MARKS = "kit.fake.direct";

/** Resolves when `signal` aborts. */
function aborted(signal: AbortSignal | undefined): Promise<void> {
  if (signal === undefined) throw new Error("a held file runs only with a signal to cut it");
  if (signal.aborted) return Promise.resolve();
  return new Promise((done) => signal.addEventListener("abort", () => done(), { once: true }));
}

const PROJECT = "fake";
const modulePath = (name: string) => `m/${name}.json`;

function parse(text: string): Module | null {
  try {
    return JSON.parse(text) as Module;
  } catch {
    return null;
  }
}

class FakeAdapter implements RunnerAdapter {
  readonly name = "fake";
  readonly adapterVersion = "1";
  private readonly seen = new Map<string, string>();
  private runs = 0;
  private remembered: Record<string, string[]> = {};

  constructor(
    private readonly root: AbsolutePath,
    private readonly options: FakeOptions,
    private readonly store: Store,
  ) {}

  private get marks(): Record<string, string[]> {
    if (this.options.marks === "memory") return this.remembered;
    return JSON.parse(this.store.meta.get(MARKS) ?? "{}") as Record<string, string[]>;
  }

  private mark(testFile: string, paths: readonly string[]): void {
    const marks = { ...this.marks, [testFile]: [...paths] };
    if (this.options.marks === "memory") this.remembered = marks;
    else this.store.meta.set(MARKS, JSON.stringify(marks));
  }

  private read(path: string): string {
    const kept = this.seen.get(path);
    if (this.options.stale === true && kept !== undefined) return kept;
    const text = readFileSync(join(this.root, path), "utf8");
    this.seen.set(path, text);
    return text;
  }

  /**
   * The paths from `path` down its imports, and the value they reach;
   * `null` when one fails to load. `paths` are the static ones; `observed`
   * those after a computed import or a child process's start.
   */
  private follow(path: string): { paths: string[]; observed: string[]; value: number | null } {
    const paths: string[] = [];
    const observed: string[] = [];
    for (let at = path, runtime = false; ; ) {
      (runtime ? observed : paths).push(at);
      const module = parse(this.read(at));
      if (module === null || module.kind === "broken") return { paths, observed, value: null };
      if (module.kind === "value") return { paths, observed, value: module.value };
      if (module.kind === "held") return { paths, observed, value: null };
      if (module.kind === "hook" || module.kind === "dependency" || module.kind === "absent") {
        throw new Error(`the fake pack renders no ${module.kind} module`);
      }
      runtime ||= module.kind === "computed" || module.kind === "spawns";
      at = modulePath(module.kind === "spawns" ? module.child : module.from);
    }
  }

  private testOf(file: TestFileRef): Tested {
    const module = parse(this.read(file.path));
    if (module === null || !isTest(module)) throw new Error(`${file.path} is no test module`);
    return module;
  }

  /** Passes the held file's first check, writes its marker and holds until the run is aborted. */
  private async hold(file: TestFileRef, held: Held, signal?: AbortSignal): Promise<CheckRunResult> {
    writeFileSync(join(this.root, `${held.holds}.started`), "");
    await aborted(signal);
    return passed(file, held.check);
  }

  async invalidate() {
    return { recreatedProjects: [] };
  }

  async affected(changed: readonly string[]): Promise<AffectedTestFiles> {
    const direct: TestFileRef[] = [];
    const transitive: TestFileRef[] = [];
    const marks = this.marks;
    for (const file of await this.testFiles()) {
      const { paths } = this.follow(file.path);
      const at = paths.findIndex((p) => changed.includes(p));
      const marked = (marks[file.path] ?? []).some((p) => changed.includes(p));
      if (at === 0 || at === 1 || marked) direct.push(file);
      else if (at > 1) transitive.push(file);
    }
    return { direct, transitive };
  }

  async closure(testFile: TestFileRef) {
    return { testFile, paths: this.follow(testFile.path).paths };
  }

  async enumerate() {
    return [];
  }

  async testFiles(): Promise<TestFileRef[]> {
    return readdirSync(join(this.root, "t"))
      .sort()
      .map((name) => ({ project: PROJECT, path: `t/${name}` }));
  }

  async environment() {
    return [];
  }

  async run(testFiles: readonly TestFileRef[], options?: RunOptions): Promise<RunReport> {
    const report = { durationMs: 0, completedFiles: [], results: [], fileErrors: [] };
    if (this.options.crashFirst === true && this.runs++ === 0) {
      return { ...report, end: "crashed", failure: "the fake crashed before any test started" };
    }
    const results: CheckRunResult[] = [];
    const fileErrors: FileLevelError[] = [];
    const completedFiles: TestFileRef[] = [];
    const observed: ObservedInputs[] = [];
    let failure: string | null = null;
    for (const file of testFiles) {
      const test = this.testOf(file);
      if (test.kind === "held") {
        // The check that passed before the cut is reported, but its file did not complete.
        results.push(await this.hold(file, test, options?.signal));
        failure = `run cancelled: ${String(options?.signal?.reason)}`;
        continue;
      }
      completedFiles.push(file);
      const { observed: loaded, value } = this.follow(file.path);
      if (loaded.length > 0 && this.options.observes !== false) {
        observed.push({ testFile: file, paths: loaded, directories: [] });
      }
      if (test.kind === "spawns") this.mark(file.path, loaded);
      if (value === null) {
        const error = { name: "SyntaxError", message: "a module failed to load" };
        fileErrors.push({
          testFile: file,
          errors: [{ ...error, stack: null, location: null, diff: null }],
        });
        continue;
      }
      results.push(
        value === test.expect
          ? passed(file, test.check)
          : { ...passed(file, test.check), outcome: "fail" },
      );
    }
    return { ...report, end: "completed", completedFiles, results, fileErrors, failure, observed };
  }

  async close() {}
}

function passed(file: TestFileRef, check: string): CheckRunResult {
  return {
    check: { kind: "test", project: PROJECT, testPath: file.path, fullName: check },
    outcome: "pass",
    durationMs: 0,
    location: null,
    errors: [],
  };
}

export function fakePack(options: FakeOptions = {}): Pack {
  return {
    name: "fake",
    path: (name, module) => (isTest(module) ? `t/${name}.json` : modulePath(name)),
    text: (module) => (module.kind === "broken" ? "{\n" : `${JSON.stringify(module)}\n`),
    fullName: (check) => check,
    project: {},
    open: async (root, _scratch, { store }) => new FakeAdapter(root, options, store),
    ...(options.known === undefined ? {} : { known: options.known }),
  };
}
