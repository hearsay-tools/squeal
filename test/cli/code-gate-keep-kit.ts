import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { storedFiles } from "../../src/cli/code-gate-stored.js";
import { COVERAGE_RECORD_VERSION } from "../../src/core/code/coverage/record.js";
import type { GateReport } from "../../src/core/code/gate/report.js";
import { codeStorePath } from "../../src/core/code/store/open.js";
import { storePaths } from "../../src/core/store/paths.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import { watched } from "../code/gate/collect-fixture.js";
import { createFixtureRepo, type FixtureRepo, withStore } from "../daemon/helpers.js";
import { git, writeFile } from "../hash/git-repo.js";
import { code, type Ran } from "./code-gate-fixture.js";

/*
 * Spec 020 D11.7 and D17.3 (rows 020-07c, 020-17c): `squeal code --base`
 * in a scheduler fixture repository, in this process, with the files each
 * Vitest run was given, and a look at the stores it reads and writes.
 */

/**
 * The policy of the keep tests: complexity and coverage on, the baseline's
 * `onStart`, then `more`.
 */
export function keepPolicy(onStart: string, more: Readonly<Record<string, unknown>> = {}): string {
  const policy = {
    complexity: { enabled: true },
    coverage: { enabled: true },
    baseline: { onStart },
    ...more,
  };
  return `${JSON.stringify(policy)}\n`;
}

/** Writes `files` into `repo`'s working tree. */
export function write(repo: FixtureRepo, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) writeFile(repo.root, path, text);
}

/**
 * A scheduler fixture repository with `policy` as its `squeal.config.json`,
 * on a branch `feature` whose one commit over `main` adds `files`.
 */
export function featureRepo(policy: string, files: Readonly<Record<string, string>>): FixtureRepo {
  const repo = createFixtureRepo({ files: { "squeal.config.json": policy } });
  git(repo.root, ["checkout", "-q", "-b", "feature"]);
  write(repo, files);
  git(repo.root, ["add", "-A"]);
  git(repo.root, ["commit", "-qm", "feature"]);
  return repo;
}

/** Each file's key as the worktree's daemon would give it now. */
export async function keysNow(
  repo: FixtureRepo,
  refs: readonly TestFileRef[],
): Promise<CheckKey[]> {
  const stored = storedFiles(repo.root, repo.env, () => {});
  if (stored === null) throw new Error("no keys: coverage is off");
  try {
    const keys = await stored.keys(refs);
    return refs.map((ref) => {
      const key = keys.get(ref);
      if (key == null) throw new Error(`no key for ${ref.path}`);
      return key;
    });
  } finally {
    await stored.close();
  }
}

/** Whether the code store holds a record at `key`, read-only; `false` with no code store. */
export function hasRecord(repo: FixtureRepo, key: CheckKey): boolean {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(codeStorePath(repo.commonDir), { readOnly: true });
  } catch {
    return false;
  }
  try {
    const sql = "SELECT 1 FROM coverage WHERE result_key = ? AND provider_version = ?";
    return db.prepare(sql).get(key, COVERAGE_RECORD_VERSION) !== undefined;
  } finally {
    db.close();
  }
}

/** The run ids of the results stored at `key`; none while there is no store. */
export function runIdsAt(repo: FixtureRepo, key: CheckKey): string[] {
  if (!existsSync(storePaths(repo.commonDir).database)) return [];
  return withStore(repo, (store) => [
    ...new Set(store.results.byKey(key, 0).map((r) => r.provenance.runId)),
  ]);
}

/** Each store file's bytes, as a hash, and its mtime. */
export function snapshot(repo: FixtureRepo): string[] {
  return [storePaths(repo.commonDir).database, codeStorePath(repo.commonDir)].map((path) => {
    const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
    return `${path} ${hash} ${statSync(path).mtimeMs}`;
  });
}

/** The test files of each run the worktree's daemons recorded, read-only. */
export function daemonRuns(repo: FixtureRepo): string[] {
  const db = new DatabaseSync(storePaths(repo.commonDir).database, { readOnly: true });
  try {
    const rows = db
      .prepare("SELECT test_files FROM runs WHERE worktree_id = ?")
      .all(repo.worktreeId) as { test_files: string }[];
    return rows.map((r) => r.test_files);
  } finally {
    db.close();
  }
}

export interface Gate {
  readonly code: number;
  readonly report: GateReport;
  readonly stderr: string;
  readonly ran: readonly string[];
  readonly leftInTmp: readonly string[];
}

/** `squeal code --base main <args> --json` in `repo`, with a `TMPDIR` of its own it must leave empty. */
export async function gate(repo: FixtureRepo, args: readonly string[]): Promise<Gate> {
  const ran: string[] = [];
  // D3.5: a `TMPDIR` of the command's own, which it must leave empty.
  const temp = mkdtempSync(join(tmpdir(), "squeal-gate-stored-"));
  const saved = process.env.TMPDIR;
  process.env.TMPDIR = temp;
  let result: Ran;
  try {
    const options = { env: repo.env, adapters: watched(ran) };
    result = await code(repo.root, ["--base", "main", ...args, "--json"], options);
  } finally {
    if (saved === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = saved;
  }
  const leftInTmp = readdirSync(temp);
  rmSync(temp, { recursive: true, force: true });
  const { stdout, stderr } = result;
  return { code: result.code, report: JSON.parse(stdout) as GateReport, stderr, ran, leftInTmp };
}
