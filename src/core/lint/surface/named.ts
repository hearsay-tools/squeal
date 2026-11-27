import type { EpochMs, RelativePath, WorktreeId } from "../../types/common.js";
import type { LintKnownState } from "../../types/lint.js";
import type {
  LintCpuWait,
  NamedLint,
  NamedLintFile,
  NamedLintWait,
} from "../../types/lint-delivery.js";
import { readCpuWait } from "../pass/cpu-wait.js";
import { type HeldBy, readHeld } from "../pass/moment.js";
import { lintScope, readBlobs, readEdited, readQuiet, releaseKey } from "../pass/records.js";
import { TOOLS } from "../store/checks.js";
import type { LintStore } from "../store/types.js";
import { cpuWaitWords } from "./format.js";
import { findingsOf } from "./snapshot.js";

/*
 * Row 017-37 (gh-238, spec 017 D8): the lint of the paths a named wait
 * names, apart from the repository's count, so a gate reads the lint of
 * the files it names and need not wait for a full re-lint.
 */

/** What one tool's records say of a pending check: its wait, and the pool's refusal for a backlog. */
interface ScopeReads {
  readonly quiet: ReadonlySet<RelativePath>;
  readonly edited: ReadonlySet<RelativePath>;
  readonly held: HeldBy | null;
  readonly released: ReadonlyMap<RelativePath, unknown>;
  readonly cpuWait: LintCpuWait | null;
}

/**
 * The checks of the worktree's paths `named` picks, every tool's; `null`
 * when it picks none (lint does not include them, or no pass keyed them).
 */
export function namedLintOf(
  store: LintStore,
  worktreeId: WorktreeId,
  named: (path: RelativePath) => boolean,
  now: EpochMs,
): NamedLint | null {
  const files: NamedLintFile[] = [];
  for (const tool of TOOLS) {
    const states = store.states.list(worktreeId, { tool }).filter((s) => named(s.check.path));
    if (states.length === 0) continue;
    const reads = scopeReads(store, lintScope(worktreeId, tool), now);
    for (const state of states) files.push(fileOf(store, state, reads));
  }
  if (files.length === 0) return null;
  files.sort((a, b) => a.path.localeCompare(b.path) || a.tool.localeCompare(b.tool));
  const count = (pick: (f: NamedLintFile) => boolean) => files.filter(pick).length;
  return {
    done: count((f) => f.outcome === "pass" || f.outcome === "fail"),
    pending: count((f) => f.outcome === "pending"),
    failing: count((f) => f.outcome === "fail"),
    unknown: count((f) => f.outcome === "unknown"),
    files,
  };
}

/** The checks a named wait waits for: the pass lints them while it waits (`NamedLintWait`). */
export function namedLintWaits(lint: NamedLint | null): number {
  if (lint === null) return 0;
  return lint.files.filter((f) => f.waits === "linting" || f.waits === "backlog").length;
}

function scopeReads(store: LintStore, scope: string, now: EpochMs): ScopeReads {
  const { meta } = store;
  return {
    quiet: readQuiet(meta, scope),
    edited: readEdited(meta, scope),
    held: readHeld(meta, scope),
    released: readBlobs(meta, releaseKey(scope)),
    cpuWait: readCpuWait(meta, scope, now),
  };
}

function fileOf(store: LintStore, state: LintKnownState, reads: ScopeReads): NamedLintFile {
  const { path, tool } = state.check;
  if (state.outcome === "pending" || state.stale) {
    const waits = waitOf(state, reads);
    const cpuWait = waits === "backlog" ? reads.cpuWait : null;
    return {
      path,
      tool,
      outcome: "pending",
      reason: pendingWords(waits, reads.held, cpuWait),
      waits,
      ...(cpuWait === null ? {} : { cpuWait }),
    };
  }
  if (state.outcome === "unknown") {
    return { path, tool, outcome: "unknown", reason: state.reason ?? "no reason recorded" };
  }
  if (state.outcome === "pass") return { path, tool, outcome: "pass" };
  // A fail with no judged result has no stored findings: none are counted, never "0 findings".
  const findings = state.judged === null ? null : findingsOf(store, state);
  return {
    path,
    tool,
    outcome: "fail",
    ...(findings === null ? {} : { findings: findings.length }),
  };
}

/** What a pending or stale check waits for (`NamedLintWait`). */
function waitOf(state: LintKnownState, reads: ScopeReads): NamedLintWait {
  const path = state.check.path;
  if (reads.held !== null && !reads.released.has(path)) return "held";
  if (state.outcome !== "pending") return "stale";
  return reads.quiet.has(path) && !reads.edited.has(path) ? "backlog" : "linting";
}

const HELD_WORDS: Readonly<Record<HeldBy["at"], string>> = {
  commit: "waits for a commit",
  pause: "waits for the agent to pause",
  stop: "waits for the agent to stop",
  manual: "waits for squeal run",
};

/** A pending check's wait in words, the pool's refusal of a backlog's lease included. */
function pendingWords(
  waits: NamedLintWait,
  held: HeldBy | null,
  cpuWait: LintCpuWait | null,
): string {
  if (waits === "held" && held !== null) {
    const words = HELD_WORDS[held.at];
    return held.at === "manual" ? `${words} ${held.group}` : `${words} (group ${held.group})`;
  }
  if (waits === "stale") return "stale: lints again once the agent is idle";
  if (waits === "linting") return "linting as an edited file";
  if (cpuWait === null) return "waits in the backlog of a full re-lint";
  return `waits in the backlog of a full re-lint, ${cpuWaitWords(cpuWait)}`;
}
