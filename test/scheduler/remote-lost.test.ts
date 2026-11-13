import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { HostedAdapter } from "../../src/core/runner-host/host.js";
import { remoteHostOver } from "../../src/core/runner-host/remote/connect.js";
import { withRemoteLane } from "../../src/core/runner-host/remote/lane.js";
import { createTreeHost } from "../../src/core/runner-host/remote/tree-host.js";
import type { RunnerAdapter } from "../../src/core/types/runner.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { inProcessHost, POLICY } from "../runner-host/fake-channel.js";
import { until } from "../runner-host/remote/lane-fixture.js";
import {
  type CatchUpFile,
  type CatchUpRunner,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";

/*
 * Review 0.1.442 B4 (row 021-14 repair R1; spec 021 D13): with the default
 * `whenLost: "local"`, a background tier whose remote host is lost during
 * its run has its files run here at once, in the same tier under the local
 * pool's grant. With no later edit and no other request, the baseline still
 * ends with every file current, and the scheduler settles.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-remote-lost-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const FILES: CatchUpFile[] = [
  { path: "test/a.test.ts", ms: 10, imports: ["src/a.ts"] },
  { path: "test/b.test.ts", ms: 10, imports: ["src/b.ts"] },
];

/** A remote host in this process that answers as `runner` does, and dies in its first run. */
function dyingRemote(runner: CatchUpRunner, root: string, remoteRuns: string[]) {
  const remoteRoot = join(scratch, `remote-${remoteRuns.length}-${Date.now()}`, "root");
  mkdirSync(remoteRoot, { recursive: true });
  const adapter = (): HostedAdapter => ({
    name: runner.name,
    adapterVersion: runner.adapterVersion,
    traits: runner.traits,
    invalidate: async () => ({ recreatedProjects: [] }),
    affected: async () => ({ direct: [], transitive: [] }),
    closure: (testFile) => runner.closure(testFile),
    enumerate: async () => [],
    testFiles: () => runner.testFiles(),
    environment: () => runner.environment(),
    run: (files) => {
      remoteRuns.push(files.map((f) => f.path).join(","));
      host.channel.kill();
      return new Promise(() => {});
    },
    close: async () => {},
  });
  const host = inProcessHost(async () => adapter(), "0.0.0-test", {
    tree: createTreeHost(remoteRoot, () => {}),
  });
  return remoteHostOver(host.channel, "v-test", {
    target: { destination: "box" },
    version: "0.0.0-test",
    root,
    runner: "vitest",
    options: { childEnv: {} },
    policy: () => POLICY,
  });
}

describe("a background tier lost on its remote (spec 021 D13, review 0.1.442 B4)", () => {
  it("runs here at once under whenLost local, so the baseline ends current with no later edit", async () => {
    const repo = catchUpRepo(FILES);
    const statuses: string[] = [];
    const remoteRuns: string[] = [];
    const side = catchUpSide(repo, repo.main, {
      files: FILES,
      hostSlots: 4,
      policy: RUN_MISSING,
      wrapRunner: (runner): RunnerAdapter =>
        withRemoteLane({
          target: "box",
          whenLost: "local",
          root: repo.main,
          version: "0.0.0-test",
          local: runner,
          connect: () => dyingRemote(runner, repo.main, remoteRuns),
          allowlist: () => [],
          status: (text) => statuses.push(text),
          log: () => {},
        }),
    });
    await until(() => statuses.some((s) => s.includes("go there")));
    await side.scheduler.start();
    await side.scheduler.idle();
    expect(remoteRuns).toHaveLength(1);
    expect(statuses.at(-1)).toMatch(/^remote box unreachable since .*; running here$/);
    const ranHere = side.runner.runs.flatMap((run) => run.files.map((f) => f.path));
    for (const { path } of FILES) {
      expect(ranHere).toContain(path);
      expect(side.current(path)).toBe(true);
    }
  });
});
