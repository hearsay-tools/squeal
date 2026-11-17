import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { daemonAdapters } from "../../src/cli/code-gate-stored.js";
import type { InstallResult } from "../../src/core/checkout/install.js";
import { cacheCheckoutsDir, gitCheckoutsDir } from "../../src/core/checkout/location.js";
import { listCheckouts } from "../../src/core/checkout/sweep.js";
import { openStored } from "../../src/core/code/gate/stored.js";
import { readPolicy } from "../../src/core/daemon/policy.js";
import { squealVersion } from "../../src/core/daemon/version.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import { onCleanUp } from "../scheduler/cleanup.js";

/*
 * Row 023-16: repositories under $TMPDIR keyed by the real Vitest adapter.
 * Their `node_modules` holds one link, to this repository's Vitest, and is
 * ignored; a checkout's install makes the same link (`linkInstall`). The
 * reference key of a file at a commit is the gate's own lookup key
 * (`openStored(...).keys`) in a plain `git worktree add` at that commit: a
 * fresh walk there, without the fast path or the temporary checkout.
 */

const REPO = resolve(import.meta.dirname, "../..");
const VITEST = join(REPO, "node_modules/vitest");

export const BASE: Readonly<Record<string, string>> = {
  ".gitignore": "node_modules/\n",
  "package.json": `${JSON.stringify({ name: "fixture", type: "module" })}\n`,
  "squeal.config.json": `${JSON.stringify({ coverage: { enabled: false } })}\n`,
  "vitest.config.mjs": 'export default { test: { include: ["test/*.test.ts"] } };\n',
};

export const ref = (path: string): TestFileRef => ({ project: "", path });

export function git(root: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
    { cwd: root, encoding: "utf8" },
  );
}

export function write(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

/** The ignored install: `node_modules/vitest`, a link to this repository's. */
export function link(tree: string): void {
  mkdirSync(join(tree, "node_modules"), { recursive: true });
  if (!existsSync(join(tree, "node_modules/vitest")))
    symlinkSync(VITEST, join(tree, "node_modules/vitest"));
}

/** A checkout install that makes the fixture's link and counts its calls. */
export function linkInstall(): {
  install: (tree: AbsolutePath) => Promise<InstallResult>;
  calls: () => number;
} {
  let calls = 0;
  return {
    install: async (tree) => {
      calls++;
      link(tree);
      return { ok: true, command: "link", ms: 0 };
    },
    calls: () => calls,
  };
}

export interface Fixture {
  readonly root: AbsolutePath;
  readonly dir: AbsolutePath;
  readonly cacheRoot: AbsolutePath;
  /** Writes `files` (`null` removes one) and commits them; the new commit. */
  commit(files: Readonly<Record<string, string | null>>, message?: string): string;
  /** Each checkout folder left in the repository's checkout dirs. */
  checkouts(): string[];
}

/** A repository with `BASE` and `files` committed as its first commit. */
export function fixture(files: Readonly<Record<string, string>>): Fixture {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "sq-at-keys-"))) as AbsolutePath;
  onCleanUp(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, "main") as AbsolutePath;
  const cacheRoot = join(dir, "cache") as AbsolutePath;
  mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  link(root);
  const commit = (changes: Readonly<Record<string, string | null>>, message = "c") => {
    for (const [path, text] of Object.entries(changes)) {
      if (text === null) rmSync(join(root, path));
      else write(root, { [path]: text });
    }
    git(root, "add", "-A");
    git(root, "commit", "-qm", message);
    return git(root, "rev-parse", "HEAD").trim();
  };
  commit({ ...BASE, ...files }, "A");
  const commonDir = realpathSync(join(root, ".git")) as AbsolutePath;
  const checkouts = () =>
    listCheckouts([cacheCheckoutsDir(cacheRoot, commonDir), gitCheckoutsDir(commonDir)]).map(
      (c) => c.folder,
    );
  return { root, dir, cacheRoot, commit, checkouts };
}

/** What `keysAtCommit` and `sideKeys` need beside the fixture's own. */
export function keying(f: Fixture, install = linkInstall().install) {
  return {
    adapters: daemonAdapters,
    squealVersion: squealVersion(),
    env: process.env,
    cacheRoot: f.cacheRoot,
    install,
  };
}

/** The key a fresh walk gives `file` at `commit`: the gate's lookup key in a worktree there. */
export async function freshKey(f: Fixture, commit: string, file: TestFileRef): Promise<CheckKey> {
  const tree = join(f.dir, `fresh-${commit.slice(0, 8)}-${Date.now()}`) as AbsolutePath;
  git(f.root, "worktree", "add", "-q", "--detach", tree, commit);
  try {
    link(tree);
    const policy = readPolicy(tree);
    const stored = openStored({
      root: tree,
      commonDir: realpathSync(join(f.root, ".git")) as AbsolutePath,
      policy,
      squealVersion: squealVersion(),
      env: process.env,
      adapters: (tempDir) => daemonAdapters(tree, policy, tempDir),
    });
    if (stored === null) throw new Error("no stores");
    try {
      const key = (await stored.keys([file])).get(file);
      if (key === null || key === undefined) throw new Error(`no fresh key for ${file.path}`);
      return key;
    } finally {
      await stored.close();
    }
  } finally {
    git(f.root, "worktree", "remove", "--force", tree);
  }
}

/** Whether Vitest, run for real in a plain worktree at `commit`, passes `file`. */
export function passesAt(f: Fixture, commit: string, file: TestFileRef): boolean {
  const tree = join(f.dir, `run-${commit.slice(0, 8)}-${Date.now()}`);
  git(f.root, "worktree", "add", "-q", "--detach", tree, commit);
  try {
    link(tree);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !/^(VITEST|NODE_OPTIONS$|TEST$)/.test(name)),
    );
    const vitest = join(tree, "node_modules/vitest/vitest.mjs");
    const run = spawnSync(process.execPath, [vitest, "run", file.path], {
      cwd: tree,
      env,
      encoding: "utf8",
      timeout: 120_000,
    });
    return run.status === 0;
  } finally {
    git(f.root, "worktree", "remove", "--force", tree);
  }
}
