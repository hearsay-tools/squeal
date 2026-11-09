import { describe, expect, it } from "vitest";
import { type NamedPart, partsRefusal, runDifferences } from "../../src/core/ci/export-check.js";
import {
  PART_FORMAT,
  type Part,
  type PartFile,
  type RunDescriptor,
} from "../../src/core/ci/parts.js";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";

/*
 * Spec 018 D9 (row 018-17): each set of parts `squeal ci export` refuses,
 * with the reason named: a part from another key format, one that did not
 * complete, parts of different commits or of another commit than the
 * checkout, a run that could write snapshots, a test file in two parts, and
 * one project in two environments. D10's fields and the fields Squeal's
 * own instance sets may differ.
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
  config: { allowOnly: "1", coverage: "c1", root: "r", snapshotOptions: "s1" },
  ci: true,
  browser: false,
};

function file(path: string): PartFile {
  return { project: "", path, outcome: "pass", durationMs: 1, checks: [] };
}

function part(
  files: readonly string[],
  change: {
    header?: Partial<Part["header"]>;
    descriptor?: Partial<RunDescriptor>;
    update?: string;
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
      },
    ],
    testFiles: files.map(file),
  };
}

const named = (...parts: Part[]): NamedPart[] =>
  parts.map((p, i) => ({ file: `p${i + 1}`, part: p }));

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

  it("takes shards that differ only in D10's fields and Squeal's own options", () => {
    const config = { ...DESCRIPTOR.config, allowOnly: "0", coverage: "c2", snapshotOptions: "s2" };
    expect(runDifferences(DESCRIPTOR, { ...DESCRIPTOR, config, ci: false })).toEqual([]);
    const other = { ...DESCRIPTOR.config, root: "elsewhere" };
    const differences = runDifferences(DESCRIPTOR, { ...DESCRIPTOR, config: other });
    expect(differences.map((d) => d.text)).toEqual(["config fields root differ"]);
  });
});
