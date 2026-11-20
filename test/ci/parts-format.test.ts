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
 * Spec 018 D25 (row 018-47): format 5 names the runner and holds a
 * node:test part's `nodeTest` header; formats 3 and 4 still read, as
 * Vitest parts. Spec 018 D32 (row 018-57): parts are written as format 6,
 * which adds the endpoint hashes (`stable`, `unstable`) and the touched
 * paths; format 5 still reads, without them.
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
      preloads: ["test/setup.mjs"],
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
  stable: { "data/made.txt": "d".repeat(40), "data/gone.txt": null },
  unstable: ["data/changed.txt"],
  touched: ["out/", "out/a.txt"],
};

describe("part formats", () => {
  it("writes format 6 and reads a node:test part back as written", () => {
    expect(PART_FORMAT).toBe("squeal-ci-part/6");
    const dir = mkdtempSync(join(tmpdir(), "squeal-parts-format-"));
    expect(readPart(writePart(dir, NODE_PART))).toEqual(NODE_PART);
  });

  it("reads touched as all", () => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-parts-format-"));
    const part: Part = { ...NODE_PART, touched: "all" };
    expect(readPart(writePart(dir, part))).toEqual(part);
  });

  it("reads a format 5 part, which has no endpoint hash or touched path", () => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-parts-format-"));
    const file = join(dir, "old.json");
    const { stable: _s, unstable: _u, touched: _t, ...rest } = NODE_PART;
    const old = { ...rest, format: "squeal-ci-part/5" };
    writeFileSync(file, JSON.stringify(old));
    const read = readPart(file);
    expect(read).toEqual(old);
    expect(typeof read === "string" ? read : read.touched).toBeUndefined();
  });

  it.each(["squeal-ci-part/3", "squeal-ci-part/4"])("reads a %s part", (format) => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-parts-format-"));
    const file = join(dir, "old.json");
    const { nodeTest: _, ...header } = NODE_PART.header;
    const { stable: _s, unstable: _u, touched: _t, ...rest } = NODE_PART;
    const old = { ...rest, format, header: { ...header, runner: "vitest" } };
    writeFileSync(file, JSON.stringify(old));
    expect(readPart(file)).toEqual(old);
  });

  it.each([
    [{ stable: ["a"] }, "a bad stable"],
    [{ stable: { a: 1 } }, "a bad stable"],
    [{ unstable: "a" }, "a bad unstable"],
    [{ touched: "some" }, "a bad touched"],
    [{ touched: [1] }, "a bad touched"],
  ])("refuses a part with %j", (fields, why) => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-parts-format-"));
    const file = join(dir, "bad.json");
    writeFileSync(file, JSON.stringify({ ...NODE_PART, ...fields }));
    expect(readPart(file)).toBe(`${file}: a part with ${why}`);
  });

  it("names a format it does not read", () => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-parts-format-"));
    const file = join(dir, "new.json");
    writeFileSync(file, JSON.stringify({ ...NODE_PART, format: "squeal-ci-part/7" }));
    expect(readPart(file)).toContain('format "squeal-ci-part/7", not "squeal-ci-part/3"');
  });
});
