import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { headerLines, readLiveHeader } from "../../src/core/delivery/index.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { createFsHasher } from "../../src/core/hash/index.js";
import { type HeadState, statCandidates } from "../../src/core/revision/index.js";
import { WorktreeKeys } from "../../src/core/scheduler/keying.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/index.js";
import {
  DEFAULT_POLICY,
  type Policy,
  type RevisionNumber,
  type RunnerEnvironment,
  type Store,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";

/*
 * Row 011-262 (gh-105), findings E1's repository: a private git repository
 * whose `.gitignore` ignores `.ai/qa/`, where cezarion's test environment
 * writes the descriptor `.ai/qa/test-env.json` that specs read.
 */

export const READER: TestFileRef = { project: "", path: "test/env.test.ts" };
export const OUTSIDE: TestFileRef = { project: "", path: "test/outside.test.ts" };
export const DESCRIPTOR = ".ai/qa/test-env.json";
export const NOW = Date.UTC(2026, 9, 26, 18, 1, 0);

export const ENVIRONMENT: RunnerEnvironment = {
  project: "",
  runnerName: "e1",
  runnerVersion: "1",
  adapterVersion: "1",
  resolvedConfig: "{}",
  files: [],
};

/** The repository of the running test, set by `useDescriptorRepo`'s `beforeEach`. */
export const repo = { root: "", store: undefined as unknown as Store };

/** Each test gets a fresh repository: the fixture committed, the descriptor written, ignored. */
export function useDescriptorRepo(): void {
  beforeEach(() => {
    repo.root = realpathSync(mkdtempSync(join(tmpdir(), "sq-011-262-")));
    write(".gitignore", ".ai/qa/\n");
    write("src/a.ts", "export const a = 1;\n");
    write(READER.path, "import '../src/a.js';\n");
    write(OUTSIDE.path, "// test\n");
    git(repo.root, ["init", "-q", "-b", "main"]);
    git(repo.root, ["add", "-A"]);
    git(repo.root, ["commit", "-qm", "fixture"]);
    write(DESCRIPTOR, '{"pid":101,"startedAt":1}\n');
    const opened = openStore(join(repo.root, ".git"), { busyTimeoutMs: 10_000 });
    if (isStoreOpenFailure(opened)) throw new Error(`store: ${JSON.stringify(opened)}`);
    repo.store = opened;
  });
  afterEach(() => {
    repo.store.close();
    rmSync(repo.root, { recursive: true, force: true });
  });
}

export const head = (): Promise<HeadState> => readHead(repo.root);

export function write(path: string, content: string): void {
  mkdirSync(dirname(join(repo.root, path)), { recursive: true });
  writeFileSync(join(repo.root, path), content);
}

export function keysOn(
  policy: Policy = { ...DEFAULT_POLICY, observe: { runtimeInputs: false } },
  note?: (text: string) => void,
): WorktreeKeys {
  return new WorktreeKeys({
    root: repo.root,
    worktreeId: worktreeIdFor(repo.root),
    store: repo.store,
    hasher: createFsHasher(repo.root, "sha1"),
    objectFormat: "sha1",
    policy,
    squealVersion: "0.0.0-test",
    env: {},
    onExtraFiles: () => {},
    ...(note === undefined ? {} : { note }),
  });
}

/** A daemon whose reader's closure names the descriptor, with the environment read. */
export async function daemon(keys = keysOn()): Promise<WorktreeKeys> {
  await keys.bootstrap(head);
  await keys.setEnvironments([ENVIRONMENT]);
  keys.setClosure({ testFile: READER, paths: [READER.path, "src/a.ts", DESCRIPTOR] });
  await keys.trackUntracked();
  return keys;
}

/** A reconciliation pass, as the change feed's: every tracked and extra path is a candidate. */
export async function pass(keys: WorktreeKeys, at: () => Promise<HeadState> = head) {
  const paths = [...keys.cache.paths(), ...keys.extraFiles()];
  const candidates = await statCandidates(paths, createFsHasher(repo.root, "sha1"));
  return keys.reconcile({ trigger: "interval", paths: candidates }, at);
}

/**
 * The header line of `form`, as hooks read it for a consumer last told
 * `since`: nothing, the latest revision's paths; a revision, every later one's.
 */
export const headerLine = (form: "news" | "full", since: RevisionNumber | null = null) =>
  headerLines(
    readLiveHeader(repo.store, worktreeIdFor(repo.root), NOW, undefined, since),
    "squeal",
    form,
  )[0];
