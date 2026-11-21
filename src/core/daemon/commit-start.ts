import { existsSync } from "node:fs";
import { join } from "node:path";
import { committedBlobs } from "../commit/tree.js";
import { groupView } from "../scheduler/slow.js";
import type { CommitSetup } from "../types/commit-ask.js";
import type { AbsolutePath, RelativePath, WorktreeId } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { Policy } from "../types/policy.js";
import type { NarrowRunOptions, Scheduler } from "../types/scheduler.js";
import type { Store } from "../types/store.js";
import { AtAsks } from "./at-asks.js";
import type { CommitMode } from "./commit-mode.js";

/*
 * Spec 023 D7.3 as amended 2026-11-21 (row 023-40c, the human: "A: daemon
 * owns setup"): a commit daemon's start after its claim. It installs the
 * worktree (frozen, once), then starts as every daemon does (keys, its
 * lookup-only pass), and serves the asks of `status --at --run` meanwhile:
 * an ask is kept at once, and read back with the setup's phase ("install",
 * "starting", "ready", or "failed" with its text).
 */

/** What the daemon gives its commit start. */
export interface CommitStartPorts {
  readonly mode: CommitMode;
  readonly root: AbsolutePath;
  readonly worktreeId: WorktreeId;
  readonly store: Store;
  readonly policy: () => Policy;
  readonly scheduler: () => Scheduler | null;
  /** The daemon's own start once installed (`#run`). */
  readonly run: () => Promise<void>;
  /** The daemon's `run-group-paths` (`#requestGroup`); `null` for a group the policy lacks. */
  readonly request: (
    group: string,
    paths: readonly RelativePath[],
    options: NarrowRunOptions,
  ) => Promise<unknown>;
  /** The setup or an ask changed: the socket thread reads `asks.snapshot()` again. */
  readonly changed: () => void;
  readonly log: (line: string) => void;
}

/** A commit daemon's setup: its phase, its asks, and the start that moves them. */
export class CommitStart {
  #setup: CommitSetup = { phase: "install" };
  /** Settles once `start` did; an ask kept before `start` waits for it too. */
  readonly #started: Promise<void>;
  #settle: () => void = () => {};
  readonly asks: AtAsks;

  private readonly ports: CommitStartPorts;

  constructor(ports: CommitStartPorts) {
    this.ports = ports;
    const { store, worktreeId } = ports;
    this.#started = new Promise((resolve) => {
      this.#settle = resolve;
    });
    this.asks = new AtAsks({
      setup: () => this.#setup,
      started: () => this.#started,
      changedSelects: async (paths) => {
        const scheduler = ports.scheduler();
        if (scheduler?.changedSelects === undefined) return null;
        return scheduler.changedSelects(paths);
      },
      rows: (files) =>
        store.testFileKeys.list(worktreeId, files).map((row) => ({
          testFile: row.testFile,
          key: row.key,
          pending: row.pending ?? null,
        })),
      // D4.9: what the closures read that git does not hold at the commit (the tree's HEAD).
      needs: async (request) => {
        const scheduler = ports.scheduler();
        if (scheduler?.closureReads === undefined) return new Map();
        const atCommit = await committedBlobs(ports.root, "HEAD");
        const caller = request.root;
        const atHead =
          caller === undefined ? null : await committedBlobs(caller, "HEAD").catch(() => null);
        return scheduler.closureReads((path) => {
          if (atCommit.has(path)) return false;
          if (existsSync(join(ports.root, path))) return true;
          return (
            caller !== undefined &&
            atHead !== null &&
            !atHead.has(path) &&
            existsSync(join(caller, path))
          );
        });
      },
      stored: (ref, key) =>
        store.results
          .byKey(key)
          .some((r) => r.check.project === ref.project && r.check.testPath === ref.path),
      groupOf: (ref: TestFileRef) => groupView(ports.policy()).of(ref).name,
      request: async (group, paths, options) => {
        const requested = await ports.request(group, paths, options);
        if (requested === null) throw new Error(`no group ${group} in this commit's policy`);
      },
      changed: ports.changed,
    });
  }

  get setup(): CommitSetup {
    return this.#setup;
  }

  /** Installs, then runs the daemon's start; settles once both did, whether they served or failed. */
  async start(): Promise<void> {
    this.ports.changed();
    try {
      await this.#start();
    } finally {
      this.#settle();
      this.ports.changed();
    }
  }

  /** Whether the tree differs from the commit; then the setup says where and why, and nothing runs. */
  async #changed(by: "git" | "install"): Promise<boolean> {
    const { mode, root, log } = this.ports;
    let path: RelativePath | null;
    try {
      path = (await mode.worktrees.check?.(root)) ?? null;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.#set({ phase: "failed", text: `the check against the commit failed: ${text}` });
      return true;
    }
    if (path === null) return false;
    log(`the commit worktree does not hold ${path} as the commit does (${by}); nothing runs here`);
    this.#set({ phase: "changed", path, by });
    return true;
  }

  #set(setup: CommitSetup): void {
    this.#setup = setup;
    this.ports.changed();
  }

  async #start(): Promise<void> {
    const { mode, root, log } = this.ports;
    // Row 023-40c (row 023-07's whole-checkout check): git's own checkout rules, before the install.
    if (await this.#changed("git")) return;
    let failed: string | null;
    try {
      failed = (await mode.worktrees.install?.(root)) ?? null;
    } catch (error) {
      failed = error instanceof Error ? error.message : String(error);
    }
    if (failed !== null) {
      log(`the commit worktree's setup failed: ${failed}`);
      this.#set({ phase: "failed", text: `install: ${failed}` });
      return;
    }
    if (await this.#changed("install")) return;
    this.#set({ phase: "starting" });
    try {
      await this.ports.run();
    } finally {
      this.#setup =
        this.ports.scheduler() === null
          ? { phase: "failed", text: "the daemon did not start its scheduler; squeal ps shows it" }
          : { phase: "ready" };
    }
  }
}
