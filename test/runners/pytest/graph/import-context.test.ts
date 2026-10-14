import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  AbsolutePath,
  PytestProject,
  RelativePath,
} from "../../../../src/core/types/index.js";
import { readEnvironment } from "../../../../src/runners/pytest/environment/index.js";
import { createPytestGraph } from "../../../../src/runners/pytest/graph/index.js";
import { runPytest } from "../../../../src/runners/pytest/run/run.js";
import { requireSynced, type Synced, syncFixture } from "../../../helpers/pytest-env.js";
import { FIXTURES } from "./helpers.js";

/*
 * Review 007-16 B2: under `prepend` each test file's basedir goes to the
 * front of `sys.path` as pytest imports it, and the first `import helper`
 * of a process is cached for the rest. So `tests/a/test_a.py` imports
 * `tests/a/helper.py` alone and `tests/b/helper.py` after `test_b.py` in
 * one batch: its static closure must hold every origin a batch can give,
 * and an edit to either must select it.
 */

const SLOW = { timeout: 120_000 } as const;
/** Removing a synced fixture copy, `.venv` and all, under a loaded suite. */
const CLEANUP_MS = 60_000;
const A = "tests/a/test_a.py";
const B = "tests/b/test_b.py";
const PROJECT: PytestProject = {
  name: "small",
  args: [],
  env: {},
  include: ["tests/**/test_*.py"],
};
const FILES: Readonly<Record<string, string>> = {
  "tests/a/helper.py": 'VALUE = "a"\n',
  "tests/b/helper.py": 'VALUE = "b"\n',
  [A]: "import helper\n\ndef test_a():\n    assert helper.VALUE in ('a', 'b')\n",
  [B]: "import helper\n\ndef test_b():\n    assert helper.VALUE in ('a', 'b')\n",
};

let synced: Synced = { ok: false, reason: "the sync did not run" };
let scratch = "";
beforeAll(() => {
  synced = syncFixture(join(FIXTURES, "small"), "3.13");
  if (synced.ok) {
    for (const [path, text] of Object.entries(FILES)) {
      mkdirSync(dirname(join(synced.env.root, path)), { recursive: true });
      writeFileSync(join(synced.env.root, path), text);
    }
  }
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-pytest-context-")));
}, 300_000);
afterAll(() => {
  if (synced.ok) synced.env.cleanup();
  if (scratch !== "") rmSync(scratch, { recursive: true, force: true });
}, CLEANUP_MS);

describe("closures under each test file's import context (spec 007 D4, review 007-16 B2)", () => {
  it.for([{ testFiles: [A, B] }, { testFiles: [B, A] }])(
    "holds both helpers and selects on either, files listed $testFiles",
    SLOW,
    async ({ testFiles }, ctx) => {
      const fixture = requireSynced(ctx, synced);
      const root = realpathSync(fixture.root) as AbsolutePath;
      const graph = await createPytestGraph({
        root,
        cwd: root,
        env: join(root, ".venv"),
        testFiles,
      });
      for (const file of [A, B]) {
        const closure = graph.closure(file);
        expect(closure.complete, file).toBe(true);
        expect(closure.paths, file).toEqual(
          expect.arrayContaining(["tests/a/helper.py", "tests/b/helper.py"]),
        );
      }
      expect(graph.affected(["tests/a/helper.py"]).direct).toEqual([A, B]);
      expect(graph.affected(["tests/b/helper.py"]).direct).toEqual([A, B]);
    },
  );

  it.for([
    { files: [A], batchSize: 1 },
    { files: [B], batchSize: 1 },
    { files: [A, B], batchSize: 1 },
    { files: [A, B], batchSize: 2 },
    { files: [B, A], batchSize: 2 },
  ])(
    "has every module a run of $files in batches of $batchSize observed in the static closure",
    SLOW,
    async ({ files, batchSize }, ctx) => {
      const fixture = requireSynced(ctx, synced);
      const root = realpathSync(fixture.root) as AbsolutePath;
      const graph = await createPytestGraph({
        root,
        cwd: root,
        env: join(root, ".venv"),
        testFiles: [A, B],
      });
      const environment = await readEnvironment(root, PROJECT, fixture.env);
      if (environment.state !== "ready") throw new Error(`environment: ${environment.state}`);
      const run = await runPytest({
        root,
        project: PROJECT,
        environment,
        files: files.map((path) => ({ project: "small", path })),
        logDir: join(scratch, `logs-${files.join("+")}-${batchSize}`) as AbsolutePath,
        timeoutMs: 60_000,
        batchSize,
        cacheDir: join(scratch, "cache") as AbsolutePath,
      });
      expect(run.report.completedFiles.map((f) => f.path)).toEqual(files);
      expect(run.observed.map((o) => o.testFile.path)).toEqual(files);
      const helper = (file: string | undefined) => `${dirname(file ?? "")}/helper.py`;
      for (const observed of run.observed) {
        // Alone or first, a file imports its own helper; second, the first file's cached one.
        const first = batchSize === 1 || observed.testFile.path === files[0];
        expect(observed.paths, observed.testFile.path).toContain(
          helper(first ? observed.testFile.path : files[0]),
        );
        const outside = observed.paths.filter(
          (path: RelativePath) => !graph.closure(observed.testFile.path).paths.includes(path),
        );
        expect(outside, observed.testFile.path).toEqual([]);
      }
    },
  );
});
