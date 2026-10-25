import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type CodePassOptions,
  type Counter,
  createCodePass,
  headAfterMove,
  type PassReport,
  type PassSource,
  type SourceFile,
} from "../../../src/core/code/pass/index.js";
import { type PassContext, runPass } from "../../../src/core/code/pass/pass.js";
import type { CodeStore } from "../../../src/core/code/store/index.js";
import { blobHash } from "../../../src/core/hash/index.js";
import type { CodeLanguage, FunctionCount } from "../../../src/core/types/code.js";
import { DEFAULT_POLICY, type Policy } from "../../../src/core/types/index.js";
import { git } from "../../hash/git-repo.js";
import { commonDir } from "../helpers.js";

/**
 * A fake counter (015-05 is a sibling row): each line of a file of the
 * form `<qualified name> <cc> <body>` is one function, with an `!` after it
 * when it is in a parse error's range; other lines are none. Occurrences
 * count repeated names in order.
 */
export function fakeCounter(version = 1): Counter & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    version,
    calls,
    count(text: string, _language: CodeLanguage) {
      calls.push(text);
      const functions: FunctionCount[] = [];
      const errors: FunctionCount["range"][] = [];
      const seen = new Map<string, number>();
      text
        .split("\n")
        .filter((line) => /^\s*\S+ \d+ \S+( !)?\s*$/.test(line))
        .forEach((line, i) => {
          const [name = "", cc = "1", body = "", error] = line.trim().split(/\s+/);
          const occurrence = seen.get(name) ?? 0;
          seen.set(name, occurrence + 1);
          const range = { startLine: i + 1, startColumn: 1, endLine: i + 1, endColumn: 80 };
          if (error === "!") errors.push(range);
          functions.push({
            qualifiedName: name,
            occurrence,
            range,
            bodyHash: body,
            complexity: Number(cc),
            decisions: Number(cc) > 1 ? { if: Number(cc) - 1 } : {},
          });
        });
      return Promise.resolve({ functions, errors });
    },
  };
}

/**
 * Row 015-18: `fakeCounter`'s counts after `failures` calls that throw, as
 * a grammar that did not load or a read error does; `Infinity` never counts.
 */
export function flakyCounter(failures: number): Counter & { readonly calls: string[] } {
  const inner = fakeCounter();
  const calls: string[] = [];
  return {
    version: inner.version,
    calls,
    count(text, language) {
      calls.push(text);
      if (calls.length <= failures) return Promise.reject(new Error("tree-sitter: out of memory"));
      return inner.count(text, language);
    },
  };
}

/** The policy with complexity on; `threshold` 20 unless given. */
export function policyOn(over: Partial<Policy["complexity"]> = {}): Policy {
  return {
    ...DEFAULT_POLICY,
    complexity: { ...DEFAULT_POLICY.complexity, enabled: true, ...over },
  };
}

/**
 * One worktree on disk with a fake main store: `write` changes a file and
 * the stat cache, `revise` stores a revision of the paths written since,
 * at the `HEAD` the last `commit` made (`null` before the first).
 */
export class FakeWorktree {
  readonly root: string;
  readonly testFiles: string[] = [];
  readonly ignored: string[] = [];
  /** The revision the runners listed up to (row 015-52); `null` follows the latest. */
  listed: number | null = null;
  readonly #files = new Map<string, SourceFile>();
  readonly #revisions: string[][] = [];
  readonly #heads: (string | null)[] = [];
  #pending = new Set<string>();
  #head: string | null = null;

  constructor(
    readonly id: string,
    readonly commonDir: string,
  ) {
    this.root = join(dirname(commonDir), `tree-${id}`);
    mkdirSync(this.root, { recursive: true });
  }

  write(path: string, text: string): this {
    const full = join(this.root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
    const bytes = Buffer.from(text);
    this.#files.set(path, { path, hash: blobHash(bytes, "sha1"), size: bytes.length });
    this.#pending.add(path);
    return this;
  }

  /** A symlink, hashed as git stores it: the blob of its target path. */
  link(path: string, target: string): this {
    const full = join(this.root, path);
    mkdirSync(dirname(full), { recursive: true });
    symlinkSync(target, full);
    const bytes = Buffer.from(target);
    this.#files.set(path, { path, hash: blobHash(bytes, "sha1"), size: bytes.length });
    this.#pending.add(path);
    return this;
  }

  remove(path: string): this {
    rmSync(join(this.root, path), { force: true });
    this.#files.delete(path);
    this.#pending.add(path);
    return this;
  }

  /**
   * Commits `paths`, every file when none is given, in a git repository at
   * the root made at the first commit. `HEAD` moves as a pull, merge,
   * rebase or checkout moves it (015-19).
   */
  commit(...paths: string[]): string {
    if (this.#head === null) git(this.root, ["init", "-q", "-b", "main"]);
    git(this.root, ["add", "-A", "--", ...paths]);
    git(this.root, ["commit", "-q", "--allow-empty", "-m", "commit"]);
    this.#head = git(this.root, ["rev-parse", "HEAD"]).trim();
    return this.#head;
  }

  /**
   * Commits `files` on a new branch `name` from `HEAD`, then checks out the
   * branch it left, so the work tree and the stat cache are as they were.
   */
  branch(name: string, files: Record<string, string>): string {
    git(this.root, ["checkout", "-q", "-b", name]);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(this.root, path)), { recursive: true });
      writeFileSync(join(this.root, path), text);
    }
    git(this.root, ["add", "--", ...Object.keys(files)]);
    git(this.root, ["commit", "-q", "-m", name]);
    const sha = git(this.root, ["rev-parse", "HEAD"]).trim();
    git(this.root, ["checkout", "-q", "-"]);
    return sha;
  }

  /**
   * Runs git at the root, then reads `paths` again from disk and `HEAD`
   * from git, as a merge, cherry-pick, revert or rebase leaves them
   * (015-34). A command a conflict stops exits 1; that is no error here.
   */
  run(args: readonly string[], ...paths: string[]): this {
    try {
      git(this.root, args);
    } catch {
      // The test asserts what the stopped command left.
    }
    this.#head = git(this.root, ["rev-parse", "HEAD"]).trim();
    return this.reread(...paths);
  }

  /** Reads `paths` again from disk into the stat cache, as the watcher would after git wrote them. */
  reread(...paths: string[]): this {
    for (const path of paths) {
      const full = join(this.root, path);
      if (!existsSync(full)) {
        this.remove(path);
        continue;
      }
      const bytes = readFileSync(full);
      this.#files.set(path, { path, hash: blobHash(bytes, "sha1"), size: bytes.length });
      this.#pending.add(path);
    }
    return this;
  }

  /** Stores one revision of every path written or removed since the last. */
  revise(): number {
    this.#revisions.push([...this.#pending]);
    this.#heads.push(this.#head);
    this.#pending = new Set();
    return this.#revisions.length;
  }

  readonly source: PassSource = {
    latestRevision: () => this.#revisions.length,
    changedPaths: (after, upTo) => [...new Set(this.#revisions.slice(after, upTo).flat())],
    lastChanges: (after, upTo) =>
      new Map(
        this.#revisions
          .slice(after, upTo)
          .flatMap((paths, i) => paths.map((p) => [p, after + i + 1])),
      ),
    movedHead: (after, upTo) =>
      headAfterMove(after > 0 ? this.#heads[after - 1] : undefined, this.#heads.slice(after, upTo)),
    file: (path) => this.#files.get(path) ?? null,
    files: () => [...this.#files.values()],
    listedRevision: () => Math.min(this.listed ?? this.#revisions.length, this.#revisions.length),
    testFiles: () => this.testFiles,
    ignored: () => this.ignored,
  };
}

/** A fresh common dir and one worktree in it. */
export function worktree(id = "w1", dir = commonDir()): FakeWorktree {
  return new FakeWorktree(id, dir);
}

/** One pass with the defaults a daemon would give, over `tree` and `store`. */
export function pass(
  tree: FakeWorktree,
  store: CodeStore,
  counter: Counter,
  over: Partial<PassContext> & { policy?: Policy } = {},
) {
  const { policy = policyOn(), ...rest } = over;
  return runPass({
    worktreeId: tree.id,
    root: tree.root,
    format: "sha1",
    store,
    source: tree.source,
    counter,
    complexity: policy.complexity,
    switchedOn: false,
    retry: new Set(),
    now: () => 1_000,
    log: () => {},
    ...rest,
  });
}

/** The daemon's code pass over `tree`, with what it reported, raised and logged. */
export function daemonPass(
  tree: FakeWorktree,
  over: Partial<CodePassOptions> & { policy?: () => Policy },
) {
  const reports: PassReport[] = [];
  const errors: Error[] = [];
  const logs: string[] = [];
  const code = createCodePass({
    worktreeId: tree.id,
    root: tree.root,
    commonDir: tree.commonDir,
    format: "sha1",
    source: tree.source,
    policy: () => policyOn(),
    counter: () => Promise.resolve(fakeCounter()),
    now: () => 1_000,
    log: (text) => logs.push(text),
    onError: (error) => errors.push(error),
    onPass: (report) => reports.push(report),
    ...over,
  });
  return { code, reports, errors, logs };
}
