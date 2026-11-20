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
import { afterEach } from "vitest";
import { type CiExport, ciExport } from "../../src/core/ci/export.js";
import type { InputEvidence } from "../../src/core/ci/inputs.js";
import {
  PART_FORMAT,
  type Part,
  type PartCoverage,
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
import { NO_TRAITS } from "../../src/core/types/runner-traits.js";

/*
 * Spec 018 D9 (row 018-17): a small committed repository, a runner that
 * answers as the daemon's adapter does, and `ci export` of one hand-made
 * part over them, for `export-keys.test.ts` and `export-endpoints.test.ts`.
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

/**
 * A runner that lists `listed` and gives each file a closure of itself and
 * `src/x.ts`; the closure of each of `inspected` imports `node:inspector`.
 */
function runner(listed: readonly string[], inspected: readonly string[] = []): RunnerAdapter {
  const builtins = { imports: [], builtins: ["fs", "inspector"] };
  const fake: Pick<RunnerAdapter, "traits" | "environment" | "testFiles" | "closure" | "close"> = {
    traits: NO_TRAITS,
    environment: async () => [ENVIRONMENT],
    testFiles: async () => listed.map((path) => ({ project: "", path })),
    closure: async (testFile: TestFileRef) => ({
      testFile,
      paths: [testFile.path, "src/x.ts"],
      ...(inspected.includes(testFile.path) ? { packages: builtins } : {}),
    }),
    close: async () => {},
  };
  return fake as RunnerAdapter;
}

/** The job's own descriptor of `ENVIRONMENT`, as a part holds a run's. */
export function descriptor(): RunDescriptor {
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

export function file(path: string, outcome: PartFile["outcome"]): PartFile {
  const check = { fullName: `runs ${path}`, outcome, durationMs: 2, location: null };
  return { project: "", path, outcome, durationMs: 5, checks: [check] };
}

const PATHS = ["src/x.ts", "test/a.test.ts", "test/b.test.ts", "test/c.test.ts"];

/** Evidence of every file of `repository` at its content, as a shard that read them took it. */
export function evidenceOf(root: string): Record<string, string> {
  return Object.fromEntries(
    PATHS.map((path) => [path, blobHash(readFileSync(join(root, path)), "sha1")]),
  );
}

export async function repository(): Promise<{ root: string; commit: string }> {
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

export async function exported(
  root: string,
  commit: string,
  run: RunDescriptor,
  files: readonly PartFile[],
  evidence: InputEvidence = evidenceOf(root),
  ran: {
    coverage?: PartCoverage;
    inspected?: readonly string[];
    listed?: readonly string[];
    /** Fields of the part to replace: spec 018 D32's endpoint fields, its format. */
    part?: Partial<Part>;
  } = {},
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
      ...(ran.coverage === undefined ? {} : { coverage: ran.coverage }),
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
    ...ran.part,
  };
  const { squealVersion, keyFormat, dirty, createdAt, source } = part.header;
  const header = { squealVersion, keyFormat, commit, dirty, createdAt, source };
  try {
    return await ciExport({
      root,
      worktreeId: "0123456789abcdef" as WorktreeId,
      store,
      runners: async () => [
        runner(ran.listed ?? ["test/a.test.ts", "test/b.test.ts"], ran.inspected),
      ],
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
