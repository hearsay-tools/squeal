import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { COVERAGE_RECORD_VERSION } from "../../../src/core/code/coverage/record.js";
import { mainStoreResultKey } from "../../../src/core/code/coverage/runtime.js";
import type { CoveredFile } from "../../../src/core/code/coverage/types.js";
import { createCoverageWriter } from "../../../src/core/code/coverage/writer.js";
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
import { testFileId } from "../../../src/core/keys/reverse-index.js";
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
import { readUnknownFiles, UNKNOWN_FILES_KEPT } from "../../../src/core/scheduler/unknown-files.js";
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
import { commonDir, ON, open } from "../../code/helpers.js";
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
/** A machine no test host is: a key for it is never this one's (review 0.1.620 B1). */
const FREEBSD: CoreEnvironmentInputs = { ...OWN, platform: "freebsd", arch: "riscv64" };
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

/** `b`'s runner keyed under `keyedOn`, its runs on `ranOn`; `null`, its reports name no machine. */
function onMachines(
  b: Side,
  keyedOn: CoreEnvironmentInputs,
  ranOn: CoreEnvironmentInputs | null,
): void {
  const environment = b.runner.environment;
  const run = b.runner.run.bind(b.runner);
  Object.assign(b.runner, {
    environment: async () => attachRemoteCore(await environment(), keyedOn),
    run: async (files: readonly TestFileRef[]) =>
      ranOn === null ? run(files) : tagReportCore(await run(files), ranOn),
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
    expect(
      [...readUnknownFiles(fallback.store, fallback.worktreeId as WorktreeId).values()].map(
        (u) => u.reason,
      ),
    ).toEqual([
      "ran on darwin/arm64, Node v26.13.0, not on the machine its key is for (linux/x64, Node v26.13.0); stored under the environment it ran in",
    ]);

    const remote = side(other, { count: 1, policy: RUN_MISSING });
    onMachines(remote, LINUX, LINUX);
    await remote.scheduler.start();
    await remote.quiet();
    expect(remote.runner.ran(F0)).toBe(1);
    expect(passesAt(remote.store, linuxKey)).toBe(1);
    expect(remote.passing()).toBe(1);
  });
});

/*
 * Review 0.1.620 B1 and S3: a report that names no machine ran here, never
 * on the machine the project is keyed to; the coverage of a run stored
 * under another machine's key than the current one goes to that key.
 */
describe("a run here while keyed to another machine (review 0.1.620 B1, S3)", SLOW, () => {
  /** A worktree keyed to `FREEBSD` whose run of `F0` names no machine, once it is quiet. */
  async function untagged() {
    const { main } = claimRepo(1);
    const [remoteKey, hereKey] = await Promise.all([
      keyOn(main, F0, FREEBSD),
      keyOn(main, F0, OWN),
    ]);
    const b = side(main, { count: 1, policy: RUN_MISSING });
    onMachines(b, FREEBSD, null);
    await b.scheduler.start();
    await b.quiet();
    return { b, remoteKey, hereKey };
  }

  it("stores an untagged run only under this machine's key, never the keyed remote's", async () => {
    const { b, remoteKey, hereKey } = await untagged();
    expect(remoteKey).not.toBe(hereKey);
    expect(b.keyOf(F0)).toBe(remoteKey);
    expect(b.runner.ran(F0)).toBe(1);
    expect(b.store.results.byKey(remoteKey, 0)).toEqual([]);
    expect(passesAt(b.store, hereKey)).toBe(1);
    expect(b.passing()).toBe(0);
    expect(b.phase(F0)).not.toBe("current");
  });

  it("stores the run's coverage under the key its results are under, none under the current key", async () => {
    const { b, remoteKey, hereKey } = await untagged();
    const runId = b.store.results.byKey(hereKey, 0)[0]?.provenance.runId;
    if (runId === undefined) throw new Error("the run stored its results here");
    const resultKey = mainStoreResultKey(b.store, b.worktreeId as WorktreeId);
    const ref: TestFileRef = { project: "", path: F0 };
    expect(resultKey(runId, ref)).toBe(hereKey);
    // Neither another run's nor another file's.
    expect(resultKey(randomUUID(), ref)).toBeUndefined();
    expect(resultKey(runId, { project: "", path: fileName(1) })).toBeUndefined();

    const dir = commonDir();
    const writer = createCoverageWriter({
      commonDir: dir,
      format: "sha1",
      policy: () => ON,
      resultKey,
      log: () => {},
      waitsMs: [0],
      worker: null,
    });
    writer.collected({ runId, files: [payloadFile(F0)] });
    await writer.idle();
    await writer.close();
    const code = open(dir);
    const at = (key: CheckKey) => ({ resultKey: key, providerVersion: COVERAGE_RECORD_VERSION });
    expect(code.coverage.has(at(hereKey))).toBe(true);
    expect(code.coverage.has(at(remoteKey))).toBe(false);

    // Edit protection: once the file is at another key, the run's record waits for no result.
    const [row] = b.store.testFileKeys.list(b.worktreeId as WorktreeId, [ref]);
    if (row === undefined) throw new Error("the file has a row");
    b.store.testFileKeys.upsertMany([{ ...row, key: "edited" as CheckKey }]);
    expect(resultKey(runId, ref)).toBeUndefined();
  });
});

/*
 * Review 0.1.620-r2 S3 (row 026-19): the key a run here stored a file under
 * while keyed to another machine is a fact of its recording, not of the
 * unknown-file history, which keeps only the newest `UNKNOWN_FILES_KEPT`.
 */
describe("coverage of a run here above the unknown-file cap (review 0.1.620-r2 S3)", SLOW, () => {
  const COUNT = UNKNOWN_FILES_KEPT + 4;

  it("stores every file's coverage under its executed key, and none once a file is re-keyed", async () => {
    const { main } = claimRepo(COUNT);
    const b = side(main, { count: COUNT, policy: RUN_MISSING });
    onMachines(b, FREEBSD, null);
    await b.scheduler.start();
    await b.quiet();
    const worktreeId = b.worktreeId as WorktreeId;

    const files = Array.from({ length: COUNT }, (_, i) => {
      const path = fileName(i);
      const ref: TestFileRef = { project: "", path };
      const remoteKey = b.keyOf(path) as CheckKey;
      const newest = b.store.results.newestForTestFile(ref);
      const hereKey = newest[0]?.key;
      const runId = newest[0]?.provenance.runId;
      if (hereKey === undefined || runId === undefined) throw new Error(`${path} stored nothing`);
      return { path, ref, remoteKey, hereKey, runId };
    });
    // Each ran once here, stored under this machine's key only, and is unknown at the remote's.
    for (const { path, remoteKey, hereKey } of files) {
      expect(b.runner.ran(path), path).toBe(1);
      expect(hereKey, path).not.toBe(remoteKey);
      expect(passesAt(b.store, hereKey), path).toBe(1);
      expect(b.store.results.byKey(remoteKey, 0), path).toEqual([]);
      expect(b.phase(path), path).not.toBe("current");
    }
    expect(await keyOn(main, F0, OWN)).toBe(files[0]?.hereKey);
    // The diagnostic history dropped the oldest files.
    const unknown = readUnknownFiles(b.store, worktreeId);
    expect(unknown.size).toBe(UNKNOWN_FILES_KEPT);
    const evicted = files.filter((f) => !unknown.has(testFileId(f.ref)));
    expect(evicted).toHaveLength(COUNT - UNKNOWN_FILES_KEPT);
    const recent = files.filter((f) => unknown.has(testFileId(f.ref)));

    const resultKey = mainStoreResultKey(b.store, worktreeId);
    for (const { path, ref, hereKey, runId } of files) {
      expect(resultKey(runId, ref), path).toBe(hereKey);
      expect(resultKey(randomUUID(), ref), path).toBeUndefined();
    }

    const written = await writeCoverage(resultKey, files);
    for (const { path, hereKey, remoteKey } of files) {
      expect(written.has(at(hereKey)), path).toBe(true);
      expect(written.has(at(remoteKey)), path).toBe(false);
    }

    // Edit protection: an evicted and a recent file at another key take no coverage.
    const rekeyed = [evicted[0], recent.at(-1)].filter((f) => f !== undefined);
    expect(rekeyed).toHaveLength(2);
    const rows = b.store.testFileKeys.list(
      worktreeId,
      rekeyed.map((f) => f.ref),
    );
    b.store.testFileKeys.upsertMany(rows.map((row) => ({ ...row, key: "edited" as CheckKey })));
    for (const { path, ref, runId } of rekeyed) expect(resultKey(runId, ref), path).toBeUndefined();
    const after = await writeCoverage(resultKey, rekeyed);
    for (const { path, hereKey } of rekeyed) expect(after.has(at(hereKey)), path).toBe(false);
    expect(after.has(at("edited" as CheckKey))).toBe(false);
  });
});

/** The coverage store key of `key`'s records. */
const at = (key: CheckKey) => ({ resultKey: key, providerVersion: COVERAGE_RECORD_VERSION });

/** A fresh code store with each file's coverage written through `CoverageWriter`, by run. */
async function writeCoverage(
  resultKey: ReturnType<typeof mainStoreResultKey>,
  files: readonly { path: string; runId: string }[],
) {
  const dir = commonDir();
  const writer = createCoverageWriter({
    commonDir: dir,
    format: "sha1",
    policy: () => ON,
    resultKey,
    log: () => {},
    waitsMs: [0],
    worker: null,
  });
  for (const runId of new Set(files.map((f) => f.runId))) {
    const ran = files.filter((f) => f.runId === runId);
    writer.collected({ runId, files: ran.map((f) => payloadFile(f.path)) });
  }
  await writer.idle();
  await writer.close();
  return open(dir).coverage;
}

/** A coverage payload of one source line, run by `test`. */
function payloadFile(test: string): CoveredFile {
  const dir = mkdtempSync(join(tmpdir(), "sq-026-s3-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const text = "f();\n";
  const path = join(dir, "a.js");
  writeFileSync(path, text);
  const payload = join(dir, "payload.json");
  const ranges = [{ startOffset: 0, endOffset: text.length, count: 1 }];
  writeFileSync(
    payload,
    JSON.stringify({
      result: [{ url: `file://${path}`, functions: [{ functionName: "", ranges }] }],
    }),
  );
  const sha1 = createHash("sha1").update(text).digest("hex");
  return {
    testFile: { project: "", path: test },
    payload,
    sources: new Map([[path, { path: "a.js", code: text, map: null, sha1 }]]),
  };
}

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
      `Node v24.0.0 on the remote does not meet the project's Node pin "26", ">=26.1" (${OWN.nodeVersion} here)`,
    ]);
    const none = scratch();
    expect(await nodePinsAt(none)).toEqual([]);
    expect((await compare(none, host(none, node).remote, "remote-key")).differences).toEqual([
      `Node v26.99.0 on the remote, ${OWN.nodeVersion} here`,
    ]);
  });
});
