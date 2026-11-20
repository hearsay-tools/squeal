import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NODE_TEST_UNASSIGNED } from "../../../src/core/ci/parts.js";
import type { NodeTestProject } from "../../../src/core/types/policy.js";
import { probeNode } from "../../../src/runners/node-test/adapter-environment.js";
import { runNodeTest } from "../../../src/runners/node-test/run/run.js";
import {
  nodeTestCommand,
  project,
  record,
  reporterPair,
  TEST_FILES,
  temp,
} from "./ci-record-kit.js";

/*
 * Spec 018 D22 to D25 (row 018-47): `squeal ci record` around a node:test
 * command with Squeal's reporter writes one part per `node --test` process
 * whose files, checks, outcomes and observed sets equal what the daemon's
 * run records for the same content (`runNodeTest`), with read evidence for
 * every load: ESM, CJS, `--import tsx` and a spawned child (open question 1).
 */

const SLOW = { timeout: 120_000 } as const;
const ENTRY: NodeTestProject = {
  name: "unit",
  node: process.execPath,
  argv: ["--import", "tsx"],
  env: {},
  include: ["test/*.test.*"],
};

describe("ci record of a node:test command", () => {
  it("records what the daemon's run records, with evidence for every load", SLOW, async () => {
    const root = project();
    const command = nodeTestCommand(process.execPath, [...reporterPair(), ...TEST_FILES]);
    const recorded = await record(root, command);
    expect(recorded.code, recorded.stderr).toBe(0);
    expect(recorded.parts).toHaveLength(1);
    const part = recorded.parts[0];
    if (part === undefined) throw new Error("no part");
    expect(part.header.runner).toBe("node-test");
    expect(part.header.end).toBe("completed");
    expect(part.projects).toEqual([]);
    const probe = await probeNode(ENTRY, root);
    if (!probe.ok) throw new Error(probe.error);
    expect(part.header.nodeTest).toMatchObject({
      cwd: "",
      version: probe.version,
      nodeBuild: probe.build,
    });
    expect(part.header.runnerVersion).toBe(probe.version);
    expect(
      part.testFiles.map((f) => f.path),
      recorded.stderr,
    ).toEqual(TEST_FILES);
    expect(part.testFiles.every((f) => f.project === NODE_TEST_UNASSIGNED)).toBe(true);

    const files = TEST_FILES.map((path) => ({ project: "unit", path }));
    const daemon = await runNodeTest({
      root,
      project: ENTRY,
      files,
      logDir: join(temp(), "log"),
      timeoutMs: 60_000,
    });
    for (const file of part.testFiles) {
      const results = daemon.report.results.filter((r) => r.check.testPath === file.path);
      const checks = results.map((r) => ({
        fullName: r.check.kind === "test" ? r.check.fullName : "",
        outcome: r.outcome,
      }));
      expect(
        file.checks.map(({ fullName, outcome }) => ({ fullName, outcome })),
        file.path,
      ).toEqual(checks);
      const closure = daemon.observed.find((c) => c.testFile.path === file.path);
      expect(file.observed?.paths, file.path).toEqual(closure?.paths);
      expect(file.observed?.direct ?? [], file.path).toEqual(closure?.direct);
      for (const path of file.observed?.paths ?? [])
        expect(part.evidence[path], path).toMatch(/^[0-9a-f]{40}$/);
    }
    const esm = part.testFiles.find((f) => f.path === "test/esm.test.mjs");
    expect(esm?.checks.map((c) => [c.fullName, c.outcome])).toEqual([
      ["suite > same", "pass"],
      ["suite > same (line 5)", "pass"],
      ["suite > skipped", "skip"],
      ["suite > later", "skip"],
      ["a is 1", "pass"],
    ]);
    const spawn = part.testFiles.find((f) => f.path === "test/spawn.test.mjs");
    expect(spawn?.observed?.paths).toEqual(["lib/child.mjs", "lib/d.mjs", "test/spawn.test.mjs"]);
    const ts = part.testFiles.find((f) => f.path === "test/ts.test.ts");
    expect(ts?.observed?.paths).toEqual(["lib/c.ts", "test/ts.test.ts"]);
  });
});
