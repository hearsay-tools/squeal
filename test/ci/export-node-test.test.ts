import { describe, expect, it } from "vitest";
import type { NamedPart } from "../../src/core/ci/export-check.js";
import {
  assignNodeTest,
  entryArgv,
  type NodeTestEntryHere,
} from "../../src/core/ci/export-node-test.js";
import {
  NODE_TEST_UNASSIGNED,
  PART_FORMAT,
  type Part,
  type PartFile,
  type PartNodeTest,
} from "../../src/core/ci/parts.js";
import { configFieldHash } from "../../src/core/keys/environment-descriptor.js";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";

/*
 * Spec 018 D26 (row 018-48): `ci export` gives each recorded node:test
 * file to the one `nodeTest` entry of the export checkout that ran it, and
 * leaves out, with a line, the files of a process of no entry, of a file
 * no entry or two entries list, and of an entry run on another Node, with
 * another variable or with an incomplete `--test-shard` set. One entry's
 * refusal keeps the others' files.
 */

const COMMIT = "c".repeat(40);
const BUILD = "b".repeat(64);

function entry(name: string, files: readonly string[], more: Partial<NodeTestEntryHere> = {}) {
  return {
    name,
    cwd: "",
    argv: ["--import", "tsx"],
    nodeOptions: [],
    env: {},
    node: { version: "v26.13.0", nodeBuild: BUILD },
    files: new Set(files),
    ...more,
  } satisfies NodeTestEntryHere;
}

function file(path: string): PartFile {
  return {
    project: NODE_TEST_UNASSIGNED,
    path,
    outcome: "pass",
    durationMs: 3,
    checks: [{ fullName: "works", outcome: "pass", durationMs: 1, location: null }],
  };
}

interface PartOptions {
  readonly name?: string;
  readonly files: readonly string[];
  readonly run?: Partial<PartNodeTest>;
  readonly shard?: { index: number; count: number };
  readonly header?: Partial<Part["header"]>;
}

function part(options: PartOptions): NamedPart {
  const nodeTest: PartNodeTest = {
    execArgv: [
      "--import",
      "tsx",
      "--test",
      "--test-reporter=spec",
      "--test-reporter-destination=stdout",
      "--test-reporter",
      "/opt/squeal/dist/ci/node-test-reporter.mjs",
      "--test-reporter-destination",
      "stderr",
    ],
    cwd: "",
    version: "v26.13.0",
    nodeBuild: BUILD,
    env: {},
    nodeOptions: [],
    ...options.run,
  };
  return {
    file: options.name ?? "squeal-part-1.json",
    part: {
      format: PART_FORMAT,
      header: {
        squealVersion: "0.0.0-test",
        keyFormat: KEY_FORMAT_VERSION,
        runner: "node-test",
        runnerVersion: nodeTest.version,
        commit: COMMIT,
        dirty: false,
        shard: options.shard ?? { index: 1, count: 1 },
        createdAt: 0,
        source: { kind: "local" },
        end: "completed",
        observing: true,
        nodeTest,
        ...options.header,
      },
      projects: [],
      testFiles: options.files.map(file),
      evidence: {},
    },
  };
}

/** Each kept file as `project:path`. */
function kept(assignment: ReturnType<typeof assignNodeTest>): string[] {
  return assignment.parts.flatMap(({ part }) =>
    part.testFiles.map((f) => `${f.project}:${f.path}`),
  );
}

describe("entryArgv (D26.1)", () => {
  it("drops the flags the daemon sets itself, in either form, and keeps the rest in order", () => {
    expect(
      entryArgv([
        "--enable-source-maps",
        "--import",
        "tsx",
        "--test",
        "--test-reporter=spec",
        "--test-reporter-destination",
        "stdout",
        "--test-shard=2/3",
        "--test-concurrency",
        "4",
        "--experimental-strip-types",
      ]),
    ).toEqual(["--import", "tsx", "--experimental-strip-types"]);
  });
});

describe("assignNodeTest (spec 018 D26)", () => {
  it("gives each file to the entry whose cwd and flags its process ran with and that lists it", () => {
    const unit = entry("unit", ["test/a.test.ts", "test/b.test.ts"]);
    const other = entry("scripts", ["test/a.test.ts"], { argv: [] });
    const result = assignNodeTest(
      [part({ files: ["test/a.test.ts", "test/b.test.ts"] })],
      [unit, other],
      COMMIT,
    );
    expect(kept(result)).toEqual(["unit:test/a.test.ts", "unit:test/b.test.ts"]);
    expect(result.leftOut).toBe(0);
    expect(result.lines).toEqual([]);
  });

  it("leaves out a process no entry ran with, naming its directory and flags", () => {
    const result = assignNodeTest(
      [part({ files: ["test/a.test.ts"], run: { cwd: "packages/x" } })],
      [entry("unit", ["test/a.test.ts"])],
      COMMIT,
    );
    expect(kept(result)).toEqual([]);
    expect(result.leftOut).toBe(1);
    expect(result.lines).toEqual([
      'squeal-part-1.json: no nodeTest entry here runs in packages/x with flags ["--import","tsx"]: left out (1 test file)',
    ]);
  });

  it("leaves out a file no entry lists, or two entries list, and keeps the rest", () => {
    const result = assignNodeTest(
      [part({ files: ["test/a.test.ts", "test/b.test.ts", "test/c.test.ts"] })],
      [entry("unit", ["test/a.test.ts", "test/c.test.ts"]), entry("again", ["test/c.test.ts"])],
      COMMIT,
    );
    expect(kept(result)).toEqual(["unit:test/a.test.ts"]);
    expect(result.leftOut).toBe(2);
    expect(result.lines).toEqual([
      "no nodeTest entry here lists test/b.test.ts: left out",
      "two nodeTest entries here list test/c.test.ts (unit, again): left out",
    ]);
  });

  it("leaves out an entry whose Node here is another version or build (D26.2), keeping the others", () => {
    const unit = entry("unit", ["test/a.test.ts"]);
    const old = entry("old", ["old/a.test.ts"], { argv: [] });
    const result = assignNodeTest(
      [
        part({ name: "p1.json", files: ["test/a.test.ts"], run: { version: "v24.21.0" } }),
        part({ name: "p2.json", files: ["old/a.test.ts"], run: { execArgv: ["--test"] } }),
      ],
      [unit, old],
      COMMIT,
    );
    expect(kept(result)).toEqual(["old:old/a.test.ts"]);
    expect(result.lines).toEqual([
      'node:test ran on Node v24.21.0; project "unit" runs v26.13.0 here: left out (1 test file)',
    ]);

    const build = assignNodeTest(
      [part({ files: ["test/a.test.ts"], run: { nodeBuild: "d".repeat(64) } })],
      [unit],
      COMMIT,
    );
    expect(kept(build)).toEqual([]);
    expect(build.lines).toEqual([
      'node:test ran on another build of Node v26.13.0 than project "unit" runs here: left out (1 test file)',
    ]);

    const none = assignNodeTest(
      [part({ files: ["test/a.test.ts"] })],
      [{ ...unit, node: null }],
      COMMIT,
    );
    expect(none.lines).toEqual([
      'project "unit": its Node does not run here: left out (1 test file)',
    ]);
  });

  it("leaves out an entry whose variable the run saw with another value, named but never shown (D26.3)", () => {
    const unit = entry("unit", ["test/a.test.ts"], { env: { TZ: "UTC", SECRET: "s3cr3t" } });
    const same = { TZ: configFieldHash("UTC"), SECRET: configFieldHash("s3cr3t") };
    const ok = assignNodeTest(
      [part({ files: ["test/a.test.ts"], run: { env: same } })],
      [unit],
      COMMIT,
    );
    expect(kept(ok)).toEqual(["unit:test/a.test.ts"]);

    const other = assignNodeTest(
      [part({ files: ["test/a.test.ts"], run: { env: { ...same, SECRET: null } } })],
      [unit],
      COMMIT,
    );
    expect(kept(other)).toEqual([]);
    expect(other.lines).toEqual([
      'node:test ran with another value of SECRET than project "unit" sets: left out (1 test file)',
    ]);
    expect(other.lines.join("\n")).not.toContain("s3cr3t");
  });

  it("takes an entry's own --test-shard set when complete, apart from other entries' (D26.4)", () => {
    const unit = entry("unit", ["test/a.test.ts", "test/b.test.ts"]);
    const scripts = entry("scripts", ["scripts/x.test.ts"], { argv: [] });
    const shard = (index: number, files: string[]) =>
      part({ name: `u${index}.json`, files, shard: { index, count: 2 } });
    const solo = part({
      name: "s.json",
      files: ["scripts/x.test.ts"],
      run: { execArgv: ["--test"] },
    });

    const complete = assignNodeTest(
      [shard(1, ["test/a.test.ts"]), shard(2, ["test/b.test.ts"]), solo],
      [unit, scripts],
      COMMIT,
    );
    expect(kept(complete).sort()).toEqual([
      "scripts:scripts/x.test.ts",
      "unit:test/a.test.ts",
      "unit:test/b.test.ts",
    ]);

    const missing = assignNodeTest([shard(1, ["test/a.test.ts"]), solo], [unit, scripts], COMMIT);
    expect(kept(missing)).toEqual(["scripts:scripts/x.test.ts"]);
    expect(missing.lines).toEqual([
      'project "unit" has no part of shard 2/2: left out (1 test file)',
    ]);

    const twice = assignNodeTest(
      [shard(1, ["test/a.test.ts"]), shard(1, ["test/b.test.ts"]), shard(2, [])],
      [unit],
      COMMIT,
    );
    expect(kept(twice)).toEqual([]);
    expect(twice.lines).toEqual([
      'project "unit" has two parts of shard 1/2: left out (2 test files)',
    ]);
  });

  it("leaves out the files of a part of another commit or of a run that did not complete", () => {
    const unit = entry("unit", ["test/a.test.ts", "test/b.test.ts"]);
    const result = assignNodeTest(
      [
        part({ name: "p1.json", files: ["test/a.test.ts"], shard: { index: 1, count: 2 } }),
        part({
          name: "p2.json",
          files: ["test/b.test.ts"],
          shard: { index: 2, count: 2 },
          header: { end: "crashed" },
        }),
      ],
      [unit],
      COMMIT,
    );
    expect(kept(result)).toEqual(["unit:test/a.test.ts"]);
    expect(result.lines).toEqual([
      "p2.json: a run that did not complete (crashed): left out (1 test file)",
    ]);

    const elsewhere = assignNodeTest([part({ files: ["test/a.test.ts"] })], [unit], "e".repeat(40));
    expect(kept(elsewhere)).toEqual([]);
    expect(elsewhere.lines[0]).toContain(
      `of commit ${COMMIT}, and this checkout is at ${"e".repeat(40)}`,
    );
  });

  it("names why a part holds no file, and counts it as its shard", () => {
    const why = "this node:test command names no Squeal reporter";
    const unit = entry("unit", ["test/a.test.ts"]);
    const result = assignNodeTest(
      [
        part({ name: "p1.json", files: ["test/a.test.ts"], shard: { index: 1, count: 2 } }),
        part({ name: "p2.json", files: [], shard: { index: 2, count: 2 }, run: { noFiles: why } }),
      ],
      [unit],
      COMMIT,
    );
    expect(kept(result)).toEqual(["unit:test/a.test.ts"]);
    expect(result.lines).toEqual([`p2.json: ${why}`]);
    expect(result.leftOut).toBe(0);
  });
});
