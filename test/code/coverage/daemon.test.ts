import { cpSync, existsSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  COVERAGE_PROVIDER_VERSION,
  type CoverageRecord,
  decodeRecord,
} from "../../../src/core/code/coverage/index.js";
import {
  codeStorePath,
  isCodeStoreOpenFailure,
  openCodeStore,
} from "../../../src/core/code/store/index.js";
import { startDaemon } from "../../../src/core/daemon/daemon.js";
import { daemonScratch } from "../../../src/core/daemon/scratch.js";
import { worktreeIdFor } from "../../../src/core/fs/index.js";
import type { CheckKey, Store, TestFileKeyRecord } from "../../../src/core/types/index.js";
import {
  createFixtureRepo,
  type FixtureRepo,
  SLOW,
  waitFor,
  withStore,
} from "../../daemon/helpers.js";
import { git } from "../../hash/git-repo.js";
import { ON } from "../helpers.js";

/*
 * Spec 015 D8, goal 9 (row 015-11): with `coverage.enabled`, the runs a
 * daemon makes anyway leave one record per test file at its result's key,
 * which a second worktree reads with the result it adopts; with complexity
 * off the policy turns nothing on and no code store is made (D1, goal 1).
 */

const TEST_FILES = 5;

const policy = (complexity: boolean) =>
  `${JSON.stringify({
    complexity: { enabled: complexity },
    coverage: { enabled: true },
    baseline: { onStart: "lookup-then-run-missing" },
  })}\n`;

/** The record at `key`; `null` while there is none or no code store. */
function recordAt(commonDir: string, key: CheckKey): CoverageRecord | null {
  const store = openCodeStore(commonDir, ON, { create: false });
  if (isCodeStoreOpenFailure(store)) return null;
  try {
    const bytes = store.coverage.get({
      resultKey: key,
      providerVersion: COVERAGE_PROVIDER_VERSION,
    });
    return bytes === null ? null : decodeRecord(bytes);
  } finally {
    store.close();
  }
}

/** The worktree's keyed test files once every one has a result at its key, else `null`. */
function resultsIn(store: Store, worktreeId: string): readonly TestFileKeyRecord[] | null {
  const rows = store.testFileKeys.list(worktreeId);
  const done = rows.filter((r) => r.key !== null && store.results.byKey(r.key, 0).length > 0);
  return rows.length === TEST_FILES && done.length === TEST_FILES ? rows : null;
}

async function serve(root: string, env: NodeJS.ProcessEnv) {
  const daemon = await startDaemon({ root, env });
  if ("reason" in daemon) throw new Error(daemon.message);
  await daemon.ready;
  return daemon;
}

describe("coverage records from the daemon's runs (015 D8)", SLOW, () => {
  it("keeps one record per test file at its result's key, which a second worktree adopts", async () => {
    const repo = createFixtureRepo({ files: { "squeal.config.json": policy(true) } });
    onTestFinished(repo.cleanup);
    const first = await serve(repo.root, repo.env);
    const rows = await waitFor(
      () => {
        const keyed = withStore(repo, (store) => resultsIn(store, repo.worktreeId));
        return keyed?.every((r) => r.key !== null && recordAt(repo.commonDir, r.key) !== null)
          ? keyed
          : null;
      },
      120_000,
      "a record at every result's key",
    );
    await first.stop("stop-requested");

    const math = rows.find((r) => r.testFile.path === "test/math.test.ts");
    const record = math?.key ? recordAt(repo.commonDir, math.key) : null;
    const hash = withStore(repo, (store) => store.fileHashes.get(repo.worktreeId, "src/math.ts"));
    expect(record?.sources.find((s) => s.path === "src/math.ts")?.blob).toBe(hash?.hash);
    // Nothing is written into the worktree, and the payloads are gone from the temp directory.
    expect(existsSync(join(repo.root, "coverage"))).toBe(false);
    const tempDir = daemonScratch(repo.commonDir, repo.root).tempDir;
    const left = existsSync(tempDir)
      ? readdirSync(tempDir, { recursive: true }).filter((f) => String(f).endsWith(".json"))
      : [];
    expect(left).toEqual([]);

    // A second worktree at the same commit, with the generated file codegen would write.
    const second = join(repo.root, "..", "second");
    git(repo.root, ["worktree", "add", "-q", "-b", "second", second]);
    cpSync(join(repo.root, "src/gen"), join(second, "src/gen"), { recursive: true });
    const root = realpathSync(second);
    const worktreeId = worktreeIdFor(root);
    const daemon = await serve(root, repo.env);
    onTestFinished(() => daemon.stop("stop-requested").then(() => {}));
    const adopted = await waitFor(
      () => withStore(repo, (store) => resultsIn(store, worktreeId)),
      60_000,
      "the second worktree's results",
    );

    const keys = (list: readonly TestFileKeyRecord[]) =>
      list.map((r) => [r.testFile.path, r.key]).sort();
    expect(keys(adopted)).toEqual(keys(rows));
    // Adopted, not run: each result was produced in the first worktree.
    const producers = withStore(repo, (store) =>
      adopted.flatMap((r) => store.results.byKey(r.key, 0).map((x) => x.provenance.worktreeId)),
    );
    expect([...new Set(producers)]).toEqual([repo.worktreeId]);
    for (const row of adopted) {
      expect(row.key === null ? null : recordAt(repo.commonDir, row.key)).not.toBeNull();
    }
  });

  it("with complexity off, runs with coverage off and makes no code store", async () => {
    const repo: FixtureRepo = createFixtureRepo({ files: { "squeal.config.json": policy(false) } });
    onTestFinished(repo.cleanup);
    const daemon = await serve(repo.root, repo.env);
    onTestFinished(() => daemon.stop("stop-requested").then(() => {}));

    await waitFor(
      () => withStore(repo, (store) => resultsIn(store, repo.worktreeId)),
      120_000,
      "every result",
    );

    expect(existsSync(codeStorePath(repo.commonDir))).toBe(false);
    const tempDir = daemonScratch(repo.commonDir, repo.root).tempDir;
    const dirs = existsSync(tempDir) ? readdirSync(tempDir) : [];
    expect(dirs.filter((d) => d.startsWith("coverage-"))).toEqual([]);
  });
});
