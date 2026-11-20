import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NODE_TEST_UNASSIGNED } from "../../../src/core/ci/parts.js";
import { configFieldHash } from "../../../src/core/keys/environment-descriptor.js";
import type { NodeTestProject } from "../../../src/core/types/policy.js";
import { probeNode } from "../../../src/runners/node-test/adapter-environment.js";
import { runNodeTest } from "../../../src/runners/node-test/run/run.js";
import {
  FILES,
  nodeTestCommand,
  type Packages,
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
 * Alone (`tsx`: no Vitest resolves) and beside Vitest's recording (`all`).
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
  const PACKAGES: readonly Packages[] = ["tsx", "all"];
  it.each(PACKAGES)(
    "records what the daemon's run records, with evidence for every load (%s)",
    SLOW,
    async (packages) => {
      const root = project(undefined, packages);
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
      // Review of 0.1.579 B1: none of the preloads Squeal put in NODE_OPTIONS counts as the project's.
      expect(part.header.nodeTest?.nodeOptions, recorded.stderr).toEqual([]);
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
    },
  );
});

describe("ci record of a node:test command's variables and children", () => {
  it("hashes each variable an entry's env names, as the processes saw it", SLOW, async () => {
    const config = {
      nodeTest: [
        { name: "a", env: { TZ: "UTC" }, include: ["test/esm.test.mjs"] },
        { name: "b", env: { LANG: "C" }, include: ["test/cjs.test.cjs"] },
      ],
    };
    const root = project({ ...FILES, "squeal.config.json": JSON.stringify(config) });
    const { LANG: _lang, ...env } = process.env;
    const command = [process.execPath, "--test", ...reporterPair(), "test/esm.test.mjs"];
    const recorded = await record(root, command, { ...env, TZ: "UTC" });
    expect(recorded.code, recorded.stderr).toBe(0);
    expect(recorded.parts[0]?.header.nodeTest?.env).toEqual({
      LANG: null,
      TZ: configFieldHash("UTC"),
    });
  });

  it(
    "keeps read evidence for a file named like an Object property (review 0.1.582-r2)",
    SLOW,
    async () => {
      const reads = [
        'import { readFileSync } from "node:fs";',
        'import { test } from "node:test";',
        'test("reads", () => { for (const name of ["__proto__", "constructor"]) readFileSync(name); });',
      ].join("\n");
      const named = Object.fromEntries([
        ["__proto__", "p\n"],
        ["constructor", "c\n"],
      ]);
      const root = project({ ...FILES, ...named, "test/reads.test.mjs": `${reads}\n` });
      const command = [process.execPath, "--test", ...reporterPair(), "test/reads.test.mjs"];
      const recorded = await record(root, command);
      expect(recorded.code, recorded.stderr).toBe(0);
      const evidence = recorded.parts[0]?.evidence ?? {};
      for (const name of ["__proto__", "constructor"]) {
        expect(Object.hasOwn(evidence, name), name).toBe(true);
        expect(evidence[name], name).toMatch(/^[0-9a-f]{40}$/);
      }
    },
  );

  it("keeps a child's loads when the test starts it with an env of its own", SLOW, async () => {
    const spawns = [
      'import { execFileSync } from "node:child_process";',
      'import { test } from "node:test";',
      'test("spawns", () => { execFileSync(process.execPath, ["lib/child.mjs"], { env: { PATH: process.env.PATH } }); });',
    ].join("\n");
    const root = project({ ...FILES, "test/spawn.test.mjs": `${spawns}\n` });
    const command = [process.execPath, "--test", ...reporterPair(), "test/spawn.test.mjs"];
    const recorded = await record(root, command);
    expect(recorded.code, recorded.stderr).toBe(0);
    const [file] = recorded.parts[0]?.testFiles ?? [];
    expect(file?.observed?.paths).toEqual(["lib/child.mjs", "lib/d.mjs", "test/spawn.test.mjs"]);
    expect(file?.observed?.direct).toEqual(["lib/child.mjs", "lib/d.mjs"]);
    for (const path of file?.observed?.paths ?? []) {
      expect(recorded.parts[0]?.evidence[path], path).toMatch(/^[0-9a-f]{40}$/);
    }
  });
});
