import { describe, expect, it } from "vitest";
import {
  type NamedPart,
  partsRefusal,
  type RunView,
  runDifferences,
} from "../../src/core/ci/export-check.js";
import {
  PART_FORMAT,
  type Part,
  type PartFile,
  type PartShard,
  type RunDescriptor,
  snapshotFields,
} from "../../src/core/ci/parts.js";
import { configFieldHash } from "../../src/core/keys/environment-descriptor.js";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";

/*
 * Spec 018 D9 (row 018-17; review of 0.1.421 B2, B3, S1): each set of parts
 * `squeal ci export` refuses, with the reason named: a part from another key
 * format, one that did not complete, parts of different commits or of
 * another commit than the checkout, a shard set with a gap, a run that could
 * write snapshots, a test file in two parts, and one project in two
 * environments, its snapshot options compared field by field. D10's fields
 * and the fields Squeal's own instance sets may differ.
 */

const COMMIT = "a".repeat(40);

const DESCRIPTOR: RunDescriptor = {
  keyFormat: KEY_FORMAT_VERSION,
  project: "",
  runnerName: "vitest",
  runnerVersion: "5.0.3",
  adapterVersion: "3+observe.6",
  nodeVersion: "v24.22.1",
  platform: "linux",
  arch: "x64",
  env: { names: [], hash: "e" },
  config: {
    allowOnly: configFieldHash(false),
    coverage: "c1",
    root: "r",
    snapshotOptions: "s1",
  },
  ci: true,
  browser: false,
};

/** The snapshot options of a run with `CI=true`, `updateSnapshot` aside. */
const SNAPSHOT = snapshotFields(
  JSON.stringify({
    snapshotOptions: { updateSnapshot: "none", expand: false, snapshotFormat: {} },
  }),
);

function file(path: string): PartFile {
  return { project: "", path, outcome: "pass", durationMs: 1, checks: [] };
}

function part(
  files: readonly string[],
  change: {
    header?: Partial<Part["header"]>;
    descriptor?: Partial<RunDescriptor>;
    update?: string;
    snapshot?: Record<string, string>;
  } = {},
): Part {
  return {
    format: PART_FORMAT,
    header: {
      squealVersion: "0.0.0",
      keyFormat: KEY_FORMAT_VERSION,
      runner: "vitest",
      runnerVersion: "5.0.3",
      commit: COMMIT,
      dirty: false,
      clean: true,
      untracked: [],
      shard: { index: 1, count: 1 },
      createdAt: 0,
      source: { kind: "local" },
      end: "completed",
      observing: true,
      ...change.header,
    },
    projects: [
      {
        descriptor: { ...DESCRIPTOR, ...change.descriptor },
        updateSnapshot: change.update ?? "none",
        snapshotOptions: change.snapshot ?? SNAPSHOT,
      },
    ],
    testFiles: files.map(file),
  };
}

/** `parts` as shards 1 to n of one run, in order. */
const named = (...parts: Part[]): NamedPart[] =>
  parts.map((p, i) => ({
    file: `p${i + 1}`,
    part: { ...p, header: { ...p.header, shard: { index: i + 1, count: parts.length } } },
  }));

/** `part` as shard `index/count`, named `file`. */
const sharded = (file: string, part: Part, [index, count]: [number, number]): NamedPart => ({
  file,
  part: { ...part, header: { ...part.header, shard: { index, count } satisfies PartShard } },
});

const view = (descriptor: RunDescriptor, snapshotOptions = SNAPSHOT): RunView => ({
  descriptor,
  snapshotOptions,
});

describe("the parts ci export refuses (spec 018 D9)", () => {
  it("takes two disjoint shards of one commit and environment", () => {
    const shards = named(part(["test/a.test.ts"]), part(["test/b.test.ts"]));
    expect(partsRefusal(shards, COMMIT)).toBeNull();
  });

  it.each([
    [
      "key-format",
      named(part(["a"]), part(["b"], { header: { keyFormat: KEY_FORMAT_VERSION + 1 } })),
      `p2 was made with key format ${KEY_FORMAT_VERSION + 1}`,
    ],
    [
      "incomplete",
      named(part([], { header: { end: "crashed" } })),
      "p1 is of a run that did not complete (crashed)",
    ],
    [
      "incomplete",
      named(part([], { header: { end: "interrupted" } })),
      "did not complete (interrupted)",
    ],
    ["no-commit", named(part(["a"], { header: { commit: null } })), "p1 names no commit"],
    [
      "commits",
      named(part(["a"]), part(["b"], { header: { commit: "b".repeat(40) } })),
      `the parts come from different commits: ${COMMIT}, ${"b".repeat(40)}`,
    ],
    [
      "snapshot",
      named(part(["a"]), part(["b"], { update: "new" })),
      'p2 ran project "" with snapshot update "new"',
    ],
    [
      "duplicate",
      named(part(["test/a.test.ts"]), part(["test/a.test.ts"])),
      "test file test/a.test.ts is in two parts: p1 and p2",
    ],
    [
      "environment",
      named(part(["a"]), part(["b"], { descriptor: { nodeVersion: "v26.13.0" } })),
      'p1 and p2 ran project "" in different environments: Node v24.22.1 in the export, v26.13.0 here',
    ],
  ] as const)("refuses %s: %s", (kind, parts, text) => {
    const refused = partsRefusal(parts, COMMIT);
    expect(refused?.kind).toBe(kind);
    expect(refused?.text).toContain(text);
  });

  it("refuses parts of another commit than the checkout's", () => {
    const refused = partsRefusal(named(part(["a"])), "c".repeat(40));
    expect(refused?.kind).toBe("checkout");
    expect(refused?.text).toContain(`this checkout is at ${"c".repeat(40)}`);
  });

  it("refuses a shard set with a gap, two parts of one shard or two shard counts", () => {
    const a = part(["test/a.test.ts"]);
    const b = part(["test/b.test.ts"]);
    const cases: [NamedPart[], string][] = [
      [[sharded("p1", a, [1, 2])], "no part of shard 2/2"],
      [[sharded("p2", b, [2, 3])], "no part of shard 1/3, 3/3"],
      [
        [sharded("p1", a, [1, 2]), sharded("p2", b, [1, 2]), sharded("p3", b, [2, 2])],
        "shard 1/2 has 2 parts: p1, p2",
      ],
      [[sharded("p1", a, [1, 2]), sharded("p2", b, [2, 3])], "runs of 2, 3 shards"],
      [[sharded("p1", a, [3, 2]), sharded("p2", b, [2, 2])], "p1 names shard 3/2"],
      [[], "no part to export"],
    ];
    for (const [parts, text] of cases) {
      const refused = partsRefusal(parts, COMMIT);
      expect(refused?.kind).toBe("shards");
      expect(refused?.text).toContain(text);
    }
    const whole = [sharded("p2", b, [2, 2]), sharded("p1", a, [1, 2])];
    expect(partsRefusal(whole, COMMIT)).toBeNull();
  });

  it("refuses two shards whose snapshot options differ in a field but the update mode", () => {
    const printed = { ...SNAPSHOT, snapshotFormat: configFieldHash({ printBasicPrototype: true }) };
    const refused = partsRefusal(named(part(["a"]), part(["b"], { snapshot: printed })), COMMIT);
    expect(refused?.kind).toBe("environment");
    expect(refused?.text).toContain("config fields snapshotOptions.snapshotFormat differ");
  });

  it("refuses parts of another commit than the checkout's", () => {
    const refused = partsRefusal(named(part(["a"])), "c".repeat(40));
    expect(refused?.kind).toBe("checkout");
    expect(refused?.text).toContain(`this checkout is at ${"c".repeat(40)}`);
  });

  it("takes shards that differ only in D10's fields and Squeal's own options", () => {
    const local = { ...DESCRIPTOR.config, allowOnly: configFieldHash(true), coverage: "c2" };
    const squeal = { ...local, includeTaskLocation: "t", snapshotOptions: "s2" };
    const exported = view(DESCRIPTOR);
    expect(runDifferences(exported, view({ ...DESCRIPTOR, config: squeal, ci: false }))).toEqual(
      [],
    );
    // A run with focused tests allowed is not a pass where they are rejected (D10).
    const back = runDifferences(view({ ...DESCRIPTOR, config: local }), exported);
    expect(back.map((d) => d.text)).toEqual(["config fields allowOnly differ"]);
    const other = { ...DESCRIPTOR.config, root: "elsewhere" };
    const differences = runDifferences(exported, view({ ...DESCRIPTOR, config: other }));
    expect(differences.map((d) => d.text)).toEqual(["config fields root differ"]);
  });

  it("compares every snapshot option but the update mode, field by field", () => {
    const options = (snapshotOptions: object) =>
      snapshotFields(JSON.stringify({ snapshotOptions }));
    const ci = options({ updateSnapshot: "none", expand: false, snapshotFormat: {} });
    const local = options({ updateSnapshot: "new", expand: false, snapshotFormat: {} });
    expect(runDifferences(view(DESCRIPTOR, ci), view(DESCRIPTOR, local))).toEqual([]);
    const format = options({
      updateSnapshot: "none",
      expand: false,
      snapshotFormat: { indent: 4 },
    });
    const texts = runDifferences(view(DESCRIPTOR, ci), view(DESCRIPTOR, format)).map((d) => d.text);
    expect(texts).toEqual(["config fields snapshotOptions.snapshotFormat differ"]);
  });
});
