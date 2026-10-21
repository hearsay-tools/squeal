import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { createFsHasher } from "../../src/core/hash/index.js";
import { encodeSegment, keyFromSegments } from "../../src/core/keys/check-key.js";
import {
  coreEnvironmentInputs,
  environmentHash,
  KEY_FORMAT_VERSION,
} from "../../src/core/keys/index.js";
import {
  type CheckKey,
  DEFAULT_POLICY,
  type EpochMs,
  type ResultRecord,
  type Store,
} from "../../src/core/types/index.js";
import { writeInstall } from "../keys/install.js";
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

/** `path`'s key in the worktree at `root` with the fake runner's environment over `installed`. */
async function keyOver(
  root: string,
  path: string,
  installed: string,
  format = KEY_FORMAT_VERSION,
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
  return keyFromSegments(envHash, { project: "", path }, [encodeSegment(path, hash)]);
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
