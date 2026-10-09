import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import type { CheckId, KnownState, Store, TestCheckId } from "../../src/core/types/index.js";
import { open, tempDir } from "../store/helpers.js";

/** A repository on disk without git: a main worktree with a `.git` directory and linked worktrees. */
export interface FakeRepo {
  readonly commonDir: string;
  readonly main: string;
  readonly mainId: string;
  /** Adds a linked worktree the way `git worktree add` lays it out. */
  addWorktree(name: string): { readonly root: string; readonly id: string };
}

export function fakeRepo(): FakeRepo {
  const main = realpathSync(tempDir("squeal-status-"));
  const commonDir = join(main, ".git");
  mkdirSync(commonDir);
  writeFileSync(join(commonDir, "HEAD"), "ref: refs/heads/main\n");
  return {
    commonDir,
    main,
    mainId: worktreeIdFor(main),
    addWorktree(name) {
      const root = realpathSync(tempDir(`squeal-${name}-`));
      const gitdir = join(commonDir, "worktrees", name);
      mkdirSync(gitdir, { recursive: true });
      writeFileSync(join(gitdir, "commondir"), "../..\n");
      writeFileSync(join(root, ".git"), `gitdir: ${gitdir}\n`);
      return { root, id: worktreeIdFor(root) };
    },
  };
}

/** Opens (and creates) the repository's store for seeding; closed after the test. */
export function seedStore(repo: FakeRepo): Store {
  return open(repo.commonDir);
}

export function check(path: string, fullName: string): TestCheckId {
  return { kind: "test", project: "", testPath: path, fullName };
}

/** A known state with every optional field empty; override what the test needs. */
export function state(
  worktreeId: string,
  check: CheckId,
  overrides: Partial<Omit<KnownState, "worktreeId" | "check">> = {},
): KnownState {
  return {
    worktreeId,
    check,
    outcome: "pass",
    validity: "current",
    pendingPhase: null,
    observedAt: 1,
    commit: null,
    origin: { kind: "own" },
    durationMs: 5,
    location: null,
    summary: null,
    fingerprint: null,
    ...overrides,
  };
}

/** Appends `count` revisions to a worktree; the last one gets `head`, `dirty` and `createdAt`. */
export function appendRevisions(
  store: Store,
  worktreeId: string,
  count: number,
  last: { head: string | null; dirty: boolean; createdAt?: number },
): void {
  store.transaction(() => {
    for (let n = 1; n <= count; n++) {
      store.revisions.append({
        worktreeId,
        createdAt: n === count ? (last.createdAt ?? n) : n,
        head: n === count ? last.head : "0000000000000000000000000000000000000000",
        dirty: n === count ? last.dirty : false,
        trigger: "watch",
        changes: [{ path: "src/a.ts", oldHash: null, newHash: `h${n}` }],
      });
    }
  });
}
