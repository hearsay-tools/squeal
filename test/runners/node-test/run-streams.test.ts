import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEvents } from "../../../src/runners/node-test/run/events.js";
import { type FileReport, readFileStream } from "../../../src/runners/node-test/run/report.js";
import { WorktreePaths } from "../../../src/runners/vitest/paths.js";

/**
 * Result mapping on event streams recorded under Node 22.23.3 and 24.21.0
 * (`test/fixtures/node-test/streams/`, one file per process as Squeal runs
 * them). Both versions must map to the same results.
 */

const STREAMS = resolve(import.meta.dirname, "../../fixtures/node-test/streams");
const ROOT = "/squeal-root";
const FIXTURES = `${ROOT}/fixtures`;
const paths = new WorktreePaths(ROOT);

function read(version: number, name: string, arg: string, path: string): FileReport {
  const text = readFileSync(join(STREAMS, `node${version}`, `${name}.ndjson`), "utf8");
  const events = parseEvents(text.replaceAll("<fixtures>", FIXTURES));
  return readFileStream({ testFile: { project: "p", path }, arg, events }, paths);
}

const edge = (version: number, name: string, file = `test/${name}.test.ts`) =>
  read(version, name, file, `fixtures/edge/${file}`);
const outcomes = (version: number) =>
  read(version, "outcomes", "outcomes.test.ts", "fixtures/streams/outcomes.test.ts");
const summary = (report: FileReport) =>
  report.results.map((r) => [r.check.fullName, r.outcome] as const);

describe.each([22, 24])("recorded streams of Node %i", (version) => {
  it("names checks from nesting, suites as prefixes only, skip and todo as skip", () => {
    const report = outcomes(version);
    expect(report.completed).toBe(true);
    expect(summary(report)).toEqual([
      ["suite > leaf", "pass"],
      ["suite > inner > deep", "pass"],
      ["suite > skipped", "skip"],
      ["suite > todo", "skip"],
      ["hooked > behind the hook", "fail"],
      ["parent > child", "pass"],
      ["parent > broken child", "fail"],
      ["parent", "pass"],
      ["own failure > child ok", "pass"],
      ["own failure", "fail"],
      ["skip option", "skip"],
      ["todo option", "skip"],
      ["failing todo", "skip"],
      ["same", "pass"],
      ["same (line 32)", "pass"],
    ]);
    // failures of named checks: the file itself loaded
    expect(report.fileError).toBeNull();
  });

  it("passes a test whose only failure is a failing subtest, and fails the subtest", () => {
    const results = new Map(outcomes(version).results.map((r) => [r.check.fullName, r]));
    expect(results.get("parent")).toMatchObject({ outcome: "pass", errors: [] });
    const broken = results.get("parent > broken child");
    expect(broken?.errors[0]).toMatchObject({
      name: "AssertionError",
      location: { path: "fixtures/streams/outcomes.test.ts", line: 20 },
    });
    // a failure in the parent's own body is the parent's
    expect(results.get("own failure")?.errors[0]?.message).toBe("parent body failed");
  });

  it("gives a test cancelled by its suite's hook the hook's error too", () => {
    const behind = outcomes(version).results.find(
      (r) => r.check.fullName === "hooked > behind the hook",
    );
    expect(behind?.errors.map((e) => e.message)).toEqual([
      "test did not finish before its parent and was cancelled",
      "before failed",
    ]);
  });

  it("maps a failed assertion to a CheckError at its source-mapped line", () => {
    const report = edge(version, "fail");
    expect(report.completed).toBe(true);
    expect(summary(report)).toEqual([
      ["passes beside the failure", "pass"],
      ["fails", "fail"],
    ]);
    const [error] = report.results[1]?.errors ?? [];
    expect(error).toMatchObject({
      name: "AssertionError",
      location: { path: "fixtures/edge/test/fail.test.ts", line: 5 },
      diff: null,
    });
    expect(error?.message).toMatch(/^Expected values to be strictly equal/);
    expect(error?.stack).not.toContain(FIXTURES);
    expect(report.results[0]?.location).toEqual({
      path: "fixtures/edge/test/fail.test.ts",
      line: 4,
      column: 1,
    });
  });

  it("suffixes duplicate full names with their original lines", () => {
    expect(edge(version, "duplicate").results.map((r) => r.check.fullName)).toEqual([
      "suite > same name",
      "suite > same name (line 6)",
      "same name",
      "same name (line 9)",
    ]);
  });

  it.each([
    ["syntax", /Transform failed with 1 error: fixtures\/edge\/test\/syntax\.test\.ts:3:14: ERROR/],
    ["missing-import", /^Error \[ERR_MODULE_NOT_FOUND\]: Cannot find module .*does-not-exist\.js/],
  ])("makes %s one FileLevelError with the stderr text", (name, headline) => {
    const report = edge(version, name);
    expect(report.completed).toBe(true);
    expect(report.results).toEqual([]);
    expect(report.fileError?.testFile).toEqual({
      project: "p",
      path: `fixtures/edge/test/${name}.test.ts`,
    });
    expect(report.fileError?.errors).toHaveLength(1);
    const [error] = report.fileError?.errors ?? [];
    expect(error?.message).toMatch(headline);
    expect(error?.stack).toMatch(/Node\.js v\d+/);
  });

  it("locates a syntax error at its line", () => {
    expect(edge(version, "syntax").fileError?.errors[0]?.location).toEqual({
      path: "fixtures/edge/test/syntax.test.ts",
      line: 3,
      column: 14,
    });
  });

  it("does not complete a file whose process was killed before its wrapper ended", () => {
    const report = edge(version, "busy-loop");
    expect(report).toMatchObject({ completed: false, results: [], fileError: null });
  });

  it("reports the wrapper's whole-process duration", () => {
    expect(edge(version, "pass").durationMs).toBeGreaterThan(0);
  });

  // Evidence for one file per process (streams/README.md): in a shared process the pass file's
  // wrapper completed behind the hung file, but its test results never reached the stream.
  it("does not complete a file whose wrapper ended but whose report was held back", () => {
    const report = edge(version, "ordering", "test/pass.test.ts");
    expect(report.completed).toBe(false);
    expect(report.results).toEqual([]);
    const text = readFileSync(join(STREAMS, `node${version}`, "ordering.ndjson"), "utf8");
    expect(text).toContain('"name":"test/pass.test.ts"');
    expect(text).not.toContain('"type":"test:pass"');
  });
});
