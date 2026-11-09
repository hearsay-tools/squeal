import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import {
  encodeBundle,
  RESULTS_FORMAT,
  type ResultsBundle,
} from "../../src/core/store/transfer-bundle.js";
import type { AbsolutePath } from "../../src/core/types/common.js";

/*
 * Spec 018 D13, D14 (row 018-20): a scratch bare repository as the remote, a
 * clone whose `main` is pushed there, and exports made by hand. `/tmp` where
 * there is one, as the other CI tests do.
 */

const BASE = existsSync("/tmp") ? "/tmp" : tmpdir();

const IDENTITY = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgSign=false"];

export function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...IDENTITY, ...args], { cwd, encoding: "utf8" }).trim();
}

export interface Scratch {
  readonly dir: AbsolutePath;
  /** The bare repository, `origin` of every clone. */
  readonly remote: AbsolutePath;
  readonly cleanup: () => void;
}

/** An empty bare repository in a new scratch directory. */
export function scratchRemote(): Scratch {
  const dir = mkdtempSync(join(BASE, "squeal-shared-"));
  const remote = join(dir, "remote.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  return { dir, remote, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * A clone of `scratch.remote` named `name`, with `commits` new commits on
 * `main` pushed and `origin/HEAD` set: their ids, oldest first.
 */
export function cloneWith(
  scratch: Scratch,
  name: string,
  commits: number,
  files: Readonly<Record<string, string>> = {},
): { root: AbsolutePath; commits: string[] } {
  const root = join(scratch.dir, name);
  mkdirSync(root);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["remote", "add", "origin", scratch.remote]);
  for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text);
  const made: string[] = [];
  for (let i = 0; i < commits; i++) {
    writeFileSync(join(root, "n.txt"), `${name} ${i}\n`);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-qm", `c${i}`]);
    made.push(git(root, ["rev-parse", "HEAD"]));
  }
  git(root, ["push", "-q", "origin", "main"]);
  git(root, ["fetch", "-q", "origin"]);
  git(root, ["remote", "set-head", "origin", "main"]);
  return { root, commits: made };
}

/** A developer's clone of `scratch.remote`: `origin/HEAD` set, nothing else configured. */
export function cloneOf(scratch: Scratch, name: string): AbsolutePath {
  const root = join(scratch.dir, name);
  execFileSync("git", ["clone", "-q", scratch.remote, root]);
  return root;
}

/** An export of `commit` with no test file, as `squeal ci export` writes one. */
export function exportOf(commit: string, overrides: Partial<ResultsBundle> = {}): Buffer {
  const bundle: ResultsBundle = {
    format: RESULTS_FORMAT,
    header: {
      squealVersion: "0.0.0",
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
    environments: [],
    testFiles: [],
    observedStartup: [],
    results: [],
    ...overrides,
  };
  return encodeBundle(bundle);
}

/** The remote's refs under `prefix`, by name, sorted. */
export function remoteRefs(scratch: Scratch, prefix = "refs/squeal"): string[] {
  const out = git(scratch.remote, ["for-each-ref", "--format=%(refname)", prefix]);
  return out === "" ? [] : out.split("\n").sort();
}

/** What a reader must leave as it was: the config, every ref, `FETCH_HEAD`. */
export function untouched(root: string): string {
  const gitDir = join(root, ".git");
  const fetchHead = join(gitDir, "FETCH_HEAD");
  return JSON.stringify({
    config: readFileSync(join(gitDir, "config"), "utf8"),
    refs: git(root, ["for-each-ref", "--format=%(objectname) %(refname)"]),
    fetchHead: existsSync(fetchHead) ? readFileSync(fetchHead, "utf8") : null,
    head: git(root, ["rev-parse", "HEAD"]),
  });
}
