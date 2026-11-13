import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import type { NoRecord, Part, PartCollector, PartFile } from "../../../src/core/ci/parts.js";
import {
  COVERAGE_PROVIDER_VERSION,
  COVERAGE_RECORD_VERSION,
} from "../../../src/core/code/coverage/record.js";
import { type PartsOptions, partsEvidence } from "../../../src/core/code/gate/parts.js";
import type { PartRefusal } from "../../../src/core/code/gate/parts-refused.js";
import { blobHash } from "../../../src/core/hash/blob.js";
import { KEY_FORMAT_VERSION } from "../../../src/core/keys/key-format.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { RunnerClosure } from "../../../src/core/types/runner.js";
import { initRepo } from "../../hash/git-repo.js";
import { ENVIRONMENT, GATE, partProject } from "./parts-fixture.js";

/*
 * Spec 020 D13.2: synthetic parts of a small repository, and what
 * `partsEvidence` gives of its one test file, for `parts.test.ts` and
 * `parts-refused.test.ts`.
 */

export const FILES: Readonly<Record<string, string>> = {
  ".gitignore": "out/\n",
  "src/a.ts": "export const a = 1;\n",
  "test/a.test.ts": "import { a } from '../src/a';\n",
  "data/x.txt": "x\n",
  "fixtures/one/one.txt": "1\n",
  "fixtures/two/deep/two.txt": "2\n",
};

export const blob = (text: string) => blobHash(Buffer.from(text), "sha1");

export const REF: TestFileRef = { project: "", path: "test/a.test.ts" };

export const CLOSURE = async (testFile: TestFileRef): Promise<RunnerClosure> => ({
  testFile,
  paths: ["src/a.ts", "test/a.test.ts"],
});

/** A new repository of `FILES` for each call, removed after each test of the file that calls it. */
export function repos(): () => string {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  return () => {
    const root = mkdtempSync(join(tmpdir(), "squeal-gate-parts-"));
    dirs.push(root);
    initRepo(root, FILES);
    return root;
  };
}

/** The evidence a run of `FILES` read: each file's blob. */
export const EVIDENCE = Object.fromEntries(
  Object.entries(FILES).map(([path, text]) => [path, blob(text)]),
);

export function file(overrides: Partial<PartFile> = {}): PartFile {
  return {
    project: "",
    path: REF.path,
    outcome: "pass",
    durationMs: 1,
    checks: [{ fullName: "a", outcome: "pass", durationMs: 1, location: null }],
    observed: { paths: ["data/x.txt"], directories: [] },
    record: 0,
    ...overrides,
  };
}

/** `file(overrides)` with no record, and why. */
export function unrecorded(noRecord: NoRecord, overrides: Partial<PartFile> = {}): PartFile {
  const { record: _record, ...rest } = file(overrides);
  return { ...rest, noRecord };
}

export function part(files: readonly PartFile[] = [file()], overrides: Partial<Part> = {}): Part {
  return {
    format: "squeal-ci-part/4",
    header: {
      squealVersion: "0.0.0-test",
      keyFormat: KEY_FORMAT_VERSION,
      runner: "vitest",
      runnerVersion: "5.0.3",
      commit: null,
      dirty: false,
      shard: { index: 1, count: 1 },
      createdAt: 0,
      source: { kind: "local" },
      end: "completed",
      observing: true,
      coverage: {
        provider: "squeal",
        providerVersion: COVERAGE_PROVIDER_VERSION,
        recordVersion: COVERAGE_RECORD_VERSION,
      },
    },
    projects: [partProject()],
    testFiles: files,
    evidence: EVIDENCE,
    coverage: {
      sources: [
        {
          path: "src/a.ts",
          blob: blob(FILES["src/a.ts"] as string),
          lines: "",
          covered: "",
          functions: [],
        },
      ],
      records: [{ sources: [0], unread: [] }],
    },
    ...overrides,
  };
}

/** `part()` whose records `collector` took (spec 020 D19.4). */
export function collected(collector: string): Part {
  const made = part();
  const coverage = {
    provider: "squeal" as const,
    collector: collector as PartCollector,
    providerVersion: COVERAGE_PROVIDER_VERSION,
    recordVersion: COVERAGE_RECORD_VERSION,
  };
  return { ...made, header: { ...made.header, coverage } };
}

/**
 * What `partsEvidence` gives of `test/a.test.ts` over `parts`, named
 * `part-<i>.json`, with `closure` as the runner's: its evidence, the notes
 * and each refusal (row 020-49).
 */
export async function taken(
  root: string,
  parts: readonly Part[],
  options: Partial<PartsOptions> = {},
  closure: (ref: TestFileRef) => Promise<RunnerClosure | null> = CLOSURE,
) {
  const notes: string[] = [];
  const refused: PartRefusal[] = [];
  const evidence = partsEvidence({
    root,
    parts: parts.map((p, i) => ({ file: `part-${i}.json`, part: p })),
    changed: ["src/a.ts"],
    children: false,
    environment: GATE,
    note: (text) => notes.push(text),
    refused: (refusal) => refused.push(refusal),
    ...options,
  });
  const found = await evidence("vitest", [REF], closure, ENVIRONMENT);
  return { evidence: found.get(REF) ?? null, notes, refused };
}
