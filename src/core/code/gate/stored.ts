import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readHead } from "../../daemon-loop/head.js";
import { compare } from "../../fs/compare.js";
import { worktreeIdFor } from "../../fs/git-layout.js";
import { readObjectFormat } from "../../hash/git-index.js";
import { createFsHasher } from "../../hash/hasher.js";
import { observedModulesMetaKey } from "../../keys/modules.js";
import { observedDirectMetaKey, observedMetaKey } from "../../keys/observed.js";
import { testFileId } from "../../keys/reverse-index.js";
import { observedStartupMetaKey } from "../../keys/startup.js";
import { WorktreeKeys } from "../../scheduler/keying.js";
import { Connection } from "../../store/connection.js";
import { DEFAULT_BUSY_TIMEOUT_MS, isStoreOpenFailure, openStore } from "../../store/open.js";
import { storePaths } from "../../store/paths.js";
import { SCHEMA_VERSION, userVersion } from "../../store/schema.js";
import { createStore } from "../../store/store.js";
import type { AbsolutePath, ProjectName, RelativePath } from "../../types/common.js";
import type { CheckKey, TestFileRef } from "../../types/keys.js";
import type { Policy } from "../../types/policy.js";
import type { RunnerAdapter, RunnerClosure } from "../../types/runner.js";
import type { Store } from "../../types/store.js";
import { COVERAGE_RECORD_VERSION, decodeRecord } from "../coverage/record.js";
import { codeStorePath } from "../store/open.js";
import { CODE_SCHEMA_VERSION } from "../store/schema.js";
import { createCodeStore } from "../store/store.js";
import type { CodeStore } from "../store/types.js";
import { FILE_ERROR, type StoredEvidence } from "./collect.js";
import type { TestFileEvidence } from "./types.js";

/*
 * Spec 020 D11.7 (row 020-07c): `--base` reads what a daemon stored. Each
 * selected test file is keyed as a daemon in this worktree keys it: the
 * daemon's `WorktreeKeys`, the adapters a daemon builds, each file's
 * closure, and the observed reads every daemon of the repository stored.
 * The keys live in a scratch store under `$TMPDIR`, seeded with a copy of
 * those observed rows, as `ci export` keys (018 D9). The real stores are
 * opened read-only: a file with results and a coverage record at its key
 * is taken from them, and every other file runs. Nothing is written to a
 * store of the repository.
 */

export interface StoredOptions {
  readonly root: AbsolutePath;
  /** The repository's git common directory, which holds the stores. */
  readonly commonDir: AbsolutePath;
  /** The worktree's own policy, as its daemon reads it: its keys take the head's `inputs`. */
  readonly policy: Policy;
  readonly squealVersion: string;
  /** Allow-listed variables are read from here, as a daemon reads its own. */
  readonly env: NodeJS.ProcessEnv;
  /**
   * Opens the adapters a daemon builds in this worktree, with `tempDir` as
   * their temporary directory; they key and run nothing. The CLI gives them,
   * since nothing under `src/core/code` imports a runner (row 016-36).
   */
  readonly adapters: (tempDir: AbsolutePath) => Promise<readonly RunnerAdapter[]>;
  /** Why the stores gave nothing, told once; every selected file then runs. */
  readonly note?: (text: string) => void;
}

/** A file's key as a daemon here gives it, and the sources its runner's closure loads. */
interface Keyed {
  readonly key: CheckKey;
  readonly loads: readonly RelativePath[];
}

export interface StoredFiles {
  /** `CollectOptions.stored`: the files with results and a record at their key. */
  readonly stored: StoredEvidence;
  /** Each file's key as a daemon here gives it; `null` when it has none. */
  keys(files: readonly TestFileRef[]): Promise<ReadonlyMap<TestFileRef, CheckKey | null>>;
  /** Closes the stores and the adapters, and removes the scratch store. */
  close(): Promise<void>;
}

/**
 * The stores of `options.commonDir`, read-only; `null` when either store is
 * missing, cannot be read, or has another schema than this Squeal's. Then
 * every selected file runs. The adapters start at the first lookup.
 */
export function openStored(options: StoredOptions): StoredFiles | null {
  const stores = readStores(options.commonDir);
  if (stores === null) return null;
  let keyer: Promise<Keyer> | null = null;
  const keyerOf = () => {
    keyer ??= openKeyer(options, stores.main);
    return keyer;
  };
  const keys = async (files: readonly TestFileRef[]) => {
    const keyed = await (await keyerOf()).keyed(files);
    return new Map(files.map((ref) => [ref, keyed.get(ref)?.key ?? null]));
  };
  let told = false;
  const stored: StoredEvidence = async (runner, files) => {
    try {
      const found = new Map<TestFileRef, TestFileEvidence>();
      for (const [ref, at] of await (await keyerOf()).keyed(files)) {
        const evidence = evidenceAt(stores, runner, ref, at);
        if (evidence !== null) found.set(ref, evidence);
      }
      return found;
    } catch (error) {
      // A store or an adapter that fails here costs only the runs it would have saved.
      const why = error instanceof Error ? error.message : String(error);
      if (!told) options.note?.(`the stores were not read, so every selected file runs: ${why}`);
      told = true;
      return new Map();
    }
  };
  const close = async () => {
    try {
      await keyer?.then(
        (k) => k.close(),
        () => {},
      );
    } finally {
      stores.close();
    }
  };
  return { stored, keys, close };
}

/** The evidence the stores hold of `ref` at its key; `null` without results and a record there. */
function evidenceAt(
  stores: Stores,
  runner: TestFileEvidence["runner"],
  ref: TestFileRef,
  { key, loads }: Keyed,
): TestFileEvidence | null {
  const results = stores.main.results
    .byKey(key, 0)
    .filter((r) => r.check.project === ref.project && r.check.testPath === ref.path);
  if (results.length === 0) return null;
  const bytes = stores.code.coverage.get({
    resultKey: key,
    providerVersion: COVERAGE_RECORD_VERSION,
  });
  if (bytes === null) return null;
  const failed = results
    .filter((r) => r.outcome === "fail")
    .map((r) => (r.check.kind === "test" ? r.check.fullName : FILE_ERROR));
  return {
    runner,
    path: ref.path,
    // 015 D8: a record is stored only for a file that ran whole, every test selected.
    completed: true,
    failed: [...new Set(failed)].sort(compare),
    skipped: results.some((r) => r.outcome === "skip"),
    loads,
    record: decodeRecord(bytes),
    fromStore: true,
  };
}

interface Stores {
  readonly main: Store;
  readonly code: CodeStore;
  close(): void;
}

/** Both stores over read-only connections, or `null` when one cannot be read as this Squeal's. */
function readStores(commonDir: AbsolutePath): Stores | null {
  const paths = storePaths(commonDir);
  const mainDb = readOnly(paths.database, SCHEMA_VERSION);
  if (mainDb === null) return null;
  const codePath = codeStorePath(commonDir);
  const codeDb = readOnly(codePath, CODE_SCHEMA_VERSION);
  if (codeDb === null) {
    mainDb.close();
    return null;
  }
  const main = createStore(new Connection(mainDb), SCHEMA_VERSION, paths);
  const code = createCodeStore(new Connection(codeDb), CODE_SCHEMA_VERSION, codePath);
  return {
    main,
    code,
    close: () => {
      main.close();
      code.close();
    },
  };
}

/**
 * `path` opened read-only, so no statement can write it and closing it
 * checkpoints nothing; `null` when it is missing, cannot be read, or is at
 * another schema version.
 */
function readOnly(path: AbsolutePath, version: number): DatabaseSync | null {
  if (!existsSync(path)) return null;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    db.exec(`PRAGMA busy_timeout = ${DEFAULT_BUSY_TIMEOUT_MS}`);
    if (userVersion(db) === version) return db;
  } catch {
    // An unreadable store is no store: every file runs.
  }
  db?.close();
  return null;
}

interface Keyer {
  keyed(files: readonly TestFileRef[]): Promise<ReadonlyMap<TestFileRef, Keyed>>;
  close(): Promise<void>;
}

/** The meta rows of a project's observed reads, shared by every worktree's daemon. */
const OBSERVED_ROWS: readonly ((project: ProjectName) => string)[] = [
  observedMetaKey,
  observedDirectMetaKey,
  observedModulesMetaKey,
  observedStartupMetaKey,
];

/**
 * The daemon's keys of this worktree over a scratch store, bootstrapped as
 * at a daemon's start, with the adapters' environments and the observed
 * rows of `main` for their projects.
 */
async function openKeyer(options: StoredOptions, main: Store): Promise<Keyer> {
  const temp = mkdtempSync(join(tmpdir(), "squeal-gate-keys-"));
  const adapters: RunnerAdapter[] = [];
  let scratch: Store | null = null;
  const close = async () => {
    await Promise.allSettled(adapters.map((a) => a.close()));
    scratch?.close();
    rmSync(temp, { recursive: true, force: true });
  };
  try {
    adapters.push(...(await options.adapters(temp)));
    const environments = (await Promise.all(adapters.map((a) => a.environment()))).flat();
    const opened = openStore(temp);
    if (isStoreOpenFailure(opened)) throw new Error(`no scratch store: ${opened.reason}`);
    scratch = opened;
    for (const project of new Set(environments.map((e) => e.project))) {
      for (const row of OBSERVED_ROWS) {
        const value = main.meta.get(row(project));
        if (value !== null) opened.meta.set(row(project), value);
      }
    }
    const keys = await openKeys(options, opened);
    await keys.setEnvironments(environments);
    const listed = new Map<string, RunnerAdapter>();
    for (const adapter of adapters) {
      for (const ref of await adapter.testFiles()) listed.set(testFileId(ref), adapter);
    }
    return { keyed: (files) => keyFiles(keys, listed, files), close };
  } catch (error) {
    await close();
    throw error;
  }
}

/** The daemon's `WorktreeKeys` of this worktree over `store`, bootstrapped as at its start. */
async function openKeys(options: StoredOptions, store: Store): Promise<WorktreeKeys> {
  const { root, policy, squealVersion, env } = options;
  const objectFormat = await readObjectFormat(root);
  const keys = new WorktreeKeys({
    root,
    worktreeId: worktreeIdFor(root),
    store,
    hasher: createFsHasher(root, objectFormat),
    objectFormat,
    policy,
    squealVersion,
    env,
    onExtraFiles: () => {},
  });
  await keys.bootstrap(() => readHead(root));
  return keys;
}

/**
 * Keys each of `files` an adapter lists by its runner's closure; a file no
 * adapter lists, or whose closure fails, has none.
 */
async function keyFiles(
  keys: WorktreeKeys,
  listed: ReadonlyMap<string, RunnerAdapter>,
  files: readonly TestFileRef[],
): Promise<ReadonlyMap<TestFileRef, Keyed>> {
  const closures = new Map<TestFileRef, RunnerClosure>();
  for (const ref of files) {
    const closure = await listed
      .get(testFileId(ref))
      ?.closure(ref)
      .catch(() => null);
    if (closure === undefined || closure === null) continue;
    closures.set(ref, closure);
    keys.setClosure(closure);
  }
  await keys.trackUntracked();
  const keyed = new Map<TestFileRef, Keyed>();
  for (const [ref, closure] of closures) {
    const key = keys.index.key(ref);
    if (key !== null) keyed.set(ref, { key, loads: [...closure.paths].sort(compare) });
  }
  return keyed;
}
