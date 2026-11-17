import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { daemonAdapters } from "../../src/cli/code-gate-stored.js";
import { keyPartsOf } from "../../src/core/ci/export-parts.js";
import { readPolicy } from "../../src/core/daemon/policy.js";
import { squealVersion } from "../../src/core/daemon/version.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import { openDaemonKeying } from "../../src/core/scheduler/daemon-keying.js";
import { EXPORT_NAME } from "../../src/core/shared/refs.js";
import { worktreeEnvironments } from "../../src/core/store/environments.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import {
  type ExportedResult,
  type ExportedTestFile,
  encodeBundle,
  RESULTS_FORMAT,
  type ResultsBundle,
} from "../../src/core/store/transfer-bundle.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { Store } from "../../src/core/types/store.js";
import { type Fixture, git, link } from "./at-keys-fixture.js";

/*
 * Row 023-17: CI's export of a commit, made as `squeal ci export` makes
 * one (the daemon's keying in a tree at the commit, `keyPartsOf`), with a
 * pass per file, published as a results ref; and a remote for the
 * fixture's repository, so the export's commit is on `main`'s line.
 */

/** Runs `body` with the daemon's keying of `tree` over `store`; closes the adapters after. */
async function keyedIn<T>(
  tree: AbsolutePath,
  store: Store,
  body: (keying: Awaited<ReturnType<typeof openDaemonKeying>>) => Promise<T>,
): Promise<T> {
  const temp = mkdtempSync(join(tree, "..", "keys-")) as AbsolutePath;
  const policy = readPolicy(tree);
  const adapters = await daemonAdapters(tree, policy, temp);
  try {
    const keying = await openDaemonKeying({
      root: tree,
      worktreeId: worktreeIdFor(tree),
      store,
      policy,
      squealVersion: squealVersion(),
      env: process.env,
      adapters,
    });
    return await body(keying);
  } finally {
    await Promise.allSettled(adapters.map((a) => a.close()));
    rmSync(temp, { recursive: true, force: true });
  }
}

/** CI's export of `files` at `commit`: each file's key, closure and key parts, and one pass. */
export async function ciExportAt(
  f: Fixture,
  commit: string,
  files: readonly TestFileRef[],
): Promise<ResultsBundle> {
  const tree = join(f.dir, `ci-${commit.slice(0, 8)}-${Date.now()}`) as AbsolutePath;
  git(f.root, "worktree", "add", "-q", "--detach", tree, commit);
  const scratchDir = mkdtempSync(join(f.dir, "ci-store-")) as AbsolutePath;
  const scratch = openStore(scratchDir);
  if (isStoreOpenFailure(scratch)) throw new Error(scratch.reason);
  try {
    link(tree);
    return await keyedIn(tree, scratch, async (keying) => {
      const { closures } = await keying.keyFiles(files);
      const parts = await keyPartsOf({ root: tree }, keying.keys, keying.environments, closures);
      const testFiles: ExportedTestFile[] = [];
      const results: ExportedResult[] = [];
      for (const ref of files) {
        const key = keying.keys.index.key(ref);
        const closure = keying.keys.index.closure(ref);
        const keyParts = parts(ref);
        if (key === null || closure === undefined || keyParts === null) {
          throw new Error(`no CI key for ${ref.path}`);
        }
        const { paths, complete, method } = closure;
        testFiles.push({
          ...ref,
          key,
          closure: { paths, complete, method },
          observed: {},
          keyParts,
        });
        results.push({
          project: ref.project,
          testPath: ref.path,
          kind: "file",
          fullName: null,
          location: null,
          key,
          outcome: "pass",
          durationMs: 7,
        });
      }
      const environments = worktreeEnvironments(scratch, worktreeIdFor(tree)).map(
        ({ project, hash, descriptor }) => ({ project, hash, descriptor }),
      );
      return {
        format: RESULTS_FORMAT,
        header: {
          squealVersion: squealVersion(),
          keyFormat: KEY_FORMAT_VERSION,
          commit,
          dirty: false,
          createdAt: 1_762_000_000_000,
          source: {
            kind: "github",
            repository: "o/r",
            runId: "7",
            ref: "refs/heads/main",
            event: "push",
            sha: commit,
          },
        },
        environments,
        testFiles,
        observedStartup: [],
        results,
      } satisfies ResultsBundle;
    });
  } finally {
    scratch.close();
    git(f.root, "worktree", "remove", "--force", tree);
  }
}

/** What a daemon in the fixture's worktree records: its environment, in the repository's store. */
export async function recordHere(f: Fixture): Promise<void> {
  const store = openStore(realpathSync(join(f.root, ".git")) as AbsolutePath);
  if (isStoreOpenFailure(store)) throw new Error(store.reason);
  try {
    await keyedIn(f.root, store, async () => {});
  } finally {
    store.close();
  }
}

/** Writes `bundle` as the results ref `refs/squeal/<commit>` in `cwd`; the results commit. */
export function publishLocal(cwd: string, commit: string, bundle: ResultsBundle): string {
  const run = (args: string[], input?: Buffer | string) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      cwd,
      ...(input === undefined ? {} : { input }),
      encoding: "utf8",
    }).trim();
  const blob = run(["hash-object", "-w", "--stdin"], encodeBundle(bundle));
  const tree = run(["mktree"], `100644 blob ${blob}\t${EXPORT_NAME}\n`);
  const results = run(["commit-tree", tree, "-m", "results"]);
  run(["update-ref", `refs/squeal/${commit}`, results]);
  return results;
}

/** A bare remote `origin` holding the fixture's `main`, with `origin/HEAD` set. */
export function withRemote(f: Fixture): string {
  const remote = join(f.dir, "remote.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  git(f.root, "remote", "add", "origin", remote);
  git(f.root, "push", "-q", "origin", "main");
  git(f.root, "fetch", "-q", "origin");
  git(f.root, "remote", "set-head", "origin", "main");
  return remote;
}
