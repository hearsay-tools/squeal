import { describe, expect, it } from "vitest";
import { bindWalks } from "../../src/core/scheduler/fresh-walks.js";
import type { RunnerClosure, RunnerEnvironment } from "../../src/core/types/runner.js";

/* Row 015-119: the walks of a runner part that may be bound to a key. */

const closure = (path: string): RunnerClosure => ({
  testFile: { project: "", path },
  paths: [path],
  imports: [],
});

const environment = (project: string, files: string[], walked: string[]): RunnerEnvironment => ({
  project,
  runnerName: "vitest",
  runnerVersion: "5",
  adapterVersion: "1",
  resolvedConfig: "{}",
  files,
  imports: walked.map((path) => ({ path, sha1: "s", static: [], dynamic: [] })),
});

describe("bindWalks (015-119)", () => {
  const a = closure("test/a.test.ts");
  const b = closure("test/b.test.ts");
  const gone = closure("test/gone.test.ts");

  it("carries a resolved test file whose closure a revision changed meanwhile, and binds the others' walks", () => {
    const part = { closures: [a, b, gone], environments: null };
    const bound = bindWalks(part, [a.testFile, b.testFile], new Set([b.testFile.path]));
    expect(bound.stale).toEqual([b.testFile]);
    expect(bound.walks.closures).toEqual([a]);
    expect(bound.walks.environments).toBeNull();
  });

  it("leaves out an environment read or walked from a file a revision changed meanwhile", () => {
    const listed = environment("unit", ["test/setup.ts"], []);
    const walked = environment("e2e", ["vitest.config.ts"], ["src/reporter.ts"]);
    const quiet = environment("other", ["other.config.ts"], ["src/other.ts"]);
    const changed = new Set(["test/setup.ts", "src/reporter.ts"]);
    const part = { closures: [], environments: [listed, walked, quiet] };
    expect(bindWalks(part, [], changed).walks.environments).toEqual([quiet]);
  });
});
