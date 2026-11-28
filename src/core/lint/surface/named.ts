import { blobHash } from "../../hash/blob.js";
import type { EpochMs, RelativePath, RevisionNumber, WorktreeId } from "../../types/common.js";
import type { LintKnownState, LintTool } from "../../types/lint.js";
import type {
  LintCpuWait,
  NamedLint,
  NamedLintFile,
  NamedLintWait,
} from "../../types/lint-delivery.js";
import { readCpuWait } from "../pass/cpu-wait.js";
import { type HeldBy, readHeld } from "../pass/moment.js";
import {
  failedKey,
  type LintCursor,
  lintScope,
  offKey,
  readBlobs,
  readCursor,
  readEdited,
  readQuiet,
  releaseKey,
} from "../pass/records.js";
import { TOOLS } from "../store/checks.js";
import type { LintStore } from "../store/types.js";
import { cpuWaitWords } from "./format.js";
import { findingsOf } from "./snapshot.js";

/*
 * Row 017-37 (gh-238, spec 017 D8): the lint of the paths a named wait
 * names, apart from the repository's count, so a gate reads the lint of
 * the files it names and need not wait for a full re-lint.
 *
 * Review 0.1.666 B1, the freshness rule: a saved verdict counts only when
 * its tool's pass keyed the wait's revision (its lint cursor is at it or
 * later) and the result was judged at the named file's bytes now. Else the
 * check is `pending`, waiting for the keying. An unchanged file keeps an
 * older result: its judged revision may be any. A tool that is off, or
 * whose last keying failed, gives `unknown` with why: no keying will come.
 */

/** What a named read checks each verdict against: the wait's revision and the files' bytes now. */
export interface NamedLintAt {
  readonly revision: RevisionNumber;
  /** The named file's bytes now; `null` when it is gone or unreadable. */
  readonly bytes: (path: RelativePath) => Uint8Array | null;
  /** The paths named as files: one with no check yet waits while its tool's keying is behind. */
  readonly files: readonly RelativePath[];
}

/** What one tool's records say of a pending check: its wait, and the pool's refusal for a backlog. */
interface ScopeReads {
  readonly quiet: ReadonlySet<RelativePath>;
  readonly edited: ReadonlySet<RelativePath>;
  readonly held: HeldBy | null;
  readonly released: ReadonlyMap<RelativePath, unknown>;
  readonly cpuWait: LintCpuWait | null;
  readonly cursor: LintCursor | null;
  /** Why the tool gives no verdict now: it is off, or its last keying failed. */
  readonly closed: string | null;
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
  at: NamedLintAt,
): NamedLint | null {
  const files: NamedLintFile[] = [];
  for (const tool of TOOLS) {
    const states = store.states.list(worktreeId, { tool }).filter((s) => named(s.check.path));
    const reads = scopeReads(store, lintScope(worktreeId, tool), now);
    for (const state of states) files.push(freshOf(store, state, reads, at));
    files.push(...unkeyedOf(tool, states, reads, at));
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
  const waits = new Set<NamedLintWait | undefined>(["linting", "backlog", "keying"]);
  return lint.files.filter((f) => waits.has(f.waits)).length;
}

/** The tool's pass has not keyed the wait's revision: what it saved may be of older bytes or config. */
function behind(reads: ScopeReads, at: NamedLintAt): boolean {
  return reads.cursor === null || reads.cursor.revision < at.revision;
}

const keyingWords = (reads: ScopeReads, at: NamedLintAt) =>
  `lint has not keyed revision ${at.revision} yet (${reads.cursor === null ? "no keying yet" : `last keyed at revision ${reads.cursor.revision}`})`;

/** A check under the freshness rule: closed, waiting for its keying, of other bytes, or as stored. */
function freshOf(
  store: LintStore,
  state: LintKnownState,
  reads: ScopeReads,
  at: NamedLintAt,
): NamedLintFile {
  const { path, tool } = state.check;
  if (reads.closed !== null) return { path, tool, outcome: "unknown", reason: reads.closed };
  const keying = (reason: string): NamedLintFile => {
    return { path, tool, outcome: "pending", reason, waits: "keying" };
  };
  if (behind(reads, at)) return keying(keyingWords(reads, at));
  if (!judgedAtBytes(state, at.bytes(path))) {
    return keying("its saved result is of other bytes; lint has not keyed the file as it is now");
  }
  return fileOf(store, state, reads);
}

/** A `pass` or `fail` judged at `bytes`; any other outcome needs no bytes. */
function judgedAtBytes(state: LintKnownState, bytes: Uint8Array | null): boolean {
  if (state.outcome !== "pass" && state.outcome !== "fail") return true;
  const blob = state.judged?.blob;
  if (blob === undefined || bytes === null) return false;
  return blobHash(bytes, blob.length === 64 ? "sha256" : "sha1") === blob;
}

/**
 * Files named by their own path with no check of a tool whose pass has not
 * keyed the wait's revision: a new file may get one. A tool that never
 * keyed (no cursor) is not in use, and an off or failed tool keys nothing.
 */
function unkeyedOf(
  tool: LintTool,
  states: readonly LintKnownState[],
  reads: ScopeReads,
  at: NamedLintAt,
): NamedLintFile[] {
  if (reads.cursor === null || reads.closed !== null || !behind(reads, at)) return [];
  const checked = new Set(states.map((s) => s.check.path));
  return at.files
    .filter((path) => !checked.has(path))
    .map((path) => ({
      path,
      tool,
      outcome: "pending" as const,
      reason: keyingWords(reads, at),
      waits: "keying" as const,
    }));
}

function scopeReads(store: LintStore, scope: string, now: EpochMs): ScopeReads {
  const { meta } = store;
  return {
    quiet: readQuiet(meta, scope),
    edited: readEdited(meta, scope),
    held: readHeld(meta, scope),
    released: readBlobs(meta, releaseKey(scope)),
    cpuWait: readCpuWait(meta, scope, now),
    cursor: readCursor(meta, scope),
    closed: closedOf(meta.get(offKey(scope)), meta.get(failedKey(scope))),
  };
}

function closedOf(off: string | null, failed: string | null): string | null {
  if (off !== null) return `lint is off: ${off}`;
  return failed === null ? null : `the last lint keying failed: ${failed}`;
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
