import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { readHead } from "../../../src/core/daemon-loop/head.js";
import { worktreeIdFor } from "../../../src/core/fs/git-layout.js";
import { createFsHasher } from "../../../src/core/hash/hasher.js";
import { encodeSegment, keyFromSegments } from "../../../src/core/keys/check-key.js";
import {
  coreEnvironmentInputs,
  installedDependenciesFingerprint,
} from "../../../src/core/keys/environment.js";
import { environmentHash } from "../../../src/core/keys/environment-hash.js";
import { KEY_FORMAT_VERSION } from "../../../src/core/keys/key-format.js";
import type { RemoteHost } from "../../../src/core/runner-host/remote/connect.js";
import {
  blobsAt,
  compareRemoteEnvironment,
  nodePinsAt,
} from "../../../src/core/runner-host/remote/lane-compare.js";
import {
  attachRemoteCore,
  executedCoreOf,
  mergeCoreReports,
  remoteKeyStatusLine,
  tagReportCore,
} from "../../../src/core/runner-host/remote/remote-key.js";
import { WorktreeKeys } from "../../../src/core/scheduler/keying.js";
import { worktreeEnvironment } from "../../../src/core/store/environments.js";
import { isStoreOpenFailure, openStore } from "../../../src/core/store/open.js";
import type { AbsolutePath, WorktreeId } from "../../../src/core/types/common.js";
import type { CheckKey, CoreEnvironmentInputs, TestFileRef } from "../../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";
import type {
  RunnerAdapter,
  RunnerEnvironment,
  RunReport,
} from "../../../src/core/types/runner.js";
import type { Store } from "../../../src/core/types/store.js";
import { git } from "../../hash/git-repo.js";
import { RUN_MISSING } from "../../helpers/baseline.js";
import {
  claimRepo,
  FakeRunner,
  fileName,
  type Side,
  side,
} from "../../scheduler/claims-fixture.js";
import { fake } from "./share-fixture.js";

/*
 * Spec 026 D10 (row 026-14): under `environmentMode: "remote-key"` a project
 * is keyed under the remote machine's Node, platform and arch. A darwin key
 * and a linux key of one file are distinct in one store; the linux key is
 * the one a Linux daemon or CI export (spec 018) computes, so its result is
 * reused; a file run on another machine than its key's is stored only under
 * that machine's key (vision principle 2). The key format is unchanged
 * (`test/keys/key-format.test.ts`).
 */

/** The core a daemon reads here, as `side`'s scheduler and `keyAt` compute it. */
const OWN = coreEnvironmentInputs({
  squealVersion: "0.0.0-test",
  installedDependencies: "none",
  allowlist: DEFAULT_POLICY.env.allowlist,
});
const LINUX: CoreEnvironmentInputs = {
  ...OWN,
  nodeVersion: "v26.13.0",
  platform: "linux",
  arch: "x64",
};
const DARWIN: CoreEnvironmentInputs = { ...LINUX, platform: "darwin", arch: "arm64" };
const F0 = fileName(0);
const LOOKUP_ONLY = { baseline: { onStart: "lookup-only" as const } };
/** Real schedulers, a real store and git: a loaded host needs headroom. */
const SLOW = { timeout: 60_000 } as const;

/** `path`'s key as a daemon on `machine` computes it from the fake runner's environment. */
async function keyOn(
  root: string,
  path: string,
  machine: CoreEnvironmentInputs,
): Promise<CheckKey> {
  const [environment] = await new FakeRunner([]).environment();
  if (environment === undefined) throw new Error("the fake runner has an environment");
  const core = { ...OWN, ...pick(machine) };
  const envHash = environmentHash(core, environment, () => null, KEY_FORMAT_VERSION);
  const hash = await createFsHasher(root, "sha1").hash(path);
  return keyFromSegments(envHash, { project: "", path }, [encodeSegment(path, hash)]);
}

const pick = ({ nodeVersion, platform, arch }: CoreEnvironmentInputs) => ({
  nodeVersion,
  platform,
  arch,
});

/** `b`'s runner keyed under `keyedOn`, its runs on `ranOn`. */
function onMachines(b: Side, keyedOn: CoreEnvironmentInputs, ranOn: CoreEnvironmentInputs): void {
  const environment = b.runner.environment;
  const run = b.runner.run.bind(b.runner);
  Object.assign(b.runner, {
    environment: async () => attachRemoteCore(await environment(), keyedOn),
    run: async (files: readonly TestFileRef[]) => tagReportCore(await run(files), ranOn),
  });
}

/** The passes of the fake runner's test stored at `key`. */
const passesAt = (store: Store, key: CheckKey) =>
  store.results
    .byKey(key, 0)
    .filter((r) => r.check.kind === "test" && r.check.fullName === "passes" && r.outcome === "pass")
    .length;

describe("keys under the remote's machine (026 D10.2)", () => {
  const ID = "0123456789abcdef" as WorktreeId;
  const environment: RunnerEnvironment = {
    project: "",
    runnerName: "vitest",
    runnerVersion: "5.0.3",
    adapterVersion: "7",
    resolvedConfig: "{}",
    files: ["vitest.config.ts"],
  };

  async function worktreeKeys(): Promise<{ keys: WorktreeKeys; store: Store }> {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "sq-026-14-")));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    writeFileSync(join(root, "vitest.config.ts"), "export default {};\n");
    writeFileSync(join(root, "a.test.ts"), "// a\n");
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-qm", "fixture"]);
    const opened = openStore(join(root, ".git"), { busyTimeoutMs: 10_000 });
    if (isStoreOpenFailure(opened)) throw new Error(`store: ${JSON.stringify(opened)}`);
    onTestFinished(() => opened.close());
    const keys = new WorktreeKeys({
      root,
      worktreeId: ID,
      store: opened,
      hasher: createFsHasher(root, "sha1"),
      objectFormat: "sha1",
      policy: DEFAULT_POLICY,
      squealVersion: "0.0.0-test",
      env: {},
      onExtraFiles: () => {},
      now: () => Date.now(),
    });
    await keys.bootstrap(() => readHead(root));
    return { keys, store: opened };
  }

  const A: TestFileRef = { project: "", path: "a.test.ts" };

  it("keeps the darwin key and the linux key of one file apart, and records the keyed descriptor", async () => {
    const { keys, store } = await worktreeKeys();
    keys.setClosure({ testFile: A, paths: [A.path] });
    await keys.setEnvironments([{ ...environment, core: DARWIN }]);
    const darwin = keys.index.key(A);
    const darwinHash = keys.index.environment("");
    await keys.setEnvironments(attachRemoteCore([environment], LINUX));
    const linux = keys.index.key(A);
    expect(darwin).not.toBeNull();
    expect(linux).not.toBeNull();
    expect(linux).not.toBe(darwin);
    expect(keys.index.environment("")).not.toBe(darwinHash);
    expect(keys.coreOf("")).toMatchObject(pick(LINUX));
    expect(worktreeEnvironment(store, ID, "")?.descriptor).toMatchObject({
      platform: "linux",
      arch: "x64",
      nodeVersion: "v26.13.0",
    });
    // The other machine's key from the same closure, without moving the worktree's.
    expect(keys.keyForCore(A, DARWIN)).toBe(darwin);
    expect(keys.keyForCore(A, LINUX)).toBe(linux);
    expect(keys.index.key(A)).toBe(linux);
  });

  it("keys under the remote's machine only: its own install and variables stay this side's", async () => {
    const { keys } = await worktreeKeys();
    keys.setClosure({ testFile: A, paths: [A.path] });
    await keys.setEnvironments([environment]);
    const own = keys.index.key(A);
    const here = keys.coreOf("");
    if (here === undefined) throw new Error("keyed");
    // A remote core naming this machine, with another install and variables, keys as here.
    const same = { ...here, installedDependencies: "remote-deps", env: { TZ: "UTC" } };
    await keys.setEnvironments(attachRemoteCore([environment], same));
    expect(keys.index.key(A)).toBe(own);
    await keys.setEnvironments(attachRemoteCore([environment], null));
    expect(keys.index.key(A)).toBe(own);
  });
});

describe("a remote-key worktree in a shared store (026 D10.2)", SLOW, () => {
  it("reuses a Linux daemon's or CI export's result at once, which a darwin worktree does not", async () => {
    const { main, other } = claimRepo(1);
    const [linuxKey, darwinKey] = await Promise.all([
      keyOn(other, F0, LINUX),
      keyOn(other, F0, DARWIN),
    ]);
    expect(linuxKey).not.toBe(darwinKey);

    const remote = side(other, { count: 1, policy: LOOKUP_ONLY });
    remote.store.results.putMany([stored(F0, linuxKey, worktreeIdFor(main))]);
    onMachines(remote, LINUX, LINUX);
    await remote.scheduler.start();
    await remote.quiet();
    expect(remote.keyOf(F0)).toBe(linuxKey);
    expect(remote.runner.runs).toEqual([]);
    expect(remote.passing()).toBe(1);

    const native = side(main, { count: 1, policy: RUN_MISSING });
    onMachines(native, DARWIN, DARWIN);
    await native.scheduler.start();
    await native.quiet();
    expect(native.keyOf(F0)).toBe(darwinKey);
    expect(native.runner.ran(F0)).toBe(1);
    expect(passesAt(native.store, darwinKey)).toBe(1);
  });

  it("stores a remote run under the linux key, and a run here while keyed to it only under the darwin key", async () => {
    const { main, other } = claimRepo(1);
    const [linuxKey, darwinKey] = await Promise.all([
      keyOn(main, F0, LINUX),
      keyOn(main, F0, DARWIN),
    ]);

    // The lane fell back to this macOS machine while the worktree is keyed to the Linux remote.
    const fallback = side(main, { count: 1, policy: RUN_MISSING });
    onMachines(fallback, LINUX, DARWIN);
    await fallback.scheduler.start();
    await fallback.quiet();
    expect(fallback.keyOf(F0)).toBe(linuxKey);
    expect(fallback.runner.ran(F0)).toBe(1);
    expect(fallback.store.results.byKey(linuxKey, 0)).toEqual([]);
    expect(passesAt(fallback.store, darwinKey)).toBe(1);
    expect(fallback.passing()).toBe(0);
    expect(fallback.phase(F0)).not.toBe("current");
    const states = fallback.store.knownStates.list(fallback.worktreeId);
    expect(states.filter((s) => s.outcome === "pass")).toEqual([]);

    const remote = side(other, { count: 1, policy: RUN_MISSING });
    onMachines(remote, LINUX, LINUX);
    await remote.scheduler.start();
    await remote.quiet();
    expect(remote.runner.ran(F0)).toBe(1);
    expect(passesAt(remote.store, linuxKey)).toBe(1);
    expect(remote.passing()).toBe(1);
  });
});

/** A pass of `path` at `key`, as another worktree's daemon or a CI import stored it. */
function stored(path: string, key: CheckKey, worktreeId: string) {
  return {
    check: { kind: "test" as const, project: "", testPath: path, fullName: "passes" },
    key,
    outcome: "pass" as const,
    durationMs: 1,
    location: null,
    fingerprint: null,
    summary: null,
    errors: [],
    provenance: {
      worktreeId,
      revision: 1,
      commit: "0".repeat(40),
      dirty: false,
      runId: randomUUID(),
      recordedAt: Date.now() - 1_000,
    },
  };
}

describe("the lane's seam (026 D10)", () => {
  const A: TestFileRef = { project: "", path: "a.test.ts" };
  const B: TestFileRef = { project: "", path: "b.test.ts" };
  const report = (files: readonly TestFileRef[]): RunReport => ({
    end: "completed",
    durationMs: 1,
    completedFiles: files,
    results: [],
    fileErrors: [],
    failure: null,
  });

  it("names the remote environment results are keyed to (D10.3)", () => {
    expect(remoteKeyStatusLine("agent37:eu:vm", LINUX)).toBe(
      "remote agent37:eu:vm (linux/x64, Node v26.13.0); results keyed to remote environment",
    );
  });

  it("tags each file of a split with the machine of the part that ran it", () => {
    const here = tagReportCore(report([A]), DARWIN);
    const there = tagReportCore(report([B]), LINUX);
    const split = mergeCoreReports(report([A, B]), [here, there]);
    expect(split.executedCore).toBeUndefined();
    expect(executedCoreOf(split, A)).toBe(DARWIN);
    expect(executedCoreOf(split, B)).toBe(LINUX);
    const one = mergeCoreReports(report([A, B]), [there, tagReportCore(report([A]), LINUX)]);
    expect(one).toEqual({ ...report([A, B]), executedCore: LINUX });
    // An untagged part's files ran where the keys say.
    const untagged = mergeCoreReports(report([A, B]), [report([A]), there]);
    expect(executedCoreOf(untagged, A)).toBeUndefined();
    expect(executedCoreOf(untagged, B)).toBe(LINUX);
  });

  it("attaches the remote's core to each environment, and takes it off", () => {
    const environment: RunnerEnvironment = {
      project: "",
      runnerName: "vitest",
      runnerVersion: "5.0.3",
      adapterVersion: "7",
      resolvedConfig: "{}",
      files: [],
    };
    const [attached] = attachRemoteCore([environment], LINUX);
    expect(attached?.core).toBe(LINUX);
    expect(attachRemoteCore(attachRemoteCore([environment], LINUX), null)).toEqual([environment]);
  });
});

describe("the lane's comparison under remote-key (026 D10.2)", () => {
  const VERSION = "0.0.0-test";
  const there: RunnerEnvironment = {
    project: "unit",
    runnerName: "node-test",
    runnerVersion: "v24.0.0",
    adapterVersion: "1",
    resolvedConfig: "{}",
    files: [],
  };

  function scratch(files: Record<string, string> = {}): AbsolutePath {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "sq-026-14-lane-"))) as AbsolutePath;
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text);
    return root;
  }

  /** A remote on another machine whose install reads `deps` until the host installs once. */
  function host(root: AbsolutePath, machine: Partial<CoreEnvironmentInputs>, deps?: string) {
    let installed = deps === undefined;
    const installs: number[] = [];
    const remote: RemoteHost = {
      adapter: {
        ...fake("node-test", async () => {
          throw new Error("no run");
        }),
        environment: async () => [there],
      } as RunnerAdapter,
      node: "v-test",
      coreEnvironment: async () => {
        const { squealVersion: _v, ...core } = coreEnvironmentInputs({
          squealVersion: VERSION,
          installedDependencies: installed
            ? await installedDependenciesFingerprint(root, root)
            : (deps ?? "none"),
          allowlist: [],
        });
        return { ...core, ...machine };
      },
      blobs: async (paths) => blobsAt(root, paths),
      admit: async () => ({ grant: 1 }) as never,
      install: async () => {
        installs.push(1);
        installed = true;
        return { ran: true, command: "npm ci" } as never;
      },
    };
    return { remote, installs };
  }

  const compare = (root: AbsolutePath, remote: RemoteHost, mode?: "remote-key") =>
    compareRemoteEnvironment(remote, {
      target: "box",
      root,
      version: VERSION,
      local: { ...fake("node-test", async () => ({}) as never), environment: async () => [there] },
      allowlist: () => [],
      log: () => {},
      ...(mode === undefined ? {} : { environmentMode: mode }),
    });

  const MAC = { platform: "darwin", arch: "arm64" };

  it("refuses another machine by default, and gives its core under remote-key", async () => {
    const root = scratch();
    const refused = await compare(root, host(root, MAC).remote);
    expect(refused.differences.length).toBeGreaterThan(0);
    const taken = await compare(root, host(root, MAC).remote, "remote-key");
    expect(taken.differences).toEqual([]);
    expect(taken.remoteCore).toMatchObject({ ...MAC, squealVersion: VERSION });
  });

  it("installs once for another install there, and compares again", async () => {
    const root = scratch();
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "node_modules/.package-lock.json"), '{"lockfileVersion":3}\n');
    const { remote, installs } = host(root, MAC, "stale-deps");
    expect((await compare(root, remote, "remote-key")).differences).toEqual([]);
    expect(installs).toHaveLength(1);
  });

  it("takes another Node only when it meets the project's pins", async () => {
    const pinned = scratch({ ".nvmrc": "26\n", "package.json": '{"engines":{"node":">=26.1"}}' });
    expect(await nodePinsAt(pinned)).toEqual(["26", ">=26.1"]);
    const node = { ...MAC, nodeVersion: "v26.99.0" };
    expect((await compare(pinned, host(pinned, node).remote, "remote-key")).differences).toEqual(
      [],
    );
    const old = { ...MAC, nodeVersion: "v24.0.0" };
    const refused = await compare(pinned, host(pinned, old).remote, "remote-key");
    expect(refused.differences).toEqual([
      `Node v24.0.0 on the remote does not meet the project's Node pin "26", ">=26.1" (${process.version} here)`,
    ]);
    const none = scratch();
    expect(await nodePinsAt(none)).toEqual([]);
    expect((await compare(none, host(none, node).remote, "remote-key")).differences).toEqual([
      `Node v26.99.0 on the remote, ${process.version} here`,
    ]);
  });
});
