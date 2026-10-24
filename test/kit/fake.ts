import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AbsolutePath,
  AffectedTestFiles,
  CheckRunResult,
  FileLevelError,
  RunnerAdapter,
  RunReport,
  TestFileRef,
} from "../../src/core/types/index.js";
import type { Pack } from "./driver.js";
import { isTest, type Module } from "./scenarios/index.js";

/*
 * A pack whose runner is this file, to prove the driver's verdicts without
 * a real one (spec 016 D1). Modules are their own JSON; a test file's
 * check passes when the value its import chain reaches equals `expect`.
 * `stale` keeps the first text each module had, as a cache that misses
 * edits would: a gap every scenario with an edit meets.
 */

export interface FakeOptions {
  readonly stale?: boolean;
  readonly known?: Readonly<Record<string, string>>;
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

  constructor(
    private readonly root: AbsolutePath,
    private readonly stale: boolean,
  ) {}

  private read(path: string): string {
    const kept = this.seen.get(path);
    if (this.stale && kept !== undefined) return kept;
    const text = readFileSync(join(this.root, path), "utf8");
    this.seen.set(path, text);
    return text;
  }

  /** The paths from `path` down its imports, and the value they reach; `null` when one fails to load. */
  private follow(path: string): { paths: string[]; value: number | null } {
    const paths: string[] = [];
    for (let at = path; ; ) {
      paths.push(at);
      const module = parse(this.read(at));
      if (module === null || module.kind === "broken") return { paths, value: null };
      if (module.kind === "value") return { paths, value: module.value };
      at = modulePath(module.from);
    }
  }

  private testOf(file: TestFileRef): Extract<Module, { kind: "test" }> {
    const module = parse(this.read(file.path));
    if (module === null || !isTest(module)) throw new Error(`${file.path} is no test module`);
    return module;
  }

  async invalidate() {
    return { recreatedProjects: [] };
  }

  async affected(changed: readonly string[]): Promise<AffectedTestFiles> {
    const direct: TestFileRef[] = [];
    const transitive: TestFileRef[] = [];
    for (const file of await this.testFiles()) {
      const { paths } = this.follow(file.path);
      const at = paths.findIndex((p) => changed.includes(p));
      if (at === 0 || at === 1) direct.push(file);
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

  async run(testFiles: readonly TestFileRef[]): Promise<RunReport> {
    const results: CheckRunResult[] = [];
    const fileErrors: FileLevelError[] = [];
    for (const file of testFiles) {
      const test = this.testOf(file);
      const { value } = this.follow(file.path);
      if (value === null) {
        const error = { name: "SyntaxError", message: "a module failed to load" };
        fileErrors.push({
          testFile: file,
          errors: [{ ...error, stack: null, location: null, diff: null }],
        });
        continue;
      }
      results.push({
        check: { kind: "test", project: PROJECT, testPath: file.path, fullName: test.check },
        outcome: value === test.expect ? "pass" : "fail",
        durationMs: 0,
        location: null,
        errors: [],
      });
    }
    const end = "completed";
    return { end, durationMs: 0, completedFiles: testFiles, results, fileErrors, failure: null };
  }

  async close() {}
}

export function fakePack(options: FakeOptions = {}): Pack {
  return {
    name: "fake",
    path: (name, module) => (isTest(module) ? `t/${name}.json` : modulePath(name)),
    text: (module) => (module.kind === "broken" ? "{\n" : `${JSON.stringify(module)}\n`),
    fullName: (check) => check,
    project: {},
    open: async (root) => new FakeAdapter(root, options.stale === true),
    ...(options.known === undefined ? {} : { known: options.known }),
  };
}
