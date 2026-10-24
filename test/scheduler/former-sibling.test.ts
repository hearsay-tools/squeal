import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFsHasher } from "../../src/core/hash/index.js";
import { absentSegment, encodeSegment, keyFromSegments } from "../../src/core/keys/check-key.js";
import { coreEnvironmentInputs, environmentHash, testFileId } from "../../src/core/keys/index.js";
import {
  type CheckKey,
  DEFAULT_POLICY,
  type ResultRecord,
  type Store,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { writeInstall } from "../keys/install.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Review 0.1.253 B1 (row 011-90, task 011-85 R4; 011 C3): two file-based
 * Vitest projects, and b's config imports `node:child_process`. The key
 * definition before 011-85 read every project's config files into each
 * project's environment packages, so a's environment was opaque: it held the
 * whole hidden lockfile, and no test file of a added a segment. Now a's is
 * scoped. A pass 0.1.252 stored for a's test file is found at the first
 * lookup under `lookup-only`, and nothing runs.
 */

const HIDDEN = "node_modules/.package-lock.json";
const A: TestFileRef = { project: "a", path: "a/a.test.ts" };
const B: TestFileRef = { project: "b", path: "b/b.test.ts" };
const config = (name: string, head = "") =>
  `${head}export default { test: { name: "${name}", include: ["*.test.ts"] } };\n`;
const FILES = {
  "vitest.config.ts":
    'export default { test: { projects: ["a/vitest.config.ts", "b/vitest.config.ts"] } };\n',
  "a/vitest.config.ts": config("a"),
  "a/a.test.ts": 'import { it } from "vitest";\nit("passes", () => {});\n',
  "b/vitest.config.ts": config("b", 'import "node:child_process";\n'),
  "b/b.test.ts": 'import { it } from "vitest";\nit("passes", () => {});\n',
};
const LOOKUP_ONLY = { baseline: { onStart: "lookup-only" as const } };

/**
 * The key 0.1.252 gave `testFile` over the hidden lockfile `lockfile`: its
 * project's environment over every project's config files (`formerFiles`),
 * opaque through b's builtin, so the lockfile whole and no
 * installed-dependency segment. Its closure's absent snapshot path entered
 * the key then (`absentSegment`, before task 011-158).
 */
async function formerKey(h: Harness, testFile: TestFileRef, lockfile: string): Promise<CheckKey> {
  const environment = (await h.runner.environment()).find((e) => e.project === testFile.project);
  const files = environment?.formerFiles;
  if (environment === undefined || files === undefined) throw new Error("no former files");
  const hasher = createFsHasher(h.root, "sha1");
  const closure = await h.runner.closure(testFile);
  const paths = [...new Set([testFile.path, ...closure.paths])].sort();
  const hashes = new Map<string, string | null>();
  for (const path of [...files, ...paths]) hashes.set(path, await hasher.hash(path));
  const whole = createHash("sha256").update(`${HIDDEN}\0`).update(lockfile).digest("hex");
  const core = coreEnvironmentInputs({
    squealVersion: "0.0.0-test",
    installedDependencies: whole,
    allowlist: DEFAULT_POLICY.env.allowlist,
  });
  const envHash = environmentHash(core, { ...environment, files }, (path) => hashes.get(path));
  const segments = paths.map((path) => {
    const hash = hashes.get(path) ?? null;
    return hash === null ? absentSegment(path) : encodeSegment(path, hash);
  });
  return keyFromSegments(envHash, testFile, segments);
}

/** A pass of `testFile` at `key`, stored by another worktree a minute ago. */
function stored(store: Store, testFile: TestFileRef, key: CheckKey): ResultRecord {
  const record: ResultRecord = {
    check: { kind: "test", project: testFile.project, testPath: testFile.path, fullName: "passes" },
    key,
    outcome: "pass",
    durationMs: 1,
    location: null,
    fingerprint: null,
    summary: null,
    errors: [],
    provenance: {
      worktreeId: "0.1.252",
      revision: 7,
      commit: "0".repeat(40),
      dirty: false,
      runId: randomUUID(),
      recordedAt: Date.now() - 60_000,
    },
  };
  store.results.putMany([record]);
  return record;
}

describe(
  "a pass stored while a sibling's config made the environment opaque (review 0.1.253 B1)",
  SLOW,
  () => {
    it("is found at the first lookup under lookup-only and copied to the new key; another install's is not read", async () => {
      const repo = createRepo();
      const store = openRepoStore(repo.commonDir);
      git(repo.main, ["rm", "-rq", "test"]);
      for (const [path, content] of Object.entries(FILES)) {
        mkdirSync(dirname(join(repo.main, path)), { recursive: true });
        writeFileSync(join(repo.main, path), content);
      }
      git(repo.main, ["add", "-A"]);
      git(repo.main, ["commit", "-qm", "two file-based projects"]);
      writeInstall(repo.main, { "node_modules/x": { version: "1.0.0" } }, "1.4.0");
      const lockfile = readFileSync(join(repo.main, HIDDEN), "utf8");
      const x = '"node_modules/x":{"version":"';
      const another = lockfile.replace(`${x}1.0.0"`, `${x}2.0.0"`);
      expect(another).not.toBe(lockfile);
      const h = await openHarness(repo.main, store, repo.commonDir, { policy: LOOKUP_ONLY });
      const former = await formerKey(h, A, lockfile);
      const record = stored(store, A, former);
      stored(store, B, await formerKey(h, B, another));

      await h.scheduler.start();
      await h.scheduler.idle();

      expect(h.runsOf(A.path)).toEqual([]);
      const row = store.testFileKeys
        .list(h.worktreeId)
        .find((r) => testFileId(r.testFile) === testFileId(A));
      expect(row?.key).toBeDefined();
      expect(row?.key).not.toBe(former);
      const states = store.knownStates
        .list(h.worktreeId)
        .filter((s) => s.check.testPath === A.path);
      expect(states.map((s) => s.outcome)).toEqual(["pass"]);
      const copied = store.results.byKey(row?.key as CheckKey, 0).map((r) => r.provenance);
      expect(copied).toEqual([record.provenance]);

      // b's pass lies under another install's former key: b stays without a result.
      const b = store.testFileKeys
        .list(h.worktreeId)
        .find((r) => testFileId(r.testFile) === testFileId(B));
      expect(b?.key).toBeDefined();
      expect(store.results.byKey(b?.key as CheckKey, 0)).toEqual([]);
      expect(
        store.knownStates.list(h.worktreeId).filter((s) => s.check.testPath === B.path),
      ).toEqual([]);
    });
  },
);
