import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { codeGateCommand } from "../../src/cli/code-gate.js";
import { COVERAGE_RECORD_VERSION } from "../../src/core/code/coverage/record.js";
import type { GateReport } from "../../src/core/code/gate/report.js";
import type { GateAdapters } from "../../src/core/code/gate/runners.js";
import { codeStorePath } from "../../src/core/code/store/open.js";
import { storePaths } from "../../src/core/store/paths.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import type { RunnerAdapter } from "../../src/core/types/runner.js";
import { createVitestAdapter } from "../../src/runners/vitest/index.js";
import { ADAPTERS } from "../code/gate/collect-fixture.js";
import { type FixtureRepo, withStore } from "../daemon/helpers.js";

/*
 * Spec 020 D11.7 and D17.3 (rows 020-07c, 020-17c): `squeal code --base`
 * in a scheduler fixture repository, in this process, with the files each
 * Vitest run was given, and a look at the stores it reads and writes.
 */

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

/** The CLI's adapters, each Vitest run's files appended to `ran`. */
function watched(ran: string[]): GateAdapters {
  const wrap = (adapter: RunnerAdapter): RunnerAdapter =>
    new Proxy(adapter, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key, target);
        if (typeof value !== "function") return value;
        if (key !== "run") return value.bind(target);
        return (files: readonly TestFileRef[], ...rest: unknown[]) => {
          ran.push(...files.map((f) => f.path));
          return (value as (...args: unknown[]) => unknown).call(target, files, ...rest);
        };
      },
    });
  return { ...ADAPTERS, vitest: async (options) => wrap(await createVitestAdapter(options)) };
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
  let stdout = "";
  let stderr = "";
  const io = {
    stdout: (text: string) => {
      stdout += text;
    },
    stderr: (text: string) => {
      stderr += text;
    },
    cwd: repo.root,
    env: repo.env,
  };
  // D3.5: a `TMPDIR` of the command's own, which it must leave empty.
  const temp = mkdtempSync(join(tmpdir(), "squeal-gate-stored-"));
  const saved = process.env.TMPDIR;
  process.env.TMPDIR = temp;
  let code: number;
  try {
    code = await codeGateCommand(["--base", "main", ...args, "--json"], io, watched(ran));
  } finally {
    if (saved === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = saved;
  }
  const leftInTmp = readdirSync(temp);
  rmSync(temp, { recursive: true, force: true });
  return { code, report: JSON.parse(stdout) as GateReport, stderr, ran, leftInTmp };
}
