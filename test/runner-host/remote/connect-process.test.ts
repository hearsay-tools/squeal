import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { squealVersion } from "../../../src/core/daemon/version.js";
import {
  remoteAdapterOptions,
  remoteTreeDir,
  startRemoteHost,
  treeDir,
} from "../../../src/core/runner-host/remote/connect.js";
import type { NodeTestProject, PytestProject } from "../../../src/core/types/policy.js";
import { copyNodeTestRuntime } from "../../../src/harness/build.js";
import { SLOW } from "../../daemon/helpers.js";
import { buildBundle, fakeSsh, scratchDir } from "./helpers.js";

/*
 * Spec 026 D8.2 (row 026-11): node:test's and pytest's temp and cache
 * directories, this machine's paths, become directories of the remote
 * tree's own before the host starts; no local path reaches a remote
 * process. The node:test host runs over a fake `ssh` in a directory here.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-remote-process-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const places = { node: process.execPath, cache: ".cache" };
const NODE_TEST: NodeTestProject = { name: "unit", argv: [], env: {}, include: ["test/*.mjs"] };
const PYTEST = { name: "py", include: ["tests"] } as unknown as PytestProject;

function remote(): { home: string; ssh: string } {
  const home = join(scratchDir, `remote-home-${randomUUID()}`);
  onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  return { home, ssh: fakeSsh(join(home, ".bin"), home) };
}

describe("a remote host's temp and cache directories (row 026-11)", () => {
  it("moves node:test's and pytest's under the remote tree, and leaves Vitest's options", () => {
    const tree = "/srv/dev/.cache/squeal/trees/abc";
    expect(
      remoteAdapterOptions(
        {
          childEnv: { SQUEAL_LANE: "x" },
          process: { project: PYTEST, tempDir: "/local/tmp", cacheDir: "/local/state/pytest/f00" },
        },
        tree,
      ),
    ).toEqual({
      childEnv: { SQUEAL_LANE: "x" },
      process: { project: PYTEST, tempDir: `${tree}/tmp`, cacheDir: `${tree}/cache/f00` },
    });
    expect(remoteAdapterOptions({ childEnv: {}, process: { project: NODE_TEST } }, tree)).toEqual({
      childEnv: {},
      process: { project: NODE_TEST, tempDir: `${tree}/tmp` },
    });
    const vitest = { childEnv: {}, maxWorkers: 2 };
    expect(remoteAdapterOptions(vitest, tree)).toBe(vitest);
  });

  it("makes the tree's tmp and cache there and answers its absolute path", async () => {
    const { home, ssh } = remote();
    const tree = treeDir(places, "/some/root");
    const dir = await remoteTreeDir({ destination: "box", ssh }, tree, 30_000);
    expect(dir).toBe(join(home, tree));
    expect(existsSync(join(home, tree, "tmp"))).toBe(true);
    expect(existsSync(join(home, tree, "cache"))).toBe(true);
  });
});

describe("a remote node:test host (row 026-11)", SLOW, () => {
  let cli = "";
  beforeAll(async () => {
    cli = await buildBundle(join(scratch, "dist"));
    // The plugin's bundle holds node:test's runtime beside its CLI, as `pnpm run build` copies it.
    copyNodeTestRuntime(join(scratch, "dist"));
  }, SLOW.timeout);

  it("runs its tests with the remote tree's temp directory, never this machine's", async () => {
    const root = join(scratchDir, `node-test-remote-${randomUUID()}`);
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, "test"), { recursive: true });
    const { home, ssh } = remote();
    const expected = join(home, treeDir(places, root), "tmp");
    writeFileSync(
      join(root, "test/tmp.test.mjs"),
      [
        'import { test } from "node:test";',
        'import assert from "node:assert";',
        'test("tmp", () => assert.strictEqual(process.env.TMPDIR, process.env.EXPECTED_TMP));',
        "",
      ].join("\n"),
    );
    execFileSync("git", ["init", "-q", root]);
    const localTmp = join(scratch, "local-tmp");
    mkdirSync(localTmp, { recursive: true });
    const project = { ...NODE_TEST, env: { EXPECTED_TMP: expected } };
    const { adapter } = await startRemoteHost({
      target: { destination: "build-box", ssh },
      places,
      launch: { execPath: process.execPath, execArgv: [], cli },
      version: squealVersion(),
      root,
      runner: "node-test",
      options: { childEnv: {}, process: { project, tempDir: localTmp, coverage: true } },
      policy: () => ({
        observe: false,
        exclude: [],
        excludeProjects: [],
        coverage: false,
        coverageChildren: false,
        tierSize: 1,
      }),
    });
    onTestFinished(() => adapter.close());
    expect((await adapter.testFiles()).map((f) => f.path)).toEqual(["test/tmp.test.mjs"]);
    const report = await adapter.run([{ project: "unit", path: "test/tmp.test.mjs" }], {
      runId: randomUUID(),
      logDir: join(scratch, "logs", randomUUID()),
      timeoutMs: 60_000,
    });
    expect(report.results.map((r) => r.outcome)).toEqual(["pass"]);
    expect(readdirSync(localTmp)).toEqual([]);
  });
});
