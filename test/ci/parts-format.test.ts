import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NODE_TEST_UNASSIGNED,
  PART_FORMAT,
  type Part,
  readPart,
  writePart,
} from "../../src/core/ci/parts.js";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";

/*
 * Spec 018 D25 (row 018-47): parts are written as format 5, which names
 * the runner and holds a node:test part's `nodeTest` header; formats 3 and
 * 4 still read, as Vitest parts.
 */

const NODE_PART: Part = {
  format: PART_FORMAT,
  header: {
    squealVersion: "0.0.0",
    keyFormat: KEY_FORMAT_VERSION,
    runner: "node-test",
    runnerVersion: "v24.21.0",
    commit: null,
    dirty: false,
    shard: { index: 2, count: 3 },
    createdAt: 0,
    source: { kind: "local" },
    end: "completed",
    observing: true,
    nodeTest: {
      execArgv: ["--test", "--import", "tsx"],
      cwd: "",
      version: "v24.21.0",
      nodeBuild: "b".repeat(64),
      env: { TZ: "c".repeat(64), LANG: null },
    },
  },
  projects: [],
  testFiles: [
    {
      project: NODE_TEST_UNASSIGNED,
      path: "test/a.test.mjs",
      outcome: "pass",
      durationMs: 3,
      checks: [{ fullName: "a", outcome: "pass", durationMs: 1, location: { line: 3, column: 1 } }],
    },
  ],
  evidence: {},
};

describe("part formats", () => {
  it("writes format 5 and reads a node:test part back as written", () => {
    expect(PART_FORMAT).toBe("squeal-ci-part/5");
    const dir = mkdtempSync(join(tmpdir(), "squeal-parts-format-"));
    expect(readPart(writePart(dir, NODE_PART))).toEqual(NODE_PART);
  });

  it.each(["squeal-ci-part/3", "squeal-ci-part/4"])("reads a %s part", (format) => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-parts-format-"));
    const file = join(dir, "old.json");
    const { nodeTest: _, ...header } = NODE_PART.header;
    const old = { ...NODE_PART, format, header: { ...header, runner: "vitest" } };
    writeFileSync(file, JSON.stringify(old));
    expect(readPart(file)).toEqual(old);
  });

  it("names a format it does not read", () => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-parts-format-"));
    const file = join(dir, "new.json");
    writeFileSync(file, JSON.stringify({ ...NODE_PART, format: "squeal-ci-part/6" }));
    expect(readPart(file)).toContain('format "squeal-ci-part/6", not "squeal-ci-part/3"');
  });
});
