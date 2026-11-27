import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import { readHead } from "../../../src/core/daemon-loop/head.js";
import { createFsHasher } from "../../../src/core/hash/hasher.js";
import { testFileId } from "../../../src/core/keys/reverse-index.js";
import { statCandidates } from "../../../src/core/revision/reconcile.js";
import type { WorktreeKeys } from "../../../src/core/scheduler/keying.js";
import { observedGrowth } from "../../../src/core/scheduler/observed.js";
import { recordsForFile } from "../../../src/core/scheduler/records.js";
import { describeFailure } from "../../../src/core/state/fingerprint.js";
import type {
  AbsolutePath,
  EpochMs,
  RelativePath,
  WorktreeId,
} from "../../../src/core/types/common.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { JestProject } from "../../../src/core/types/policy-jest.js";
import type { RunReport } from "../../../src/core/types/runner.js";
import type { Store } from "../../../src/core/types/store.js";
import { createJestAdapter } from "../../../src/runners/jest/index.js";
import { installJest, JEST_MAJORS, type JestMajor } from "../../helpers/jest-env.js";
import { initRepository, OpenWorktree } from "../../kit/worktrees.js";

/*
 * Spec 028 Testing, D3.2 (row 028-06b) on real Jest 29.7.0 and 30.5.2: a
 * type-checking transform, as `ts-jest` is, reads each test file's `.d.ts`
 * with `fs.readFileSync` in the batch process, outside Jest's module
 * registry. `recorder.cjs` names the test file Jest is running from
 * `Symbol.for("squeal.currentTestFile")`, so in one batch of two files each
 * `.d.ts` keys only the file whose transform read it, and its edit re-keys
 * and re-runs only that file while the other's stored pass stays current
 * (review 0.1.646 N1). The fixture has no `ts-jest`: the transform here reads
 * the file a `// @types` comment names, in its cache key and its `process`,
 * and fails the file as a type error when the declarations say `broken`.
 */

const PROJECT: JestProject = {
  name: "app",
  config: "jest.config.js",
  include: [],
  exclude: [],
  args: [],
  env: {},
};

const lines = (...text: string[]) => `${text.join("\n")}\n`;

const TYPES_TRANSFORM = lines(
  'const crypto = require("crypto");',
  'const fs = require("fs");',
  'const path = require("path");',
  "/** The declarations a `// @types <path>` comment names, read as a type checker reads them. */",
  "function declarations(sourceText, sourcePath) {",
  "  const named = /\\/\\/ @types (\\S+)/.exec(sourceText);",
  '  return named === null ? "" : fs.readFileSync(path.resolve(path.dirname(sourcePath), named[1]), "utf8");',
  "}",
  "module.exports = {",
  "  getCacheKey(sourceText, sourcePath) {",
  "    const types = declarations(sourceText, sourcePath);",
  '    return crypto.createHash("sha1").update(sourcePath).update(sourceText).update(types).digest("hex");',
  "  },",
  "  process(sourceText, sourcePath) {",
  '    if (declarations(sourceText, sourcePath).includes("broken")) {',
  '      throw new Error("type error: " + path.basename(sourcePath) + " does not match its declarations");',
  "    }",
  "    return { code: sourceText };",
  "  },",
  "};",
);

const FILES: Readonly<Record<string, string>> = {
  "package.json": `{ "name": "app", "private": true }\n`,
  "jest.config.js": lines(
    "module.exports = {",
    '  testEnvironment: "node",',
    '  testMatch: ["<rootDir>/test/**/*.test.js"],',
    '  transform: { "\\\\.js$": "<rootDir>/transform/types.js" },',
    "};",
  ),
  "transform/types.js": TYPES_TRANSFORM,
  "types/a.d.ts": "export declare const a: number;\n",
  "types/b.d.ts": "export declare const b: number;\n",
  "test/a.test.js": lines("// @types ../types/a.d.ts", 'test("a", () => expect(1).toBe(1));'),
  "test/b.test.js": lines("// @types ../types/b.d.ts", 'test("b", () => expect(2).toBe(2));'),
};

const A = ref("test/a.test.js");
const B = ref("test/b.test.js");
const SLOW = { timeout: 240_000 };

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-jest-dts-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let made = 0;

function ref(path: string): TestFileRef {
  return { project: "app", path };
}

function worktree(major: JestMajor): { root: AbsolutePath; common: AbsolutePath } {
  const dir = join(scratch, `tree-${made++}`);
  const root = join(dir, "worktree");
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  mkdirSync(join(root, "node_modules"));
  const jest = realpathSync(join(installJest(major), "node_modules/jest"));
  symlinkSync(jest, join(root, "node_modules/jest"));
  mkdirSync(join(dir, "common"));
  initRepository(root);
  return {
    root: realpathSync(root) as AbsolutePath,
    common: realpathSync(join(dir, "common")) as AbsolutePath,
  };
}

/**
 * `files` in one batch, recorded as the core records a tier. `firstRun`: the
 * worktree's first, whose record's first-seen paths, by test file, it fills.
 */
function runFiles(
  open: OpenWorktree,
  root: AbsolutePath,
  files: readonly TestFileRef[],
  firstRun?: Map<string, readonly RelativePath[]>,
): Promise<RunReport> {
  return open.record(files, async () => {
    const report = await open.adapter.run(files, {
      runId: `run-${made}`,
      logDir: join(root, "..", `logs-${made++}`) as AbsolutePath,
      timeoutMs: 120_000,
    });
    if (firstRun !== undefined) {
      // The worktree's first `beginRun` is run 1.
      const growth = await observedGrowth({ root, keys: core(open).keys }, report, 1);
      for (const o of report.observed ?? []) {
        firstRun.set(o.testFile.path, growth.get(testFileId(o.testFile))?.firstSeen ?? []);
      }
    }
    return report;
  });
}

/**
 * The core behind an open worktree: its keys and its store connection. The
 * kit keeps both to itself; the selection below asks them what the
 * scheduler asks at an edit (`rekeyContent`, then `Ledger.lookup`).
 */
interface Core {
  readonly keys: WorktreeKeys;
  readonly store: Store;
}

const core = (open: OpenWorktree) => open as unknown as Core;

/** Stores each completed file's results under its key, as `recordCompleted` stores a tier's. */
function storeCompleted({ keys, store }: Core, report: RunReport): void {
  for (const ref of report.completedFiles) {
    const key = keys.index.key(ref);
    if (key === null) throw new Error(`${ref.path} has no key to store its results under`);
    const provenance = {
      worktreeId: "a" as WorktreeId,
      revision: 0,
      commit: null,
      dirty: true,
      runId: `run-${made}`,
      recordedAt: Date.now() as EpochMs,
    };
    store.results.putMany(
      recordsForFile({
        ref,
        key,
        report,
        previousChecks: [],
        provenance,
        describe: describeFailure,
      }),
    );
  }
}

/** The stored results of `ref`'s current key: none means it is no longer current and runs. */
const stored = ({ keys, store }: Core, ref: TestFileRef) =>
  store.results.byKey(keys.index.key(ref), 0);

const outcomes = (report: RunReport) =>
  Object.fromEntries(report.results.map((r) => [r.check.fullName, r.outcome]));

describe.each(JEST_MAJORS)("a type-checking transform's .d.ts reads on Jest %i", (major) => {
  it("key and reach only the test file whose transform read them", SLOW, async () => {
    const { root, common } = worktree(major);
    const open = await OpenWorktree.open("a", root, common, () =>
      createJestAdapter(PROJECT, { root, batchSize: () => 5 }),
    );
    onTestFinished(() => open.close());

    const firstSeen = new Map<string, readonly RelativePath[]>();
    const first = await runFiles(open, root, [A, B], firstSeen);
    expect(first.end).toBe("completed");
    expect(outcomes(first)).toEqual({ a: "pass", b: "pass" });
    // Row 028-08: no probe of Jest's own is a first-seen path; the run's results stand.
    expect(Object.fromEntries(firstSeen)).toEqual({ [A.path]: [], [B.path]: [] });
    // One batch ran both files: attribution is per test file, not per process.
    expect(first.observed?.find((o) => o.testFile.path === A.path)?.paths).toContain(
      "types/a.d.ts",
    );
    expect(first.observed?.find((o) => o.testFile.path === A.path)?.paths).not.toContain(
      "types/b.d.ts",
    );
    expect(await open.keyed(A)).toContain("types/a.d.ts");
    expect(await open.keyed(A)).not.toContain("types/b.d.ts");
    expect(await open.keyed(B)).toContain("types/b.d.ts");
    expect(await open.keyed(B)).not.toContain("types/a.d.ts");

    storeCompleted(core(open), first);
    const { keys } = core(open);
    const before = [A, B].map((f) => keys.index.key(f));
    expect([A, B].map((f) => stored(core(open), f).length > 0)).toEqual([true, true]);

    // The edit of `a.d.ts` takes the core's path: a revision, the content re-key, the lookups.
    writeFileSync(join(root, "types/a.d.ts"), "export declare const a: broken[];\n");
    const changed = ["types/a.d.ts" as RelativePath];
    const paths = await statCandidates(changed, createFsHasher(root, "sha1"));
    const revision = await keys.reconcile({ trigger: "watch", paths }, () => readHead(root));
    expect(revision?.changes.map((c) => c.path)).toEqual(changed);
    const moved = keys.index.rekey(revision?.changes.map((c) => c.path) ?? []);
    expect(moved.map((c) => c.testFile.path)).toEqual([A.path]);
    expect(await open.adapter.invalidate([{ path: "types/a.d.ts", kind: "change" }])).toEqual({
      recreatedProjects: [],
    });
    // The static graph knows no `.d.ts`: only the key `a`'s transform read it into reaches `a`.
    expect(await open.adapter.affected(["types/a.d.ts"])).toEqual({ direct: [], transitive: [] });
    const stale = [A, B].filter((f) => stored(core(open), f).length === 0);
    expect(stale).toEqual([A]);

    // Only the file no longer current runs: `a` fails on its declarations, `b` keeps its pass.
    const second = await runFiles(open, root, stale);
    expect(second.completedFiles.map((f) => f.path)).toEqual([A.path]);
    expect(outcomes(second)).toEqual({});
    expect(second.fileErrors.map((e) => e.testFile.path)).toEqual([A.path]);
    expect(second.fileErrors[0]?.errors[0]?.message).toContain(
      "type error: a.test.js does not match its declarations",
    );
    expect(keys.index.key(A)).not.toBe(before[0]);
    expect(keys.index.key(B)).toBe(before[1]);
    const kept = stored(core(open), B).map((r) => `${r.check.kind} ${r.outcome}`);
    expect(kept.sort()).toEqual(["file pass", "test pass"]);
    expect(await open.keyed(A)).toContain("types/a.d.ts");
    expect(await open.keyed(B)).not.toContain("types/a.d.ts");
  });
});
