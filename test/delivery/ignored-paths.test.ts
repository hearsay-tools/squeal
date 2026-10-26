import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { headerLines, readLiveHeader } from "../../src/core/delivery/index.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { createFsHasher } from "../../src/core/hash/index.js";
import { statCandidates } from "../../src/core/revision/index.js";
import { WorktreeKeys } from "../../src/core/scheduler/keying.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/index.js";
import {
  DEFAULT_POLICY,
  type RunnerEnvironment,
  type Store,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";

/*
 * Row 011-262 (gh-105), findings E1's descriptor step: cezarion's test
 * environment rewrites `.ai/qa/test-env.json`, which git ignores and specs
 * read. The rewrite is a revision `git status` does not show, and the
 * incident's header named no path: `Revision 1 · 9a9f617f + 1: test files
 * without checks: 32 pending, 41 unknown.` Here a closure names the
 * descriptor, as the readers' observed reads did, so the daemon watches it
 * as an extra file; the header names it with `git-ignored` in both forms.
 * The watch path's mark is `test/scheduler/daemon-loop.test.ts`'s.
 */

const READER: TestFileRef = { project: "", path: "test/env.test.ts" };
const DESCRIPTOR = ".ai/qa/test-env.json";
const NOW = Date.UTC(2026, 9, 26, 18, 1, 0);

const ENVIRONMENT: RunnerEnvironment = {
  project: "",
  runnerName: "e1",
  runnerVersion: "1",
  adapterVersion: "1",
  resolvedConfig: "{}",
  files: [],
};

let root: string;
let store: Store;
const head = () => readHead(root);

function write(path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function keysOn(): WorktreeKeys {
  return new WorktreeKeys({
    root,
    worktreeId: worktreeIdFor(root),
    store,
    hasher: createFsHasher(root, "sha1"),
    objectFormat: "sha1",
    policy: { ...DEFAULT_POLICY, observe: { runtimeInputs: false } },
    squealVersion: "0.0.0-test",
    env: {},
    onExtraFiles: () => {},
  });
}

/** A daemon whose reader's closure names the descriptor, with the environment read. */
async function daemon(): Promise<WorktreeKeys> {
  const keys = keysOn();
  await keys.bootstrap(head);
  await keys.setEnvironments([ENVIRONMENT]);
  keys.setClosure({ testFile: READER, paths: [READER.path, "src/a.ts", DESCRIPTOR] });
  await keys.trackUntracked();
  return keys;
}

/** A reconciliation pass, as the change feed's: every tracked and extra path is a candidate. */
async function pass(keys: WorktreeKeys) {
  const paths = [...keys.cache.paths(), ...keys.extraFiles()];
  const candidates = await statCandidates(paths, createFsHasher(root, "sha1"));
  return keys.reconcile({ trigger: "interval", paths: candidates }, head);
}

/** The header line of `form`, as hooks read it for a consumer last told nothing. */
const headerLine = (form: "news" | "full") =>
  headerLines(readLiveHeader(store, worktreeIdFor(root), NOW), "squeal", form)[0];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "sq-011-262-")));
  write(".gitignore", ".ai/qa/\n");
  write("src/a.ts", "export const a = 1;\n");
  write(READER.path, "import '../src/a.js';\n");
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "fixture"]);
  write(DESCRIPTOR, '{"pid":101,"startedAt":1}\n');
  const opened = openStore(join(root, ".git"), { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(opened)) throw new Error(`store: ${JSON.stringify(opened)}`);
  store = opened;
});

afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

describe("the descriptor git ignores, rewritten (row 011-262, findings E1)", () => {
  it("is a revision git status does not show, whose header names it git-ignored in both forms", async () => {
    const keys = await daemon();
    expect(keys.extraFiles()).toEqual([DESCRIPTOR]);

    // The environment boots again: a new pid and start time.
    write(DESCRIPTOR, '{"pid":202,"startedAt":2}\n');
    expect(git(root, ["status", "--porcelain"]).trim()).toBe("");
    const revision = await pass(keys);
    expect(revision?.changes).toEqual([
      expect.objectContaining({ path: DESCRIPTOR, ignored: true }),
    ]);

    // `git status` is empty, so the tree is not dirty: only the path says what changed.
    const named = `Revision 1 · ${git(root, ["rev-parse", "--short=8", "HEAD"]).trim()} + 1 (changed git-ignored ${DESCRIPTOR}): `;
    expect(headerLine("news")?.slice(0, named.length)).toBe(named);
    expect(headerLine("full")?.slice(0, named.length)).toBe(named);
  });

  it("names a tracked path beside it unmarked", async () => {
    const keys = await daemon();
    write(DESCRIPTOR, '{"pid":202,"startedAt":2}\n');
    write("src/a.ts", "export const a = 2;\n");
    await pass(keys);
    expect(headerLine("news")).toContain(`(changed git-ignored ${DESCRIPTOR}, src/a.ts): `);
  });

  it("is marked in the start revision of a daemon that finds it rewritten while none ran", async () => {
    await daemon();
    write(DESCRIPTOR, '{"pid":303,"startedAt":3}\n');
    const revision = await keysOn().bootstrap(head);
    expect(revision?.trigger).toBe("start");
    expect(revision?.changes).toEqual([
      expect.objectContaining({ path: DESCRIPTOR, ignored: true }),
    ]);
    expect(headerLine("news")).toContain(`(changed git-ignored ${DESCRIPTOR}): `);
  });
});
