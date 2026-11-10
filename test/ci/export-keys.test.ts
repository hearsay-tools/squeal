import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { countsText } from "../../src/cli/ci-export.js";
import { type CiExport, ciExport } from "../../src/core/ci/export.js";
import type { InputEvidence } from "../../src/core/ci/inputs.js";
import {
  PART_FORMAT,
  type Part,
  type PartFile,
  type RunDescriptor,
  snapshotFields,
} from "../../src/core/ci/parts.js";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { blobHash } from "../../src/core/hash/blob.js";
import { coreEnvironmentInputs } from "../../src/core/keys/environment.js";
import { describeEnvironment } from "../../src/core/keys/environment-descriptor.js";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import type { WorktreeId } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import type { RunnerAdapter, RunnerEnvironment } from "../../src/core/types/runner.js";

/*
 * Spec 018 D9 (row 018-17): what the export job keys and leaves out, over a
 * runner that answers as the daemon's adapter does. A file that failed in its
 * shard is left out whole (D2); one the job's runner does not list is not
 * keyed; a project the job has no environment of, or one the shards ran in
 * another environment, is refused, since the export's keys hold the job's.
 * A file whose shard's read-time evidence does not certify an input's
 * content here, or whose checks share a name, is left out and counted
 * (reviews of 0.1.421 B1, B4).
 */

const BASE = existsSync("/tmp") ? "/tmp" : tmpdir();
const SQUEAL = "0.0.0-test";
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ENVIRONMENT: RunnerEnvironment = {
  project: "",
  runnerName: "vitest",
  runnerVersion: "5.0.3",
  adapterVersion: "3+observe.6",
  resolvedConfig: JSON.stringify({ allowOnly: true, root: "<root>" }),
  files: [],
};

/** A runner that lists `listed` and gives each file a closure of itself and `src/x.ts`. */
function runner(listed: readonly string[]): RunnerAdapter {
  const fake: Pick<RunnerAdapter, "environment" | "testFiles" | "closure" | "close"> = {
    environment: async () => [ENVIRONMENT],
    testFiles: async () => listed.map((path) => ({ project: "", path })),
    closure: async (testFile: TestFileRef) => ({ testFile, paths: [testFile.path, "src/x.ts"] }),
    close: async () => {},
  };
  return fake as RunnerAdapter;
}

/** The job's own descriptor of `ENVIRONMENT`, as a part holds a run's. */
function descriptor(): RunDescriptor {
  const core = coreEnvironmentInputs({
    squealVersion: SQUEAL,
    installedDependencies: "none",
    allowlist: [],
    env: {},
  });
  const {
    installedDependencies: _i,
    files: _f,
    ...run
  } = describeEnvironment(KEY_FORMAT_VERSION, core, ENVIRONMENT, [], true);
  return run;
}

function file(path: string, outcome: PartFile["outcome"]): PartFile {
  const check = { fullName: `runs ${path}`, outcome, durationMs: 2, location: null };
  return { project: "", path, outcome, durationMs: 5, checks: [check] };
}

const PATHS = ["src/x.ts", "test/a.test.ts", "test/b.test.ts", "test/c.test.ts"];

/** Evidence of every file of `repository` at its content, as a shard that read them took it. */
function evidenceOf(root: string): Record<string, string> {
  return Object.fromEntries(
    PATHS.map((path) => [path, blobHash(readFileSync(join(root, path)), "sha1")]),
  );
}

async function repository(): Promise<{ root: string; commit: string }> {
  const root = realpathSync(mkdtempSync(join(BASE, "squeal-ci-export-keys-")));
  dirs.push(root);
  for (const path of PATHS) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), `// ${path}\n`);
  }
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "f"], {
    cwd: root,
  });
  const head = await readHead(root);
  return { root, commit: head.head as string };
}

async function exported(
  root: string,
  commit: string,
  run: RunDescriptor,
  files: readonly PartFile[],
  evidence: InputEvidence = evidenceOf(root),
): Promise<CiExport> {
  const store = openStore(join(root, ".git"));
  if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
  const part: Part = {
    format: PART_FORMAT,
    header: {
      squealVersion: SQUEAL,
      keyFormat: KEY_FORMAT_VERSION,
      runner: "vitest",
      runnerVersion: "5.0.3",
      commit,
      dirty: false,
      shard: { index: 1, count: 1 },
      createdAt: 0,
      source: { kind: "local" },
      end: "completed",
      observing: true,
    },
    projects: [
      {
        descriptor: run,
        updateSnapshot: "none",
        snapshotOptions: snapshotFields(ENVIRONMENT.resolvedConfig),
      },
    ],
    testFiles: files,
    evidence,
  };
  const { squealVersion, keyFormat, dirty, createdAt, source } = part.header;
  const header = { squealVersion, keyFormat, commit, dirty, createdAt, source };
  try {
    return await ciExport({
      root,
      worktreeId: "0123456789abcdef" as WorktreeId,
      store,
      runner: async () => runner(["test/a.test.ts", "test/b.test.ts"]),
      policy: DEFAULT_POLICY,
      squealVersion: SQUEAL,
      env: {},
      parts: [{ file: "p1", part }],
      header,
      now: () => 7,
    });
  } finally {
    store.close();
  }
}

describe("ci export's keys (spec 018 D9)", () => {
  it("leaves out a file that failed in its shard and one the job's runner does not list", async () => {
    const { root, commit } = await repository();
    const files = [
      file("test/a.test.ts", "pass"),
      file("test/b.test.ts", "fail"),
      file("test/c.test.ts", "pass"),
    ];
    const result = await exported(root, commit, descriptor(), files);
    if ("refused" in result) throw new Error(result.refused.text);
    expect(result.counts).toEqual({
      testFiles: 1,
      results: 2,
      failed: 1,
      unkeyed: 1,
      uncertified: 0,
      ambiguous: 0,
      inspector: 0,
    });
    const [only] = result.bundle.testFiles;
    expect(only?.path).toBe("test/a.test.ts");
    expect(only?.closure?.paths).toEqual(["src/x.ts", "test/a.test.ts"]);
    expect(only?.keyParts).toEqual({ dependencies: "", runtime: "" });
    expect(result.bundle.results.map((r) => [r.kind, r.fullName, r.outcome, r.durationMs])).toEqual(
      [
        ["file", null, "pass", 5],
        ["test", "runs test/a.test.ts", "pass", 2],
      ],
    );
    expect(result.bundle.environments.map((e) => e.descriptor?.nodeVersion)).toEqual([
      descriptor().nodeVersion,
    ]);
  });

  it("refuses shards that ran a project in another environment than the job's", async () => {
    const { root, commit } = await repository();
    const run = { ...descriptor(), nodeVersion: "v0.0.1" };
    const result = await exported(root, commit, run, [file("test/a.test.ts", "pass")]);
    expect("refused" in result && result.refused.kind).toBe("environment");
    expect("refused" in result && result.refused.text).toContain(
      `another environment than this job's: Node v0.0.1 in the export, ${descriptor().nodeVersion} here`,
    );
  });

  it("refuses shards of a project the job's runner has none of", async () => {
    const { root, commit } = await repository();
    const run = { ...descriptor(), project: "web" };
    const result = await exported(root, commit, run, [file("test/a.test.ts", "pass")]);
    expect("refused" in result && result.refused.text).toContain(
      `this checkout's Vitest has no project "web"`,
    );
  });

  it("leaves out a file whose checks share a name, and one whose input content it cannot certify", async () => {
    const { root, commit } = await repository();
    const shared = { ...file("test/a.test.ts", "pass"), sharedNames: ["runs twice"] };
    // `src/x.ts` here is `// src/x.ts\n`, not the content the shard read.
    const wrong = { ...evidenceOf(root), "src/x.ts": "0".repeat(40) };
    const files = [shared, file("test/b.test.ts", "pass")];
    const result = await exported(root, commit, descriptor(), files, wrong);
    if ("refused" in result) throw new Error(result.refused.text);
    expect(result.counts).toMatchObject({ testFiles: 0, ambiguous: 1, uncertified: 1, unkeyed: 0 });
    expect(result.uncertified).toEqual([
      { testFile: { project: "", path: "test/b.test.ts" }, inputs: ["src/x.ts"] },
    ]);
  });

  it("leaves out a file whose worker ran node:inspector beside Squeal's provider (spec 020 D13.4)", async () => {
    const { root, commit } = await repository();
    const inspected = { ...file("test/a.test.ts", "pass"), noRecord: "inspector" as const };
    const other = { ...file("test/b.test.ts", "pass"), noRecord: "unmapped" as const };
    const result = await exported(root, commit, descriptor(), [inspected, other]);
    if ("refused" in result) throw new Error(result.refused.text);
    expect(result.counts).toMatchObject({ testFiles: 1, inspector: 1, unkeyed: 0, failed: 0 });
    expect(result.bundle.testFiles.map((f) => f.path)).toEqual(["test/b.test.ts"]);
    expect(countsText(result.counts, "x.json.gz")).toContain(
      "1 test file that ran node:inspector beside Squeal's coverage provider",
    );
  });

  it("leaves out a file an input of which its shard holds no evidence of, a commit's file too", async () => {
    const { root, commit } = await repository();
    const files = [file("test/a.test.ts", "pass")];
    const { "src/x.ts": _x, ...unread } = evidenceOf(root);
    const missing = await exported(root, commit, descriptor(), files, unread);
    expect("counts" in missing && missing.counts).toMatchObject({ testFiles: 0, uncertified: 1 });
    const read = await exported(root, commit, descriptor(), files);
    expect("counts" in read && read.counts).toMatchObject({ testFiles: 1, uncertified: 0 });
  });
});
