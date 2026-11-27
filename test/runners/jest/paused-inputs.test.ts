import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
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
import type { InvalidatedPath, RunReport } from "../../../src/core/types/runner.js";
import type { Store } from "../../../src/core/types/store.js";
import { createJestAdapter } from "../../../src/runners/jest/index.js";
import { installJest, JEST_MAJORS, type JestMajor } from "../../helpers/jest-env.js";
import { initRepository, OpenWorktree } from "../../kit/worktrees.js";

/*
 * Review 0.1.653 B1, B2 and B3 on real Jest 29.7.0 and 30.5.2, each through
 * the core's key and stored-result lookup in the reviewer's order: key
 * before the run, record its growth, store its results, then reconcile the
 * edit, re-key its content, invalidate the adapter, read the environment
 * again when it recreated the project, fetch the closures again, and compare
 * the key and the stored results with a forced run. Row 028-08 pauses the
 * recorder while Jest's transform and resolver run; none of these inputs
 * may be lost to that pause.
 */

const lines = (...text: string[]) => `${text.join("\n")}\n`;
const SLOW = { timeout: 240_000 };

const PROJECT: JestProject = {
  name: "app",
  config: "jest.config.js",
  include: [],
  exclude: [],
  args: [],
  env: {},
};

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-jest-paused-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let made = 0;

const ref = (path: string): TestFileRef => ({ project: "app", path });

/** A worktree of `files` whose `node_modules` links the installed Jest `major`. */
function worktree(
  major: JestMajor,
  files: Readonly<Record<string, string>>,
): { root: AbsolutePath; common: AbsolutePath } {
  const dir = join(scratch, `tree-${made++}`);
  const root = join(dir, "worktree");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  mkdirSync(join(root, "node_modules"));
  symlinkSync(
    realpathSync(join(installJest(major), "node_modules/jest")),
    join(root, "node_modules/jest"),
  );
  mkdirSync(join(dir, "common"));
  initRepository(root);
  return {
    root: realpathSync(root) as AbsolutePath,
    common: realpathSync(join(dir, "common")) as AbsolutePath,
  };
}

/** The keys and store behind an open worktree, which the kit keeps to itself. */
interface Core {
  readonly keys: WorktreeKeys;
  readonly store: Store;
}
const core = (open: OpenWorktree) => open as unknown as Core;

/** One opened worktree and the steps the core takes around a run and an edit. */
class Play {
  private runs = 0;

  private constructor(
    readonly open: OpenWorktree,
    readonly root: AbsolutePath,
  ) {}

  static async start(project: JestProject, major: JestMajor, files: Record<string, string>) {
    const { root, common } = worktree(major, files);
    const open = await OpenWorktree.open("a", root, common, () =>
      createJestAdapter(project, { root, batchSize: () => 5 }),
    );
    onTestFinished(() => open.close());
    return new Play(open, root);
  }

  get keys(): WorktreeKeys {
    return core(this.open).keys;
  }

  key(file: TestFileRef): string | null {
    return this.keys.index.key(file);
  }

  /** The stored results of `file`'s current key; none means it runs. */
  stored(file: TestFileRef): string[] {
    const { store } = core(this.open);
    return store.results
      .byKey(this.key(file), 0)
      .map((r) => `${r.check.kind} ${r.outcome}`)
      .sort();
  }

  /** Runs `files` as the core records a tier; `firstSeen` gets each file's first-seen paths. */
  run(files: readonly TestFileRef[], firstSeen?: Map<string, readonly RelativePath[]>) {
    return this.open.record(files, async () => {
      const keys = this.keys;
      // `record` began this run: the play's runs are the worktree's only ones.
      this.runs += 1;
      const number = this.runs;
      const report = await this.open.adapter.run(files, {
        runId: `run-${made}`,
        logDir: join(this.root, "..", `logs-${made++}`) as AbsolutePath,
        timeoutMs: 120_000,
      });
      if (firstSeen !== undefined) {
        const growth = await observedGrowth({ root: this.root, keys }, report, number);
        for (const o of report.observed ?? []) {
          firstSeen.set(o.testFile.path, growth.get(testFileId(o.testFile))?.firstSeen ?? []);
        }
      }
      return report;
    });
  }

  /** Stores each completed file's results under its key, as `recordCompleted` does. */
  storeCompleted(report: RunReport): void {
    const { store } = core(this.open);
    for (const file of report.completedFiles) {
      const key = this.key(file);
      if (key === null) throw new Error(`${file.path} has no key`);
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
          ref: file,
          key,
          report,
          previousChecks: [],
          provenance,
          describe: describeFailure,
        }),
      );
    }
  }

  /**
   * The core's step at an edit of `path`, `text` or `null` to delete it: a
   * revision, the content re-key, the adapter's invalidation, the
   * environment read again when it recreated a project or an environment
   * input changed, and `files`' closures fetched again.
   */
  async edit(path: string, text: string | null, files: readonly TestFileRef[]) {
    const abs = join(this.root, path);
    const existed = this.keys.environmentFiles("app" as never).includes(path as RelativePath);
    if (text === null) unlinkSync(abs);
    else {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, text);
    }
    const changed = [path as RelativePath];
    const paths = await statCandidates(changed, createFsHasher(this.root, "sha1"));
    const revision = await this.keys.reconcile({ trigger: "watch", paths }, () =>
      readHead(this.root),
    );
    const changes = revision?.changes ?? [];
    this.keys.index.rekey(changes.map((c) => c.path));
    const invalidated: InvalidatedPath[] = changes.map((c) => ({
      path: c.path,
      kind: c.oldHash === null ? "add" : c.newHash === null ? "delete" : "change",
    }));
    const result = await this.open.adapter.invalidate(invalidated);
    if (result.recreatedProjects.length > 0 || existed) {
      await this.keys.setEnvironments(await this.open.adapter.environment());
    }
    for (const file of files) await this.open.keyed(file);
    return { changes: changes.map((c) => c.path), recreated: result.recreatedProjects };
  }
}

const outcomes = (report: RunReport) =>
  Object.fromEntries(report.results.map((r) => [r.check.fullName, r.outcome]));

const observedOf = (report: RunReport, file: TestFileRef): readonly RelativePath[] =>
  report.observed?.find((o) => o.testFile.path === file.path)?.paths ?? [];

const fileError = (report: RunReport) => report.fileErrors[0]?.errors[0]?.message ?? "";

/** B1: a project with Jest's default Babel transform and no Babel config of its own. */
const BABEL_FILES: Record<string, string> = {
  "package.json": `{ "name": "app", "private": true }\n`,
  "jest.config.js": lines(
    "module.exports = {",
    '  testEnvironment: "node",',
    '  testMatch: ["<rootDir>/test/**/*.test.js"],',
    "};",
  ),
  "src/value.js": "module.exports = 1;\n",
  "test/a.test.js": lines(
    'const value = require("../src/value");',
    'test("a", () => expect(value).toBe(1));',
  ),
};

describe.each(JEST_MAJORS)("a nested Babel config on Jest %i", (major) => {
  it("keys the test once it exists, and the revert finds the stored pass", SLOW, async () => {
    const A = ref("test/a.test.js");
    const play = await Play.start(PROJECT, major, BABEL_FILES);
    await play.open.keyed(A);
    const k1 = play.key(A);
    const firstSeen = new Map<string, readonly RelativePath[]>();
    const first = await play.run([A], firstSeen);
    expect(outcomes(first)).toEqual({ a: "pass" });
    expect(Object.fromEntries(firstSeen)).toEqual({ [A.path]: [] });
    expect(play.key(A)).toBe(k1);
    play.storeCompleted(first);
    expect(play.stored(A)).toEqual(["file pass", "test pass"]);

    // Created broken: the project reads again, and the config keys its environment.
    const added = await play.edit("src/.babelrc", "{ invalid json\n", [A]);
    expect(added.recreated).toEqual(["app"]);
    expect(play.open.environmentFiles("app" as never)).toContain("src/.babelrc");
    const k2 = play.key(A);
    expect(k2).not.toBe(k1);
    expect(play.stored(A)).toEqual([]);
    const broken = await play.run([A]);
    expect(broken.fileErrors.map((e) => e.testFile.path)).toEqual([A.path]);
    expect(fileError(broken)).toMatch(/Error while parsing config|JSON5/);

    // Repaired: a new key again, and the file passes.
    await play.edit("src/.babelrc", "{}\n", [A]);
    const k3 = play.key(A);
    expect([k1, k2]).not.toContain(k3);
    expect(play.stored(A)).toEqual([]);
    expect(outcomes(await play.run([A]))).toEqual({ a: "pass" });

    // Deleted: the key of the first run, and its stored pass, are current again.
    const removed = await play.edit("src/.babelrc", null, [A]);
    expect(removed.recreated).toEqual(["app"]);
    expect(play.open.environmentFiles("app" as never)).not.toContain("src/.babelrc");
    expect(play.key(A)).toBe(k1);
    expect(play.stored(A)).toEqual(["file pass", "test pass"]);
  });
});

/**
 * B2: a transform that reads `types/value.d.ts` through a descriptor, in its
 * cache key and in `process`, and fails the file when it says `broken`.
 */
const DESCRIPTOR_TRANSFORM = lines(
  'const crypto = require("crypto");',
  'const fs = require("fs");',
  'const path = require("path");',
  "function declarations() {",
  '  const fd = fs.openSync(path.join(__dirname, "../types/value.d.ts"), "r");',
  "  try {",
  '    return fs.readFileSync(fd, "utf8");',
  "  } finally {",
  "    fs.closeSync(fd);",
  "  }",
  "}",
  "module.exports = {",
  "  getCacheKey(sourceText, sourcePath) {",
  '    return crypto.createHash("sha1").update(sourcePath).update(sourceText).update(declarations()).digest("hex");',
  "  },",
  "  process(sourceText) {",
  '    if (declarations().includes("broken")) throw new Error("broken declaration");',
  "    return { code: sourceText };",
  "  },",
  "};",
);

const DESCRIPTOR_FILES: Record<string, string> = {
  "package.json": BABEL_FILES["package.json"] as string,
  "jest.config.js": lines(
    "module.exports = {",
    '  testEnvironment: "node",',
    '  testMatch: ["<rootDir>/test/**/*.test.js"],',
    '  transform: { "\\\\.js$": "<rootDir>/transform/types.js" },',
    "};",
  ),
  "transform/types.js": DESCRIPTOR_TRANSFORM,
  "types/value.d.ts": "valid\n",
  "test/a.test.js": 'test("a", () => expect(1).toBe(1));\n',
};

describe.each(JEST_MAJORS)("a transform's descriptor read on Jest %i", (major) => {
  it("keys the declaration, so its edit re-keys and fails the file", SLOW, async () => {
    const A = ref("test/a.test.js");
    const play = await Play.start(PROJECT, major, DESCRIPTOR_FILES);
    await play.open.keyed(A);
    const firstSeen = new Map<string, readonly RelativePath[]>();
    const first = await play.run([A], firstSeen);
    expect(outcomes(first)).toEqual({ a: "pass" });
    expect(observedOf(first, A)).toContain("types/value.d.ts");
    expect(Object.fromEntries(firstSeen)).toEqual({ [A.path]: [] });
    expect(await play.open.keyed(A)).toContain("types/value.d.ts");
    const k1 = play.key(A);
    play.storeCompleted(first);
    expect(play.stored(A)).toEqual(["file pass", "test pass"]);

    const edited = await play.edit("types/value.d.ts", "broken\n", [A]);
    expect(edited.changes).toEqual(["types/value.d.ts"]);
    expect(play.key(A)).not.toBe(k1);
    expect(play.stored(A)).toEqual([]);
    const second = await play.run([A]);
    expect(second.fileErrors.map((e) => e.testFile.path)).toEqual([A.path]);
    expect(fileError(second)).toContain("broken declaration");
  });
});

/**
 * B3: an ES module test whose dynamic import's async transform waits on a
 * barrier the test releases, after it asks about a file of its own that is
 * absent. The barrier lives on Node's `fs`, the one object the transform
 * and the test's sandbox share. Jest 30 on a Node that evaluates ES modules
 * synchronously transforms with `process`, which opens the barrier at once.
 */
const BARRIER_TRANSFORM = lines(
  'const fs = require("fs");',
  'const BARRIER = Symbol.for("squeal.test.barrier");',
  "const barrier = () => (fs[BARRIER] ??= { started: false, release: null });",
  "module.exports = {",
  "  process(sourceText, sourcePath) {",
  '    if (sourcePath.endsWith("slow.mjs")) barrier().started = true;',
  "    return { code: sourceText };",
  "  },",
  "  async processAsync(sourceText, sourcePath) {",
  '    if (!sourcePath.endsWith("slow.mjs")) return { code: sourceText };',
  "    const gate = barrier();",
  "    await new Promise((done) => {",
  "      const timer = setTimeout(done, 20_000);",
  "      gate.release = () => {",
  "        clearTimeout(timer);",
  "        done();",
  "      };",
  "      gate.started = true;",
  "    });",
  "    return { code: sourceText };",
  "  },",
  "};",
);

const BARRIER_FILES: Record<string, string> = {
  "package.json": BABEL_FILES["package.json"] as string,
  "jest.config.js": lines(
    "module.exports = {",
    '  testEnvironment: "node",',
    '  testMatch: ["<rootDir>/test/**/*.test.mjs"],',
    '  transform: { "\\\\.mjs$": "<rootDir>/transform/barrier.js" },',
    "};",
  ),
  "transform/barrier.js": BARRIER_TRANSFORM,
  "src/slow.mjs": "export const slow = 1;\n",
  "test/a.test.mjs": lines(
    'import fs from "node:fs";',
    'const BARRIER = Symbol.for("squeal.test.barrier");',
    'test("user absent read", async () => {',
    '  const loading = import("../src/slow.mjs");',
    "  for (let i = 0; i < 2000 && fs[BARRIER]?.started !== true; i++) {",
    "    await new Promise((done) => setTimeout(done, 5));",
    "  }",
    "  expect(fs[BARRIER]?.started).toBe(true);",
    '  expect(fs.existsSync(new URL("../user-absent.txt", import.meta.url))).toBe(false);',
    "  fs[BARRIER].release?.();",
    "  expect((await loading).slow).toBe(1);",
    "});",
  ),
};

const ESM_PROJECT: JestProject = {
  ...PROJECT,
  env: { NODE_OPTIONS: "--experimental-vm-modules --no-warnings" },
};

describe.each(JEST_MAJORS)("a test's own read while an async transform waits, Jest %i", (major) => {
  it("is observed and first seen, so the file's creation re-keys the test", SLOW, async () => {
    const A = ref("test/a.test.mjs");
    const play = await Play.start(ESM_PROJECT, major, BARRIER_FILES);
    await play.open.keyed(A);
    const firstSeen = new Map<string, readonly RelativePath[]>();
    const first = await play.run([A], firstSeen);
    expect(outcomes(first)).toEqual({ "user absent read": "pass" });
    expect(observedOf(first, A)).toContain("user-absent.txt");
    expect(firstSeen.get(A.path)).toEqual(["user-absent.txt"]);
    expect(await play.open.keyed(A)).toContain("user-absent.txt");
    const k1 = play.key(A);
    play.storeCompleted(first);
    expect(play.stored(A)).toEqual(["file pass", "test pass"]);

    const created = await play.edit("user-absent.txt", "here\n", [A]);
    expect(created.changes).toEqual(["user-absent.txt"]);
    expect(play.key(A)).not.toBe(k1);
    expect(play.stored(A)).toEqual([]);
    expect(outcomes(await play.run([A]))).toEqual({ "user absent read": "fail" });
  });
});
