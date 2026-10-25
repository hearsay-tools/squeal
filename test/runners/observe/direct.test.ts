import { describe, expect, it } from "vitest";
import { observe, VITEST_STATE } from "./helpers.js";

/*
 * Spec 016 D4, goal 6 (row 016-22): what a process the test file started
 * imported puts the file in `direct`. The recorder marks a started
 * process's module loads and entry point; its file reads, the test's own
 * process and the threads that process starts mark nothing.
 */
describe("observe recorder: a started process's imports (016 D4, row 016-22)", {
  timeout: 60_000,
}, () => {
  const files = {
    "child.mjs": [
      'import { readFileSync } from "node:fs";',
      'import { execFileSync } from "node:child_process";',
      'import "./dep.mjs";',
      'readFileSync("child-data.txt");',
      'execFileSync(process.execPath, ["grandchild.cjs"]);',
    ].join("\n"),
    "dep.mjs": "export {};\n",
    "grandchild.cjs": 'require("./deep.cjs");\n',
    "deep.cjs": "",
    "child-data.txt": "c",
    "own.mjs": "export {};\n",
    "worker.mjs": 'import "./thread-dep.mjs";\n',
    "thread-dep.mjs": "export {};\n",
    "data.txt": "d",
  };
  const main = (first = "") =>
    [
      first,
      'import { execFileSync } from "node:child_process";',
      'import { readFileSync } from "node:fs";',
      'import { Worker } from "node:worker_threads";',
      'await import("./own.mjs");',
      'readFileSync("data.txt");',
      'execFileSync(process.execPath, ["child.mjs"]);',
      'const w = new Worker(new URL("./worker.mjs", import.meta.url));',
      'await new Promise((done) => w.once("exit", done));',
    ].join("\n");
  const started = ["child.mjs", "deep.cjs", "dep.mjs", "grandchild.cjs"];

  it("marks a child's and a grandchild's entry points and imports, and nothing they or the test read", () => {
    const seen = observe({ ...files, "main.mjs": main() });
    expect(seen.direct).toEqual(started);
    expect(seen.paths).toEqual(
      expect.arrayContaining(["child-data.txt", "data.txt", "own.mjs", "thread-dep.mjs"]),
    );
    expect(seen.inputs).toEqual([expect.objectContaining({ direct: started })]);
  });

  it("marks the same in a Vitest worker, whose own loads and threads stay unmarked", () => {
    const seen = observe({ ...files, "main.mjs": main(VITEST_STATE) }, "main.mjs", {
      viaVitest: true,
    });
    expect(seen.direct).toEqual(started);
  });

  it("reports no direct paths for a run that started no process", () => {
    const seen = observe({ "main.mjs": 'import "./own.mjs";\n', "own.mjs": "export {};\n" });
    expect(seen.direct).toEqual([]);
    expect(seen.inputs).toEqual([
      {
        testFile: { project: "", path: "test.ts" },
        paths: ["main.mjs", "own.mjs"],
        directories: [],
      },
    ]);
  });
});
