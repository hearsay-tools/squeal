import { describe, expect, it } from "vitest";
import { freshWalks } from "../../src/core/scheduler/fresh-walks.js";
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

describe("freshWalks (015-119)", () => {
  const a = closure("test/a.test.ts");
  const b = closure("test/b.test.ts");
  const gone = closure("test/gone.test.ts");

  it("keeps the closures of resolved test files the scheduler did not carry as changed meanwhile", () => {
    const walks = freshWalks([a, b, gone], null, [a.testFile, b.testFile], [b.testFile], new Set());
    expect(walks.closures).toEqual([a]);
    expect(walks.environments).toBeNull();
  });

  it("leaves out an environment read or walked from a file a revision changed meanwhile", () => {
    const listed = environment("unit", ["test/setup.ts"], []);
    const walked = environment("e2e", ["vitest.config.ts"], ["src/reporter.ts"]);
    const quiet = environment("other", ["other.config.ts"], ["src/other.ts"]);
    const changed = new Set(["test/setup.ts", "src/reporter.ts"]);
    expect(freshWalks([], [listed, walked, quiet], [], [], changed).environments).toEqual([quiet]);
  });
});
