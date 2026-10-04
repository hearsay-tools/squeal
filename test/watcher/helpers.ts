import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, realpathSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CandidateBatch,
  WatcherBackend,
  WatchListener,
  WatchSpec,
  WatchSubscription,
} from "../../src/core/types/index.js";

const FIXTURES = fileURLToPath(new URL("../fixtures/watcher/", import.meta.url));

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Copies a fixture into a fresh temp dir and commits it. Returns the realpath of the root. */
export function makeRepo(fixture = "basic"): { root: string; cleanup: () => void } {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "squeal-watcher-")));
  const root = join(parent, "repo");
  cpSync(join(FIXTURES, fixture), root, { recursive: true });
  renameSync(join(root, "_gitignore"), join(root, ".gitignore"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "squeal@example.com");
  git(root, "config", "user.name", "Squeal Test");
  git(root, "config", "commit.gpgsign", "false");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "fixture");
  return { root, cleanup: () => rmSync(parent, { recursive: true, force: true }) };
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls until `check` returns true or the timeout passes. */
export async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`condition not met in ${timeoutMs} ms`);
    await delay(20);
  }
}

export class BatchLog {
  readonly batches: CandidateBatch[] = [];
  readonly push = (batch: CandidateBatch): void => {
    this.batches.push(batch);
  };
  paths(): string[] {
    return this.batches.flatMap((b) => b.paths.map((p) => p.path));
  }
  has(path: string): boolean {
    return this.paths().includes(path);
  }
  find(path: string) {
    for (let i = this.batches.length - 1; i >= 0; i--) {
      const hit = this.batches[i]?.paths.find((p) => p.path === path);
      if (hit) return { batch: this.batches[i] as CandidateBatch, candidate: hit };
    }
    return undefined;
  }
}

/** Wraps a backend so tests can drop hints, the way a lost inotify event would. */
export class PausableBackend implements WatcherBackend {
  readonly name;
  paused = false;
  private listener: WatchListener | null = null;

  constructor(private readonly inner: WatcherBackend) {
    this.name = inner.name;
  }

  watch(spec: WatchSpec, listener: WatchListener): Promise<WatchSubscription> {
    this.listener = listener;
    return this.inner.watch(spec, {
      onHints: (hints) => {
        if (!this.paused) listener.onHints(hints);
      },
      onDropped: (reason) => listener.onDropped(reason),
      onError: (error) => listener.onError(error),
    });
  }

  /** Simulates a dropped-events signal from the backend. */
  signalDropped(reason: string): void {
    this.listener?.onDropped(reason);
  }
}
