import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { NoRecord, Part, PartFile } from "../../../src/core/ci/parts.js";
import {
  COVERAGE_PROVIDER_VERSION,
  COVERAGE_RECORD_VERSION,
} from "../../../src/core/code/coverage/record.js";
import { FILE_ERROR } from "../../../src/core/code/gate/collect.js";
import {
  type PartsOptions,
  partsEvidence,
  readPartsIn,
} from "../../../src/core/code/gate/parts.js";
import { blobHash } from "../../../src/core/hash/blob.js";
import { namesHash } from "../../../src/core/keys/observed.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { RunnerClosure } from "../../../src/core/types/runner.js";
import { initRepo, writeFile } from "../../hash/git-repo.js";

/*
 * Spec 020 D13.2 (row 020-08b; research `ci-evidence.md` Q3, rule 3): the
 * rules `partsEvidence` takes a file by, over synthetic parts of a small
 * repository. The end-to-end cases with `ci record`'s real parts are in
 * `test/cli/code-gate-parts*.test.ts`.
 */

const FILES: Readonly<Record<string, string>> = {
  ".gitignore": "out/\n",
  "src/a.ts": "export const a = 1;\n",
  "test/a.test.ts": "import { a } from '../src/a';\n",
  "data/x.txt": "x\n",
  "fixtures/one/one.txt": "1\n",
  "fixtures/two/deep/two.txt": "2\n",
};

const blob = (text: string) => blobHash(Buffer.from(text), "sha1");

const REF: TestFileRef = { project: "", path: "test/a.test.ts" };

const CLOSURE = async (testFile: TestFileRef): Promise<RunnerClosure> => ({
  testFile,
  paths: ["src/a.ts", "test/a.test.ts"],
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "squeal-gate-parts-"));
  dirs.push(root);
  initRepo(root, FILES);
  return root;
}

/** The evidence a run of `FILES` read: each file's blob. */
const EVIDENCE = Object.fromEntries(
  Object.entries(FILES).map(([path, text]) => [path, blob(text)]),
);

function file(overrides: Partial<PartFile> = {}): PartFile {
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
function unrecorded(noRecord: NoRecord, overrides: Partial<PartFile> = {}): PartFile {
  const { record: _record, ...rest } = file(overrides);
  return { ...rest, noRecord };
}

function part(files: readonly PartFile[] = [file()], overrides: Partial<Part> = {}): Part {
  return {
    format: "squeal-ci-part/4",
    header: {
      squealVersion: "0.0.0-test",
      keyFormat: 1,
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
    projects: [],
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

/** What `partsEvidence` gives of `test/a.test.ts`, and its notes. */
async function taken(root: string, parts: readonly Part[], options: Partial<PartsOptions> = {}) {
  const notes: string[] = [];
  const evidence = partsEvidence({
    root,
    parts: parts.map((p, i) => ({ file: `part-${i}.json`, part: p })),
    changed: ["src/a.ts"],
    children: false,
    note: (text) => notes.push(text),
    ...options,
  });
  const found = await evidence("vitest", [REF], CLOSURE);
  return { evidence: found.get(REF) ?? null, notes };
}

describe("partsEvidence: a certified file (spec 020 D13.2)", () => {
  it("is taken with its record, its checks and the closure here", async () => {
    const { evidence, notes } = await taken(repo(), [part()]);

    expect(evidence).toEqual({
      runner: "vitest",
      path: "test/a.test.ts",
      completed: true,
      failed: [],
      skipped: false,
      loads: ["src/a.ts", "test/a.test.ts"],
      record: { v: 1, sources: part().coverage?.sources, unread: [] },
      from: "parts",
    });
    expect(notes).toEqual([]);
  });

  it("is never taken for node:test, which ci record does not run", async () => {
    const evidence = partsEvidence({
      root: repo(),
      parts: [{ file: "p.json", part: part() }],
      changed: [],
      children: false,
    });
    expect(await evidence("node-test", [REF], CLOSURE)).toEqual(new Map());
  });

  it("is taken with no record when it failed, a file-level error by name", async () => {
    const failing = unrecorded("unmapped", { outcome: "fail", checks: [] });
    const { evidence } = await taken(repo(), [part([failing])]);

    expect(evidence).toMatchObject({ failed: [FILE_ERROR], record: null, from: "parts" });
  });
});

describe("partsEvidence: what makes a file run (spec 020 D13.2)", () => {
  it("runs a file whose runtime read changed here", async () => {
    const root = repo();
    writeFile(root, "data/x.txt", "changed\n");
    expect((await taken(root, [part()])).evidence).toBeNull();
  });

  it("runs a passing file with no record", async () => {
    const none = unrecorded("filtered");
    expect((await taken(repo(), [part([none])])).evidence).toBeNull();
  });

  it("runs a file whose record could not read a changed path", async () => {
    const coverage = { sources: [], records: [{ sources: [], unread: ["src/a.ts"] }] };
    expect((await taken(repo(), [part([file()], { coverage })])).evidence).toBeNull();
  });

  it("runs a file whose record holds other bytes of a source", async () => {
    const coverage = {
      sources: [{ path: "src/a.ts", blob: blob("old\n"), lines: "", covered: "", functions: [] }],
      records: [{ sources: [0], unread: [] }],
    };
    expect((await taken(repo(), [part([file()], { coverage })])).evidence).toBeNull();
  });

  it("runs every file of a run that did not record its reads, with a note", async () => {
    const blind = part();
    const { evidence, notes } = await taken(repo(), [
      { ...blind, header: { ...blind.header, observing: false } },
    ]);
    expect(evidence).toBeNull();
    expect(notes).toEqual([
      "1 part gives no evidence, so its test files run: its run did not record what its tests read (part-0.json)",
    ]);
  });

  it("runs every file when coverage.children is on at the base, with a note", async () => {
    const { evidence, notes } = await taken(repo(), [part()], { children: true });
    expect(evidence).toBeNull();
    expect(notes).toEqual([
      "1 part gives no evidence, so its test files run: coverage.children is on at the base, and ci record collects no child process's coverage (part-0.json)",
    ]);
  });
});

describe("partsEvidence: the inputs a part certifies (spec 020 D13.2, 016 D4)", () => {
  it("leaves out the run's own scratch, a git-ignored path below a directory it wrote", async () => {
    const observed = { paths: ["data/x.txt", "out/run.json"], directories: [], written: ["out"] };
    expect((await taken(repo(), [part([file({ observed })])])).evidence).not.toBeNull();

    // Not below a directory it wrote: an input like any other, which the evidence lacks.
    const outside = { paths: ["data/x.txt", "out/run.json"], directories: [] };
    expect((await taken(repo(), [part([file({ observed: outside })])])).evidence).toBeNull();
  });

  it("certifies a recursive listing as the listing of each directory below it", async () => {
    const root = repo();
    const names = (dir: string) => namesHash(readdirSync(join(root, dir)));
    const listings = {
      "fixtures/": names("fixtures"),
      "fixtures/one/": names("fixtures/one"),
      "fixtures/two/": names("fixtures/two"),
      "fixtures/two/deep/": names("fixtures/two/deep"),
    };
    const observed = { paths: [], directories: ["fixtures"], recursive: ["fixtures"] };
    const listed = part([file({ observed })], { evidence: { ...EVIDENCE, ...listings } });
    expect((await taken(root, [listed])).evidence).not.toBeNull();

    writeFile(root, "fixtures/two/deep/three.txt", "3\n");
    expect((await taken(root, [listed])).evidence).toBeNull();
  });
});

describe("readPartsIn (spec 020 D13.2)", () => {
  it("says why a directory gives no part", () => {
    const root = repo();
    expect(readPartsIn([join(root, "nope")])).toBe(`no directory ${join(root, "nope")}`);
    expect(readPartsIn([join(root, "src")])).toBe(
      `no part (squeal-part-*.json) in ${join(root, "src")}`,
    );
  });
});
