import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { createFsHasher } from "../../src/core/hash/index.js";
import { absentSegment, encodeSegment, keyFromSegments } from "../../src/core/keys/check-key.js";
import {
  coreEnvironmentInputs,
  environmentHash,
  installedDependencies,
  KEY_FORMAT_VERSION,
} from "../../src/core/keys/index.js";
import {
  type CheckKey,
  DEFAULT_POLICY,
  type EpochMs,
  type ResultRecord,
  type Store,
} from "../../src/core/types/index.js";
import { type PnpmFixture, writeInstall, writePnpmInstall } from "../keys/install.js";
import { claimRepo, FakeRunner, fileName, side } from "./claims-fixture.js";

/*
 * Row 011-90 (task 011-85 R4; 011 C3, C4 step 3, C7): a lookup that misses at
 * its key also reads the key the definition before 011-85 gave the file, at
 * the current format and each format read as one. That definition hashed
 * npm's hidden lockfile whole, the root's version in it. A set found there is
 * copied to the file's key with its provenance and record time, so the
 * release that ships 011-85 re-keys no check, and another worktree with
 * another root version finds the set at the new key.
 */

const HIDDEN = "node_modules/.package-lock.json";
const [F0, F1, F2] = [0, 1, 2].map(fileName) as [string, string, string];
const LOOKUP_ONLY = { baseline: { onStart: "lookup-only" as const } };
const IGNORED = { ".gitignore": "node_modules/\n" };
/** Real schedulers, a real store and git: a loaded host needs headroom. */
const SLOW = { timeout: 60_000 } as const;

/** The fingerprint the definition before 011-85 took of an install without patches: the file whole. */
const wholeOf = (content: Buffer | string) =>
  createHash("sha256").update(`${HIDDEN}\0`).update(content).digest("hex");

/**
 * `path`'s key in the worktree at `root` with the fake runner's environment over `installed`.
 * `absent` are closure paths with no file, each sorting before `path`, keyed as before task
 * 011-158 (`absentSegment`); keys since then hold none.
 */
async function keyOver(
  root: string,
  path: string,
  installed: string,
  format = KEY_FORMAT_VERSION,
  absent: readonly string[] = [],
): Promise<CheckKey> {
  const [environment] = await new FakeRunner([]).environment();
  if (environment === undefined) throw new Error("the fake runner has an environment");
  const core = coreEnvironmentInputs({
    squealVersion: "0.0.0-test",
    installedDependencies: installed,
    allowlist: DEFAULT_POLICY.env.allowlist,
  });
  const envHash = environmentHash(core, environment, () => null, format);
  const hash = await createFsHasher(root, "sha1").hash(path);
  const segments = [...absent.map(absentSegment), encodeSegment(path, hash)];
  return keyFromSegments(envHash, { project: "", path }, segments);
}

/** A passing result of `path` at `key`, by `worktreeId`, recorded at `at`. */
function stored(store: Store, worktreeId: string, path: string, key: CheckKey, at: EpochMs) {
  const record: ResultRecord = {
    check: { kind: "test", project: "", testPath: path, fullName: "passes" },
    key,
    outcome: "pass",
    durationMs: 1,
    location: null,
    fingerprint: null,
    summary: null,
    errors: [],
    provenance: {
      worktreeId,
      revision: 7,
      commit: "0".repeat(40),
      dirty: false,
      runId: randomUUID(),
      recordedAt: at,
    },
  };
  store.results.putMany([record]);
  return record;
}

const provenanceAt = (store: Store, key: CheckKey) =>
  store.results.byKey(key, 0).map((r) => r.provenance);

describe("the definition before 011-85 read as one (011-90)", SLOW, () => {
  it("settles a file from a pass stored under its former key under lookup-only, copies it to the new key, and reads no other install's", async () => {
    const { main, others } = claimRepo(3, IGNORED, 2);
    const [first, second] = others as [string, string];
    const a = worktreeIdFor(main);
    const install = { "node_modules/a": { version: "1.0.0" } };
    writeInstall(first, install, "1.4.0");
    const content = readFileSync(join(first, HIDDEN), "utf8");
    const former = wholeOf(content);
    // Another install: a's version, not the root's, differs.
    const another = wholeOf(content.replace('"version":"1.0.0"', '"version":"2.0.0"'));
    expect(another).not.toBe(former);

    const b = side(first, { count: 3, policy: LOOKUP_ONLY });
    const t = Date.now() - 60_000;
    // F0 at the current format, F1 at the newest format read as one, F2 under another install.
    const f0 = stored(b.store, a, F0, await keyOver(first, F0, former), t);
    const f1 = stored(b.store, a, F1, await keyOver(first, F1, former, KEY_FORMAT_VERSION - 1), t);
    stored(b.store, a, F2, await keyOver(first, F2, another), t);
    await b.scheduler.start();
    await b.scheduler.idle();

    expect(b.runner.runs).toEqual([]);
    expect(b.passing()).toBe(2);
    const k0 = b.keyOf(F0) as CheckKey;
    const k1 = b.keyOf(F1) as CheckKey;
    expect(k0).not.toBe(await keyOver(first, F0, former));
    expect(provenanceAt(b.store, k0)).toEqual([f0.provenance]);
    expect(provenanceAt(b.store, k1)).toEqual([f1.provenance]);
    expect(provenanceAt(b.store, b.keyOf(F2) as CheckKey)).toEqual([]);

    // A second worktree, a release later: another root version, the same keys, the copied sets.
    writeInstall(second, install, "1.5.0");
    const c = side(second, { count: 3, policy: LOOKUP_ONLY });
    await c.scheduler.start();
    await c.scheduler.idle();
    expect(c.runner.runs).toEqual([]);
    expect([c.keyOf(F0), c.keyOf(F1)]).toEqual([k0, k1]);
    expect(c.passing()).toBe(2);
  });
});

/*
 * Row 011-167 (task 011-162 R3; 011 C3): a trusted pnpm install gives per-package keys (011-166),
 * so a project whose environment becomes scoped changes every key. A lookup that misses also reads
 * the key today's pnpm definition gave the file, the whole fingerprint in the environment hash and
 * no segment, at the current format, while `lock.yaml` stands for the install. The definition
 * before 011-85 read no pnpm graph either: its keys stay whole.
 */

const PNPM_LOCK = "node_modules/.pnpm/lock.yaml";
const PNPM: PnpmFixture = { importers: { ".": { a: "1.0.0" } }, snapshots: { "a@1.0.0": {} } };

/** A test file's snapshot path, absent here, as every Vitest closure names it. */
const snapshotOf = (path: string) => `${path.replace("test/", "test/__snapshots__/")}.snap`;

/**
 * The fake runner with packages: a scoped environment, F1 reaching a process, the others `a`.
 * With `absent`, each closure also names the file's snapshot path, which has no file.
 */
function withPackages(runner: FakeRunner, absent = false): void {
  const environment = runner.environment;
  runner.environment = async () =>
    (await environment()).map((env) => ({ ...env, packages: { imports: [], builtins: [] } }));
  runner.closure = async (testFile) => ({
    testFile,
    paths: absent ? [snapshotOf(testFile.path), testFile.path] : [testFile.path],
    packages:
      testFile.path === F1
        ? { imports: [], builtins: ["child_process"] }
        : { imports: [{ from: "", name: "a" }], builtins: [] },
  });
}

describe("today's pnpm definition read as one (011-167)", SLOW, () => {
  it("settles a file from a pass stored under today's pnpm key under lookup-only and copies it to the new key", async () => {
    const { main, others } = claimRepo(3, IGNORED, 1);
    const [first] = others as [string];
    writePnpmInstall(first, PNPM);
    const installed = await installedDependencies(first, first);
    expect([installed.note, installed.graph === null]).toEqual([null, false]);
    const today = installed.fingerprint;

    const b = side(first, { count: 3, policy: LOOKUP_ONLY });
    withPackages(b.runner);
    const t = Date.now() - 60_000;
    const a = worktreeIdFor(main);
    const f0 = stored(b.store, a, F0, await keyOver(first, F0, today), t);
    const f1 = stored(b.store, a, F1, await keyOver(first, F1, today), t);
    // At a format read as one: today's pnpm definition stored at format 20 only.
    stored(b.store, a, F2, await keyOver(first, F2, today, KEY_FORMAT_VERSION - 1), t);
    await b.scheduler.start();
    await b.scheduler.idle();

    expect(b.runner.runs).toEqual([]);
    expect(b.passing()).toBe(2);
    const k0 = b.keyOf(F0) as CheckKey;
    expect(k0).not.toBe(await keyOver(first, F0, today));
    expect(b.keyOf(F1)).not.toBe(await keyOver(first, F1, today));
    expect(provenanceAt(b.store, k0)).toEqual([f0.provenance]);
    expect(provenanceAt(b.store, b.keyOf(F1) as CheckKey)).toEqual([f1.provenance]);
    expect(provenanceAt(b.store, b.keyOf(F2) as CheckKey)).toEqual([]);
  });

  // Third round of review 0.1.282 (row 011-158): 0.1.280 to 0.1.284 stored today's pnpm key with
  // an absent path's `absentSegment`, 0.1.285 to 0.1.287 with none; both are read.
  it("finds a pass stored under today's pnpm key over an absent path under each absent rule", async () => {
    const { main, others } = claimRepo(3, IGNORED, 1);
    const [first] = others as [string];
    writePnpmInstall(first, PNPM);
    const today = (await installedDependencies(first, first)).fingerprint;

    const b = side(first, { count: 3, policy: LOOKUP_ONLY });
    withPackages(b.runner, true);
    const t = Date.now() - 60_000;
    const a = worktreeIdFor(main);
    const before158 = await keyOver(first, F0, today, KEY_FORMAT_VERSION, [snapshotOf(F0)]);
    const f0 = stored(b.store, a, F0, before158, t);
    const f2 = stored(b.store, a, F2, await keyOver(first, F2, today), t);
    await b.scheduler.start();
    await b.scheduler.idle();

    expect(b.runner.runs).toEqual([]);
    expect(provenanceAt(b.store, b.keyOf(F0) as CheckKey)).toEqual([f0.provenance]);
    expect(provenanceAt(b.store, b.keyOf(F2) as CheckKey)).toEqual([f2.provenance]);
  });

  it("reads no row under today's pnpm key while lock.yaml does not describe the install", async () => {
    const { main, others } = claimRepo(1, IGNORED, 1);
    const [first] = others as [string];
    writePnpmInstall(first, PNPM);
    const today = (await installedDependencies(first, first)).fingerprint;
    mkdirSync(join(first, "node_modules/extra"));
    const stale = await installedDependencies(first, first);
    expect(stale.note).toMatch(/not listed in it: node_modules\/extra/);

    const b = side(first, { count: 1, policy: LOOKUP_ONLY });
    withPackages(b.runner);
    stored(b.store, worktreeIdFor(main), F0, await keyOver(first, F0, today), Date.now());
    await b.scheduler.start();
    await b.scheduler.idle();
    expect(b.passing()).toBe(0);
    expect(provenanceAt(b.store, b.keyOf(F0) as CheckKey)).toEqual([]);
  });

  it("keys the definition before 011-85 whole for pnpm, so its rows are read too", async () => {
    const { main, others } = claimRepo(1, IGNORED, 1);
    const [first] = others as [string];
    writePnpmInstall(first, PNPM);
    const content = readFileSync(join(first, PNPM_LOCK));
    const before = createHash("sha256").update(`${PNPM_LOCK}\0`).update(content).digest("hex");

    const b = side(first, { count: 1, policy: LOOKUP_ONLY });
    withPackages(b.runner);
    const f0 = stored(
      b.store,
      worktreeIdFor(main),
      F0,
      await keyOver(first, F0, before),
      Date.now(),
    );
    await b.scheduler.start();
    await b.scheduler.idle();
    expect(b.runner.runs).toEqual([]);
    expect(b.passing()).toBe(1);
    expect(provenanceAt(b.store, b.keyOf(F0) as CheckKey)).toEqual([f0.provenance]);
  });
});
