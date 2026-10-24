import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createFsHasher } from "../../src/core/hash/index.js";
import { absentSegment, encodeSegment, keyFromSegments } from "../../src/core/keys/check-key.js";
import {
  coreEnvironmentInputs,
  environmentHash,
  KEY_FORMAT_VERSION,
} from "../../src/core/keys/index.js";
import {
  type CheckKey,
  DEFAULT_POLICY,
  type ResultRecord,
  type Store,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { claimRepo, FakeRunner, fileName, side } from "./claims-fixture.js";

/*
 * Review 0.1.285 B1 (row 011-158; 011 C3, C4 step 3): the start's first
 * lookup keys a file from the shared closure list, which another branch
 * wrote last with a path only it has. A re-check keys it from this
 * worktree's own closure, which drops that path. Both name the file's absent
 * snapshot path. The current key leaves both absent paths out, so it stays
 * equal; the key before 011-158 holds them, so it moves to the key of a pass
 * stored before the upgrade. The second lookup reads that key, copies the
 * pass and runs nothing. A miss whose keys read as one stay equal, F1's, is
 * read at the first lookup only.
 */

const [F0, F1] = [0, 1].map(fileName) as [string, string];
const REF: TestFileRef = { project: "", path: F0 };
/** A test file's snapshot path, absent here, as every Vitest closure names it. */
const snapshotOf = (path: string) => `${path.replace("test/", "test/__snapshots__/")}.snap`;
const SNAPSHOT = snapshotOf(F0);
const BRANCH_ONLY = "src/branch-only.ts";
/** Real schedulers, a real store and git: a loaded host needs headroom. */
const SLOW = { timeout: 60_000 } as const;

/** `F0`'s key over `paths` (sorted, the file among them) before 011-158, at the current format. */
async function keyBefore158(root: string, paths: readonly string[]): Promise<CheckKey> {
  const [environment] = await new FakeRunner([]).environment();
  if (environment === undefined) throw new Error("the fake runner has an environment");
  const core = coreEnvironmentInputs({
    squealVersion: "0.0.0-test",
    installedDependencies: "none",
    allowlist: DEFAULT_POLICY.env.allowlist,
  });
  const envHash = environmentHash(core, environment, () => null, KEY_FORMAT_VERSION);
  const hasher = createFsHasher(root, "sha1");
  const segments: string[] = [];
  for (const path of paths) {
    const hash = await hasher.hash(path);
    segments.push(hash === null ? absentSegment(path) : encodeSegment(path, hash));
  }
  return keyFromSegments(envHash, REF, segments);
}

/** A pass of `F0` at `key`, as a worktree before the upgrade stored it, past `STORED_KEYS_OVERLAP_MS`. */
function storedBefore(store: Store, key: CheckKey): ResultRecord {
  const record: ResultRecord = {
    check: { kind: "test", project: "", testPath: F0, fullName: "passes" },
    key,
    outcome: "pass",
    durationMs: 1,
    location: null,
    fingerprint: null,
    summary: null,
    errors: [],
    provenance: {
      worktreeId: "0.1.284",
      revision: 7,
      commit: "0".repeat(40),
      dirty: false,
      runId: randomUUID(),
      recordedAt: Date.now() - 3_600_000,
    },
  };
  store.results.putMany([record]);
  return record;
}

describe(
  "the key before 011-158 after the start's re-check drops a branch-only path (review 0.1.285 B1)",
  SLOW,
  () => {
    it("adopts the pass stored before the upgrade at the second lookup, runs nothing, and reads no unchanged key again", async () => {
      const { other } = claimRepo(2);
      const reads: CheckKey[][] = [];
      const b = side(other, {
        count: 2,
        wrap: (store) => ({
          ...store,
          results: {
            ...store.results,
            copyNewest: (key, from) => {
              reads.push([key, ...from]);
              return store.results.copyNewest(key, from);
            },
          },
        }),
      });
      b.runner.closure = async (testFile) => {
        const paths = [snapshotOf(testFile.path), testFile.path];
        return { testFile, paths };
      };
      const own = await keyBefore158(other, [SNAPSHOT, F0]);
      const record = storedBefore(b.store, own);
      // Another branch resolved F0 last, with a module only it has; F1 as this worktree does.
      const method = "static imports plus declared inputs" as const;
      const lists = [
        { testFile: REF, paths: [BRANCH_ONLY, SNAPSHOT, F0] },
        { testFile: { project: "", path: F1 }, paths: [snapshotOf(F1), F1] },
      ];
      for (const { testFile, paths } of lists) {
        const closure = { testFile, paths, complete: false, method };
        b.store.testFiles.put({ testFile, closure, updatedAt: Date.now(), updatedBy: "branch" });
      }
      expect(await keyBefore158(other, lists[0]?.paths ?? [])).not.toBe(own);

      await b.scheduler.start();
      await b.scheduler.idle();

      expect(b.runner.runs).toEqual([]);
      expect(b.passing()).toBe(1);
      const key = b.keyOf(F0) as CheckKey;
      expect(b.store.results.byKey(key, 0).map((r) => r.provenance)).toEqual([record.provenance]);
      // F0 read at the shared list's keys, then at the own closure's, which hold the stored key.
      const at = (k: CheckKey) => reads.filter(([readKey]) => readKey === k);
      expect(at(key)).toHaveLength(2);
      expect(at(key)[0]).not.toContain(own);
      expect(at(key)[1]).toContain(own);
      // F1's keys read as one stayed equal across both lookups: read once, a miss with nothing copied.
      const missed = b.keyOf(F1) as CheckKey;
      expect(at(missed)).toHaveLength(1);
      expect(b.store.results.byKey(missed, 0)).toEqual([]);
      expect(reads).toHaveLength(3);
    });
  },
);
