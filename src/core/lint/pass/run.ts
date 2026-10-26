import type { EpochMs, Policy, RelativePath, RevisionNumber } from "../../types/index.js";
import type { LintStore } from "../store/types.js";
import { Keyer } from "./keyer.js";
import { lintParts, type PartsEnd } from "./parts.js";
import { offKey, readCursor, readProgram, writeReason } from "./records.js";
import { type Rekeyed, rekey } from "./rekey.js";
import type { ProviderSession } from "./session.js";
import type { LintPassOptions, LintPassReport } from "./types.js";

/** What one pass works with beside the daemon's options. */
export interface PassState {
  readonly store: LintStore;
  readonly policy: Policy;
  readonly session: ProviderSession;
  readonly nodeMajor: number;
  /** Changed program files not yet fed to the worker (D5). */
  readonly feed: Set<RelativePath>;
  readonly now: () => EpochMs;
  readonly interrupted: () => boolean;
}

/** When the pass should look again, and whether a report grew the closure or the program. */
export interface PassEnd {
  readonly wakeAt: EpochMs | null;
  readonly grew: boolean;
}

/**
 * Spec 017 D7, one pass at the latest revision: the provider made ready
 * (D4), the keys of what changed looked up (steps 1 to 3), then the pending
 * files linted in parts (step 4). The provider's off reason is kept for
 * status (D9).
 */
export async function runLintPass(options: LintPassOptions, state: PassState): Promise<PassEnd> {
  const { worktreeId, source } = options;
  const { store, session, now } = state;
  const latest = source.latestRevision();
  const since = readCursor(store.meta, worktreeId)?.revision ?? latest;
  const changed = (after: number) => (after >= latest ? [] : source.changedPaths(after, latest));
  const ready = await session.ready(changed, since, latest);
  writeReason(store.meta, offKey(worktreeId), "off" in ready ? ready.off : null);
  if ("off" in ready) return { wakeAt: null, grew: false };
  const basis = {
    snapshot: ready.snapshot,
    installed: ready.installed,
    nodeMajor: state.nodeMajor,
  };
  const disk = { root: options.root, format: options.format };
  const extensions = new Set(readProgram(store.meta, worktreeId).extensions);
  const keyer = new Keyer(basis, ready.provider, source, disk, extensions);
  const lint = state.policy.lint;
  const keyed = await rekey({ worktreeId, store, source, lint, now }, keyer, latest);
  for (const path of keyed?.feed ?? []) state.feed.add(path);
  const parts = await lintParts(
    {
      worktreeId,
      root: options.root,
      format: options.format,
      store,
      source,
      session,
      latest,
      now,
      capacity: options.capacity ?? (() => null),
      idleIn: options.idleIn ?? (() => 0),
      interrupted: state.interrupted,
      first: keyed?.first ?? new Set(),
      feed: state.feed,
    },
    keyer,
  );
  if (parts.off !== null) writeReason(store.meta, offKey(worktreeId), parts.off);
  if (keyed !== null || parts.linted > 0 || parts.hits > 0) {
    options.onPass?.(reportOf(latest, keyed, parts));
  }
  return { wakeAt: parts.wakeAt, grew: parts.grew };
}

/** What the pass did: its keying's counts and its parts'. */
function reportOf(latest: RevisionNumber, keyed: Rekeyed | null, parts: PartsEnd): LintPassReport {
  return {
    revision: latest,
    mode: keyed?.mode ?? "edit",
    keyed: keyed?.keyed ?? 0,
    hits: (keyed?.hits ?? 0) + parts.hits,
    linted: parts.linted,
    stale: keyed?.stale ?? 0,
    transitions: (keyed?.transitions ?? 0) + parts.transitions,
  };
}
