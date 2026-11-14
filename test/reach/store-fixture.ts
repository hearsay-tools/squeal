import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CliIo } from "../../src/cli/main.js";
import { reachCommand } from "../../src/cli/reach.js";
import { COVERAGE_RECORD_VERSION, encodeRecord } from "../../src/core/code/coverage/record.js";
import { isCodeStoreOpenFailure, openCodeStore } from "../../src/core/code/store/open.js";
import type { Store } from "../../src/core/types/store.js";
import { ON as CODE_ON } from "../code/helpers.js";
import { type FakeRepo, fakeRepo, seedStore } from "../status/helpers.js";

/* `squeal reach` against a real store (row 015-109): a seeded worktree and the command's output. */

export const A = "test/a.test.ts";
export const B = "test/b.test.ts";
export const SRC = ["src/one.ts", "src/two.ts"];

export const open: Store[] = [];
/** Closes every store a test opened; each test file calls it from `afterEach`. */
export function closeStores() {
  for (const store of open.splice(0)) store.close();
}

export function run(cwd: string, args: string[]) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (t) => {
      stdout += t;
    },
    stderr: (t) => {
      stderr += t;
    },
    cwd,
    env: {},
  };
  return reachCommand(args, io).then((code) => ({ code, stdout, stderr }));
}

/**
 * Listed test files A over `src/one.ts` and B over both sources, with
 * recorded seconds only when `ran`; with `staleB`, B's result is at an
 * older key, so it has seconds and no result at its current key.
 */
export function seeded(
  policy: object,
  { ran = true, staleB = false } = {},
): { repo: FakeRepo; store: Store } {
  const repo = fakeRepo();
  writeFileSync(join(repo.main, "squeal.config.json"), JSON.stringify(policy));
  // 015-122: the report lists only paths the worktree has.
  mkdirSync(join(repo.main, "src"), { recursive: true });
  for (const path of SRC) writeFileSync(join(repo.main, path), "export const value = 1;\n");
  const store = seedStore(repo);
  open.push(store);
  store.worktrees.upsert({
    id: repo.mainId,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  store.testFileKeys.upsertMany(
    [A, B].map((path) => ({
      worktreeId: repo.mainId,
      testFile: { project: "", path },
      key: `key-${path}`,
      revision: 1,
      pending: null,
    })),
  );
  for (const path of [A, B]) {
    store.testFiles.put({
      testFile: { project: "", path },
      closure: {
        testFile: { project: "", path },
        paths: path === A ? [A, "src/one.ts"] : [B, ...SRC],
        complete: true,
        method: "static imports plus declared inputs",
      },
      updatedAt: 1,
      updatedBy: repo.mainId,
    });
  }
  const timed = ran ? [A, B] : [];
  store.results.putMany(
    timed.map((path, i) => ({
      check: { kind: "file", project: "", testPath: path },
      key: staleB && path === B ? "key-older" : `key-${path}`,
      outcome: "pass",
      durationMs: (i + 1) * 1000,
      location: null,
      fingerprint: null,
      summary: null,
      errors: [],
      provenance: {
        worktreeId: repo.mainId,
        revision: 1,
        commit: null,
        dirty: true,
        runId: "run-1",
        recordedAt: 1,
      },
    })),
  );
  store.transaction(() => {
    for (const [at, trigger, paths] of [
      [1, "start", ["src/one.ts"]],
      [2, "watch", ["src/one.ts"]],
      [3, "watch", ["src/one.ts", "src/two.ts"]],
    ] as const) {
      store.revisions.append({
        worktreeId: repo.mainId,
        createdAt: Date.UTC(2026, 10, at),
        head: null,
        dirty: true,
        trigger,
        changes: paths.map((path) => ({ path, oldHash: "h0", newHash: `h${at}` })),
      });
    }
  });
  return { repo, store };
}

/** A's record calls `src/one.ts`; B's loads both and calls none. */
export function records(repo: FakeRepo) {
  const code = openCodeStore(repo.commonDir, CODE_ON);
  if (isCodeStoreOpenFailure(code)) throw new Error(JSON.stringify(code));
  const source = (path: string, hit: 0 | 1) => ({
    path,
    blob: `blob-${path}`,
    lines: "",
    covered: "",
    functions: [
      [1, 0, 9, 1, 1],
      [2, 2, 4, 3, hit],
    ] as const,
  });
  const put = (key: string, sources: ReturnType<typeof source>[]) =>
    code.coverage.put(
      { resultKey: key, providerVersion: COVERAGE_RECORD_VERSION },
      encodeRecord({ v: 1, sources, unread: [] }),
      1,
    );
  put(`key-${A}`, [source("src/one.ts", 1)]);
  put(`key-${B}`, [source("src/one.ts", 0), source("src/two.ts", 0)]);
  code.close();
}

export const ON = { complexity: { enabled: true }, coverage: { enabled: true } };
