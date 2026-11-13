import { describe, expect, it } from "vitest";
import type { GateReport } from "../../src/core/code/gate/report.js";
import { code, edit, ownHomeAndTmp, repo, SLOW } from "./code-gate-fixture.js";

/*
 * Row 020-50 (#207; research `013-vitest-runner/research/issue-207.md`):
 * when Vitest logs that it timed out terminating a file's worker, the
 * gate's stderr says whether the file's result counts in this report, from
 * the final completion and error evidence. Verdict, exit and the JSON
 * report stay as they are. The research probe's shapes: one forks worker,
 * a changed `value()`, a teardown threshold of 1 ms to force the warning.
 */

/** One forks worker, as the probe; `teardownTimeout` absent keeps Vitest's 10 s. */
const config = (teardownTimeout?: number) =>
  `export default { test: { include: ["test/**/*.test.ts"], pool: "forks", maxWorkers: 1${
    teardownTimeout === undefined ? "" : `, teardownTimeout: ${teardownTimeout}`
  } } };\n`;

const testFile = (name: string, body: string, head = "") =>
  `import { expect, it } from "vitest";\nimport { value } from "../src/value";\n${head}\nit("${name}", () => ${body});\n`;

const PASS = testFile("completed pass", "expect(value()).toBe(1)");

function files(teardownTimeout?: number, more: Readonly<Record<string, string>> = {}) {
  return {
    "package.json": `${JSON.stringify({ name: "gate-teardown", private: true, type: "module" })}\n`,
    "vitest.config.ts": config(teardownTimeout),
    "src/value.ts": "export function value(): number {\n  return 1;\n}\n",
    "test/pass.test.ts": PASS,
    ...more,
  };
}

/** The gate on `files` committed, with `value()` changed as the probe changes it. */
async function gate(committed: Readonly<Record<string, string>>) {
  ownHomeAndTmp();
  const root = repo(committed);
  edit(root, { "src/value.ts": "export function value(): number {\n  return 1 + 0;\n}\n" });
  const ran = await code(root, ["--base", "main", "--json"]);
  const report = JSON.parse(ran.stdout) as GateReport;
  const lines = ran.stderr.split("\n").filter((line) => line.includes("timed out terminating"));
  return { ran, report, lines, run: report.runs.find((r) => r.runner === "vitest") };
}

const lead = (path: string) => `squeal code: Vitest timed out terminating the worker of ${path}; `;
const COUNTS = "the file completed, so its result counts in this report";
const NOT_COUNTED = "the report lists the file as not finished, so its result does not count.";

describe("squeal code --base: Vitest's teardown timeout (#207)", () => {
  it("says a warned passing file's result counts; pass and exit 0 stay", SLOW, async () => {
    const { ran, report, lines, run } = await gate(files(1));

    expect(lines).toEqual([`${lead("test/pass.test.ts")}${COUNTS}.`]);
    expect(ran.code).toBe(0);
    expect(report.verdict).toBe("pass");
    expect(run?.completed).toEqual(["test/pass.test.ts"]);
    expect(run?.notFinished).toEqual([]);
  });

  it("keeps a separate assertion failure failed, and says both results count", SLOW, async () => {
    const failing = testFile("real assertion failure", "expect(value()).toBe(99)");
    const { ran, report, lines, run } = await gate(files(1, { "test/failure.test.ts": failing }));

    expect(lines).toEqual([
      `${lead("test/failure.test.ts")}${COUNTS}, 1 failed test included.`,
      `${lead("test/pass.test.ts")}${COUNTS}.`,
    ]);
    expect(run?.completed).toEqual(["test/failure.test.ts", "test/pass.test.ts"]);
    expect(run?.failed).toEqual([
      { path: "test/failure.test.ts", tests: ["real assertion failure"] },
    ]);
    expect(report.verdict).toBe("incomplete");
    expect(ran.code).toBe(3);
  });

  it("says a warned file of a run whose worker was killed does not count", SLOW, async () => {
    const killed = testFile("worker killed", "{ value(); process.kill(process.pid, 'SIGKILL'); }");
    const { ran, report, lines, run } = await gate(files(1, { "test/crash.test.ts": killed }));

    // The killed worker's run is not trusted: nothing completed, whatever the warning named.
    expect(run?.completed).toEqual([]);
    expect(run?.notFinished).toEqual(["test/crash.test.ts", "test/pass.test.ts"]);
    expect(lines).toContain(`${lead("test/pass.test.ts")}${NOT_COUNTED}`);
    for (const line of lines) expect(line).toMatch(/does not count\.$/);
    expect(report.verdict).toBe("incomplete");
    expect(ran.code).toBe(3);
  });

  it("prints nothing new for a normal teardown", SLOW, async () => {
    const { ran, report, lines } = await gate(files());

    expect(lines).toEqual([]);
    expect(ran.stderr).not.toContain("Vitest timed out");
    expect(report.verdict).toBe("pass");
    expect(ran.code).toBe(0);
  });

  it("explains a warning Vitest logs after the run, while the gate closes it", SLOW, async () => {
    // The default threshold's shape: the worker outlives it after the run ended, so Vitest
    // logs the line while its close awaits the worker. The file holds its worker's stop.
    const hold = `process.on("message", (m) => {\n  if ((m as { type?: string } | null)?.type === "stop") Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2500);\n});\n`;
    const held = testFile("completed pass", "expect(value()).toBe(1)", hold);
    const { ran, report, lines } = await gate(files(1000, { "test/pass.test.ts": held }));

    expect(lines).toEqual([`${lead("test/pass.test.ts")}${COUNTS}.`]);
    expect(report.verdict).toBe("pass");
    expect(ran.code).toBe(0);
  });
});
