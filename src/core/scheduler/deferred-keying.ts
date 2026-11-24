import { CHECK_RUNNERS } from "../daemon/check-groups.js";
import type { CheckMoment, CheckRunner, ResolvedGroup } from "../types/check-groups.js";
import type { RelativePath } from "../types/common.js";
import type { Policy } from "../types/policy.js";
import { groupView } from "./slow.js";
import { type QueuedRefine, supersede } from "./superseded.js";

/*
 * Spec 026 D1 (row 026-05): moment-aware runner keying. A runner is eager
 * when a test group that can own one of its files runs at `edit` or
 * `pause`; otherwise it is deferred, and the daemon opens no host of it on
 * the background paths (start, revisions, touches, observed updates, CI
 * imports, rechecks, import re-walks). The predicates are pure: they read
 * the resolved groups only, never the file list. `OwedRunnerWork` holds
 * what the background paths owe the next explicit request.
 */

/** D1.1: the moments at which a group runs with no request. */
const EAGER_MOMENTS: ReadonlySet<CheckMoment> = new Set(["edit", "pause"]);

/**
 * D1.1: whether `runner` is deferred under `policy`. A group can own one of
 * the runner's files unless an earlier group takes every file the runner
 * has: one of the runner with no project and no `tests`, or, for node:test
 * and pytest, groups that each take a whole entry, for every entry. When
 * that cannot be told from the policy alone, the runner is eager, as
 * before this row.
 */
export function runnerKeyingDeferred(policy: Policy, runner: CheckRunner): boolean {
  const entries = entryNames(policy, runner);
  if (entries !== null && entries.length === 0) return true;
  const taken = new Set<string>();
  for (const group of groupView(policy).groups) {
    if (!ownsAny(group, runner)) continue;
    if (EAGER_MOMENTS.has(group.at)) return false;
    const { select } = group;
    if (select.kind !== "tests" || select.tests !== null) continue;
    if (select.project === null) return true;
    taken.add(select.project);
    if (entries?.every((name) => taken.has(name))) return true;
  }
  return true;
}

/**
 * D1: whether the scheduler's runner keying is deferred. The scheduler
 * holds one runner for every runner of the worktree, so it defers only
 * when each runner is deferred.
 */
export function keyingDeferred(policy: Policy): boolean {
  return CHECK_RUNNERS.every((runner) => runnerKeyingDeferred(policy, runner));
}

/**
 * D1.4: whether Stop asks a group of a deferred runner: a test group at
 * `stop`, or one Stop waits for. A Stop then opens the runner to key it.
 */
export function stopAsksTests(policy: Policy): boolean {
  return groupView(policy).groups.some(
    (group) => group.select.kind !== "lint" && (group.at === "stop" || group.stopRequires),
  );
}

/** A group whose selector may take a file of `runner`. */
function ownsAny(group: ResolvedGroup, runner: CheckRunner): boolean {
  const { select } = group;
  if (select.kind === "lint") return false;
  if (select.kind === "tests") return select.runner === runner;
  return true;
}

/**
 * The entry names of a node:test or pytest runner, which the policy lists;
 * `null` for Vitest, whose projects come from its own config.
 */
function entryNames(policy: Policy, runner: CheckRunner): readonly string[] | null {
  if (runner === "nodeTest") return policy.nodeTest.map((entry) => entry.name);
  if (runner === "pytest") return policy.pytest.map((entry) => entry.name);
  return null;
}

/** What `OwedRunnerWork.take` hands the wake. */
export interface OwedWork {
  /** One refinement of every deferred revision (`supersede`); `null` with none. */
  readonly refine: QueuedRefine | null;
  /** Paths touched with their bytes unchanged that no refinement names. */
  readonly touched: readonly RelativePath[];
  /** Another worktree or an import grew the observed reads. */
  readonly observed: boolean;
}

/**
 * D1.2, D1.4: the runner work a deferred runner owes, kept until the next
 * wake. Revisions merge as queued refinements do (row 011-396), so a long
 * session of edits owes one refinement.
 */
export class OwedRunnerWork {
  #refine: QueuedRefine | null = null;
  readonly #touched = new Set<RelativePath>();
  #observed = false;

  get owes(): boolean {
    return this.#refine !== null || this.#touched.size > 0 || this.#observed;
  }

  addRefine(newer: QueuedRefine): void {
    this.#refine = this.#refine === null ? newer : supersede(this.#refine, newer);
  }

  addTouched(paths: readonly RelativePath[]): void {
    for (const path of paths) this.#touched.add(path);
  }

  addObserved(): void {
    this.#observed = true;
  }

  /** What is owed, now no longer owed; `null` when nothing is. */
  take(): OwedWork | null {
    if (!this.owes) return null;
    const owed = {
      refine: this.#refine,
      touched: [...this.#touched].sort(),
      observed: this.#observed,
    };
    this.clear();
    return owed;
  }

  clear(): void {
    this.#refine = null;
    this.#touched.clear();
    this.#observed = false;
  }
}
