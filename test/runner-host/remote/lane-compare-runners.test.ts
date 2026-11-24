import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  coreEnvironmentInputs,
  installedDependenciesFingerprint,
} from "../../../src/core/keys/environment.js";
import type { RemoteHost } from "../../../src/core/runner-host/remote/connect.js";
import { blobsAt, compareRemote } from "../../../src/core/runner-host/remote/lane-compare.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import type { RunnerAdapter, RunnerEnvironment } from "../../../src/core/types/runner.js";
import { fake } from "./share-fixture.js";

/*
 * Spec 026 D8.2 (row 026-11): the comparison before a remote run holds for
 * node:test and pytest projects as for Vitest: each project's descriptor
 * and config files must be equal there, but for coverage, which stays off
 * on a remote (021 D12): node:test's `coverage` marker is not compared.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-compare-runners-")) as AbsolutePath;
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
mkdirSync(join(scratch, ".venv"), { recursive: true });
writeFileSync(join(scratch, "pytest.ini"), "[pytest]\n");
writeFileSync(join(scratch, ".venv/pyvenv.cfg"), "home = /usr/bin\n");

const VERSION = "0.0.0-test";

const nodeTest = (config: Record<string, unknown>): RunnerEnvironment => ({
  project: "unit",
  runnerName: "node-test",
  runnerVersion: "v24.0.0",
  adapterVersion: "1",
  resolvedConfig: JSON.stringify({ node: "node", nodeBuild: "b1", argv: [], ...config }),
  files: [],
});
const pytest = (config: Record<string, unknown>): RunnerEnvironment => ({
  project: "py",
  runnerName: "pytest",
  runnerVersion: "8.0.0",
  adapterVersion: "1",
  resolvedConfig: JSON.stringify({ cwd: "", python: null, state: "ready", hash: "h1", ...config }),
  files: ["pytest.ini", ".venv/pyvenv.cfg"],
});

/** A host whose core is this process's and whose project answers `there`; `blobs` as here unless given. */
function host(there: RunnerEnvironment, blobs?: Record<string, string | null>): RemoteHost {
  return {
    adapter: {
      ...fake(there.runnerName as "node-test", async () => {
        throw new Error("no run");
      }),
      environment: async () => [there],
    } as RunnerAdapter,
    node: process.version,
    coreEnvironment: async () => {
      const { squealVersion: _v, ...core } = coreEnvironmentInputs({
        squealVersion: VERSION,
        installedDependencies: await installedDependenciesFingerprint(scratch, scratch),
        allowlist: [],
      });
      return core;
    },
    blobs: async (paths) => blobs ?? blobsAt(scratch, paths),
    admit: async () => ({ grant: 1 }) as never,
    install: async () => ({ ran: false }) as never,
  };
}

function compare(here: RunnerEnvironment, there: RemoteHost) {
  const local = {
    ...fake("node-test", async () => ({}) as never),
    environment: async () => [here],
  };
  return compareRemote(there, {
    target: "box",
    root: scratch,
    version: VERSION,
    local,
    allowlist: () => [],
    log: () => {},
  });
}

describe("the comparison of a node:test or pytest remote (row 026-11)", () => {
  it("finds a node:test project equal with coverage on here and off there", async () => {
    const here = nodeTest({ coverage: { provider: "squeal", version: 1 } });
    expect(await compare(here, host(nodeTest({})))).toEqual([]);
  });

  it("refuses a node:test project on another Node build", async () => {
    const differ = await compare(nodeTest({}), host(nodeTest({ nodeBuild: "b2" })));
    expect(differ.length).toBeGreaterThan(0);
  });

  it("finds a pytest project equal with its config files, and refuses one whose environment differs", async () => {
    expect(await compare(pytest({}), host(pytest({})))).toEqual([]);
    const missing = await compare(
      pytest({}),
      host(pytest({}), { "pytest.ini": null, ".venv/pyvenv.cfg": null }),
    );
    expect(missing.length).toBeGreaterThan(0);
    expect((await compare(pytest({}), host(pytest({ hash: "h2" })))).length).toBeGreaterThan(0);
  });
});
