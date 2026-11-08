import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { createFsHasher } from "../../src/core/hash/hasher.js";
import { WorktreeKeys } from "../../src/core/scheduler/keying.js";
import { worktreeEnvironment, worktreeEnvironments } from "../../src/core/store/environments.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import type { WorktreeId } from "../../src/core/types/common.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import type { RunnerEnvironment } from "../../src/core/types/runner.js";
import type { Store } from "../../src/core/types/store.js";
import { git } from "../hash/git-repo.js";

/*
 * Spec 018 D1: the daemon records each project's environment hash with its
 * parts where it computes the hash, and the stored hash is the one it keys with.
 */

const ID = "0123456789abcdef" as WorktreeId;

const environment = (project: string, allowOnly: boolean): RunnerEnvironment => ({
  project,
  runnerName: "vitest",
  runnerVersion: "5.0.3",
  adapterVersion: "7",
  resolvedConfig: JSON.stringify({ allowOnly, root: "<root>" }),
  files: ["vitest.config.ts"],
});

let root: string;
let store: Store;

async function keys(env: NodeJS.ProcessEnv): Promise<WorktreeKeys> {
  const keys = new WorktreeKeys({
    root,
    worktreeId: ID,
    store,
    hasher: createFsHasher(root, "sha1"),
    objectFormat: "sha1",
    policy: { ...DEFAULT_POLICY, env: { ...DEFAULT_POLICY.env, allowlist: ["SECRET"] } },
    squealVersion: "0.0.0-test",
    env,
    onExtraFiles: () => {},
  });
  await keys.bootstrap(() => readHead(root));
  return keys;
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "sq-018-06-")));
  writeFileSync(join(root, "vitest.config.ts"), "export default {};\n");
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "fixture"]);
  const opened = openStore(join(root, ".git"), { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(opened)) throw new Error(`store: ${JSON.stringify(opened)}`);
  store = opened;
});

afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

describe("the daemon's environment record (018 D1)", () => {
  it("stores each project's hash it keys with, with its parts", async () => {
    const worktree = await keys({ CI: "true", SECRET: "s3cret-value-91c" });
    await worktree.setEnvironments([environment("", false), environment("api", false)]);

    const stored = worktreeEnvironments(store, ID);
    expect(stored.map((e) => [e.project, e.hash])).toEqual([
      ["", worktree.index.environment("")],
      ["api", worktree.index.environment("api")],
    ]);
    const root = stored[0]?.descriptor;
    expect(root).toMatchObject({
      project: "",
      runnerVersion: "5.0.3",
      nodeVersion: process.version,
      env: { names: ["SECRET"] },
      ci: true,
    });
    expect(root?.files.map(([path]) => path)).toEqual(["vitest.config.ts"]);
    expect(JSON.stringify(stored)).not.toContain("s3cret-value-91c");
  });

  it("records the moved hash, and no project the worktree stopped reading", async () => {
    const worktree = await keys({});
    await worktree.setEnvironments([environment("", false), environment("api", false)]);
    await worktree.setEnvironments([environment("", true)]);

    const stored = worktreeEnvironment(store, ID, "");
    expect(stored?.hash).toBe(worktree.index.environment(""));
    expect(stored?.descriptor?.ci).toBe(false);
    expect(worktreeEnvironment(store, ID, "api")).toBeNull();
  });
});
