import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openFixture, ref, SLOW } from "./helpers.js";

/*
 * Review wave-13bp B1 to B3 (task 001-389): every rejected run closes its
 * instance, so the next run calls the `globalSetup` again (D4), and a failed
 * start is blamed only on the run's own projects (D5). Each case is the
 * review's probe on the real adapter.
 */

const TEST = [
  'import { expect, test } from "vitest";',
  'test("passes", () => expect(1).toBe(1));',
  "",
].join("\n");

const logs: string[] = [];
afterEach(() => {
  for (const dir of logs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A call log outside the fixture, so writing it is no edit of the worktree. */
function callLog() {
  const dir = mkdtempSync(join(tmpdir(), "squeal-setup-calls-"));
  logs.push(dir);
  const file = join(dir, "calls.log");
  const count = () => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").length : 0);
  return { file, count };
}

/** A global setup that logs its call, then runs `body`. */
const setup = (calls: string, body: string) =>
  [
    'import { appendFileSync } from "node:fs";',
    "export default async function setup() {",
    `  appendFileSync(${JSON.stringify(calls)}, "call\\n");`,
    `  ${body}`,
    "}",
    "",
  ].join("\n");

const singleProject = (calls: string, body: string) => ({
  "vitest.config.ts": [
    "export default {",
    '  test: { include: ["test/one.test.ts"], globalSetup: ["./boot.ts"] },',
    "};",
    "",
  ].join("\n"),
  "boot.ts": setup(calls, body),
  "test/one.test.ts": TEST,
});

describe("a setup that rejects during a timeout's cancellation (B1)", SLOW, () => {
  it("closes the instance, so the next run calls the setup again and completes no file", async () => {
    const calls = callLog();
    const body = 'await new Promise((r) => setTimeout(r, 150)); throw new Error("bootstrap");';
    const fixture = await openFixture("basic", singleProject(calls.file, body));
    const files = [ref("test/one.test.ts")];

    const first = await fixture.adapter.run(files, fixture.runOptions({ timeoutMs: 50 }));
    expect(first.end).toBe("timed-out");
    expect(first.completedFiles).toEqual([]);
    expect(first.startupFailure?.setupFile).toBe("boot.ts");
    expect(calls.count()).toBe(1);

    const second = await fixture.adapter.run(files, fixture.runOptions({ timeoutMs: 10_000 }));
    expect(calls.count()).toBe(2);
    expect(second.completedFiles).toEqual([]);
    expect(second.startupFailure?.error.message).toBe("bootstrap");
  });
});

describe("a setup that throws a value that is no Error (B2)", SLOW, () => {
  it.each([
    ["null", "throw null;", "the run rejected with null, not an Error"],
    ["undefined", "throw undefined;", "the run rejected with undefined, not an Error"],
    ["a string", 'throw "database is down";', "database is down"],
  ])("closes the instance for %s and keeps the text", async (_, body, message) => {
    const calls = callLog();
    const fixture = await openFixture("basic", singleProject(calls.file, body));
    const files = [ref("test/one.test.ts")];

    for (const run of [1, 2]) {
      const report = await fixture.adapter.run(files, fixture.runOptions({ timeoutMs: 10_000 }));
      expect(calls.count()).toBe(run);
      expect(report.end).toBe("crashed");
      expect(report.completedFiles).toEqual([]);
      expect(report.startupFailure?.projects).toEqual([""]);
      expect(report.startupFailure?.error.message).toBe(message);
    }
  });
});

describe("a setup file two projects share (B3)", SLOW, () => {
  it("is blamed on the run's project, not the first project that lists it", async () => {
    const calls = callLog();
    const fixture = await openFixture("basic", {
      "vitest.config.ts": [
        "export default {",
        "  test: {",
        "    projects: [",
        '      { test: { name: "a", include: ["test/a/**/*.test.ts"], globalSetup: ["./boot.ts"] } },',
        '      { test: { name: "b", include: ["test/b/**/*.test.ts"], globalSetup: ["./boot.ts"] } },',
        "    ],",
        "  },",
        "};",
        "",
      ].join("\n"),
      "boot.ts": setup(calls.file, 'throw new Error("bootstrap");'),
      "test/b/one.test.ts": TEST,
    });
    const files = [ref("test/b/one.test.ts", "b")];

    for (const run of [1, 2]) {
      const report = await fixture.adapter.run(files, fixture.runOptions({ timeoutMs: 10_000 }));
      expect(calls.count()).toBe(run);
      expect(report.startupFailure?.projects).toEqual(["b"]);
      expect(report.startupFailure?.setupFile).toBe("boot.ts");
    }
  });
});
