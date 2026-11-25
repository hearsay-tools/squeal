import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  coreEnvironmentInputs,
  installedDependenciesFingerprint,
} from "../../../src/core/keys/environment.js";
import type { RemoteHost } from "../../../src/core/runner-host/remote/connect.js";
import {
  blobsAt,
  compareRemoteEnvironment,
} from "../../../src/core/runner-host/remote/lane-compare.js";
import type { EnvironmentMode } from "../../../src/core/runner-host/remote/remote-key.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import type { CoreEnvironmentInputs } from "../../../src/core/types/keys.js";
import type { RunnerAdapter, RunnerEnvironment } from "../../../src/core/types/runner.js";
import { fake } from "./share-fixture.js";

/*
 * Row 026-27: a remote whose results go under this machine's keys (under
 * `match-local`, or `remote-key` on this machine) is refused when its Git is
 * older than this machine's; on another machine under `remote-key` its
 * results go under its own keys, and its Git is not compared.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-compare-git-")) as AbsolutePath;
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const VERSION = "0.0.0-test";
const HERE = "git version 2.43.0";
const OLD = "git version 2.39.5";
const REFUSAL =
  "git 2.39.5 on the remote is older than 2.43.0 here; upgrade Git on the remote or disable the remote lane";

const env: RunnerEnvironment = {
  project: "unit",
  runnerName: "node-test",
  runnerVersion: "v24.0.0",
  adapterVersion: "1",
  resolvedConfig: "{}",
  files: [],
};

/** A host on `machine` (this one's when empty) whose Git is `git`. */
function host(git: string | null | undefined, machine: Partial<CoreEnvironmentInputs> = {}) {
  const remote: RemoteHost = {
    adapter: {
      ...fake("node-test", async () => {
        throw new Error("no run");
      }),
      environment: async () => [env],
    } as RunnerAdapter,
    node: "v-test",
    ...(git === undefined ? {} : { gitVersion: git }),
    coreEnvironment: async () => {
      const { squealVersion: _v, ...core } = coreEnvironmentInputs({
        squealVersion: VERSION,
        installedDependencies: await installedDependenciesFingerprint(scratch, scratch),
        allowlist: [],
      });
      return { ...core, ...machine };
    },
    blobs: async (paths) => blobsAt(scratch, paths),
    admit: async () => ({ grant: 1 }) as never,
    install: async () => ({ ran: false }) as never,
  };
  return remote;
}

async function compare(remote: RemoteHost, mode?: EnvironmentMode) {
  const found = await compareRemoteEnvironment(remote, {
    target: "box",
    root: scratch,
    version: VERSION,
    local: { ...fake("node-test", async () => ({}) as never), environment: async () => [env] },
    allowlist: () => [],
    log: () => {},
    localGitVersion: HERE,
    ...(mode === undefined ? {} : { environmentMode: mode }),
  });
  return found.differences;
}

const MAC = { platform: "darwin", arch: "arm64" };

describe("the comparison of a remote's Git (row 026-27)", () => {
  it("refuses an older Git under match-local", async () => {
    expect(await compare(host(OLD))).toEqual([REFUSAL]);
    expect(await compare(host(OLD), "match-local")).toEqual([REFUSAL]);
  });

  it("refuses an older Git under remote-key on this machine", async () => {
    expect(await compare(host(OLD), "remote-key")).toEqual([REFUSAL]);
  });

  it("does not compare Git under remote-key on another machine", async () => {
    expect(await compare(host(OLD, MAC), "remote-key")).toEqual([]);
  });

  it("refuses a remote without Git, and takes a newer one or an unreported one", async () => {
    expect(await compare(host(null))).toEqual(["git is not installed on the remote (2.43.0 here)"]);
    expect(await compare(host("git version 2.56.1"))).toEqual([]);
    expect(await compare(host("git version 2.43.9"))).toEqual([]);
    expect(await compare(host(undefined))).toEqual([]);
  });
});
