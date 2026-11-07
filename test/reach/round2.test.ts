import { describe, expect, it } from "vitest";
import { formatReach } from "../../src/cli/reach-format.js";
import { buildReport, type ReportOptions } from "../../src/core/reach/report.js";
import type { ReachSnapshot } from "../../src/core/reach/types.js";
import { fakeGraph, record, snapshot, testFile, UNKNOWN } from "./fixture.js";

/*
 * Rows 015-120 to 015-122 (`lessons.md` "Edit reach, round 2", defects 2,
 * 3 and 5): one regression each, from the proof's case in small.
 */

const OPTIONS: ReportOptions = { paths: null, limit: null, command: "squeal", listed: 3 };
const report = (snap: ReachSnapshot, options: Partial<ReportOptions> = {}) =>
  buildReport(snap, { ...OPTIONS, ...options });

describe("015-120: setupFiles pairs in the test's process can be avoidable", () => {
  // Cezar: vitest.setup.ts → runs/run-exits.ts → contract/src/waits.ts on 1,156 test files; a barrel route on 65.
  const graph = fakeGraph(
    {
      "test/b.test.ts": ["src/index.ts"],
      "src/index.ts": ["src/waits.ts"],
      "test/setup.ts": ["src/run-exits.ts", "src/env.ts"],
      "src/run-exits.ts": ["src/waits.ts"],
      "src/env.ts": ["src/unused.ts"],
      "src/waits.ts": [],
      "src/unused.ts": [],
      "vitest.config.ts": ["src/reporter.ts"],
      "src/reporter.ts": [],
      "test/global.ts": ["src/teardown.ts"],
      "src/teardown.ts": [],
    },
    {
      "": {
        files: [
          "vitest.config.ts",
          "src/reporter.ts",
          "test/setup.ts",
          "src/run-exits.ts",
          "src/waits.ts",
          "src/env.ts",
          "src/unused.ts",
          "test/global.ts",
          "src/teardown.ts",
        ],
        roots: ["test/global.ts", "test/setup.ts", "vitest.config.ts"],
      },
    },
  );
  // Each test process ran the setup file, called run-exits.ts and env.ts, loaded waits.ts; src/unused.ts never ran.
  const ran = record(["src/run-exits.ts", "src/env.ts"], ["test/setup.ts", "src/waits.ts"]);
  const setupOnly = [0, 1, 2, 3].map((i) =>
    testFile(`test/s${i}.test.ts`, [`test/s${i}.test.ts`], { seconds: 10, coverage: ran }),
  );
  // A test file of another project, without the setup file, reaches waits.ts through a barrel.
  const barrel = testFile("test/b.test.ts", ["test/b.test.ts", "src/index.ts", "src/waits.ts"], {
    project: "web",
    seconds: 1,
    coverage: record(["src/run-exits.ts"], ["test/setup.ts", "src/index.ts", "src/waits.ts"]),
  });
  const r = report(snapshot([...setupOnly, barrel], { graph, barrels: ["src/index.ts"] }));
  const entry = (file: string) => r.files.find((e) => e.files.includes(file));

  it("names the setup chain as the main route where it holds the avoidable seconds", () => {
    expect(entry("src/waits.ts")).toMatchObject({
      kind: "setup",
      avoidableSeconds: 41,
      gateway: {
        kind: "setup",
        gateway: "src/run-exits.ts",
        chain: ["test/setup.ts", "src/run-exits.ts", "src/waits.ts"],
      },
      suggestion: {
        kind: "setup",
        text: "keep the setup's imports leaf-only: test/setup.ts → src/run-exits.ts → src/waits.ts",
      },
    });
    expect(formatReach(r)).toContain(
      "     paths: setup 98%, barrel 2%\n" +
        "     gateway: setup through src/run-exits.ts, for example test/setup.ts → src/run-exits.ts → src/waits.ts\n",
    );
  });

  it("reads a setup module the record does not name not loaded when its root ran in the test's process", () => {
    expect(entry("src/unused.ts")).toMatchObject({
      coverage: { "not loaded": 1 },
      avoidableSeconds: 40,
    });
  });

  it("keeps the config's and global setup's chains outside the test's process, never avoidable", () => {
    for (const file of ["src/reporter.ts", "src/teardown.ts"]) {
      expect(entry(file), file).toMatchObject({
        coverage: { "outside the test's process": 1 },
        avoidableSeconds: 0,
      });
    }
  });

  it("counts no setup seconds in the order while coverage is unknown", () => {
    const unknown = [...setupOnly, barrel].map((t) => ({ ...t, coverage: UNKNOWN }));
    const off = report(snapshot(unknown, { graph, barrels: ["src/index.ts"], coverageOn: false }));
    const waits = off.files.find((e) => e.files.includes("src/waits.ts"));
    expect(waits).toMatchObject({ avoidableSeconds: 0, unknownSeconds: 1, kind: "barrel" });
  });
});
