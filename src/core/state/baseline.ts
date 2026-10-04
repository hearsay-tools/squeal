import type {
  CheckId,
  DiagnosticFingerprint,
  Store,
  Transition,
  WorktreeId,
} from "../types/index.js";
import { checkIdentity } from "./derive.js";

/*
 * Spec 001 D6: "Failures first observed by the baseline run after
 * registration are delivered once, in a batch labelled as baseline findings."
 *
 * Neither transitions nor known states name the checkpoint that produced
 * them, so the sink keeps the first-seen failures of the worktree's newest
 * baseline checkpoint in `meta`, and delivery labels a `first-seen-fail`
 * delta entry whose check and fingerprint are in that set. A later
 * transition of the check drops it from the set; a new baseline checkpoint
 * starts a new set.
 */

const metaKey = (worktreeId: WorktreeId) => `state.baseline-findings.${worktreeId}`;

interface Findings {
  readonly checkpointId: string;
  readonly entries: readonly string[];
}

function entry(check: CheckId, fingerprint: DiagnosticFingerprint | null): string {
  return `${checkIdentity(check)}\0${fingerprint ?? ""}`;
}

function read(store: Store, worktreeId: WorktreeId): Findings | null {
  const raw = store.meta.get(metaKey(worktreeId));
  return raw === null ? null : (JSON.parse(raw) as Findings);
}

/** Updates the set after the sink recorded `transitions`. Call inside the sink's transaction. */
export function recordBaselineFindings(
  store: Store,
  worktreeId: WorktreeId,
  checkpointId: string | null,
  transitions: readonly Transition[],
): void {
  if (transitions.length === 0) return;
  const baseline =
    checkpointId !== null && store.checkpoints.get(checkpointId)?.kind === "baseline";
  const current = read(store, worktreeId);
  if (!baseline && current === null) return;

  const fresh = baseline && current?.checkpointId !== checkpointId;
  const entries = new Set(fresh ? [] : current?.entries);
  const touched = new Set(transitions.map((t) => checkIdentity(t.check)));
  for (const e of entries) if (touched.has(e.slice(0, e.lastIndexOf("\0")))) entries.delete(e);
  if (baseline) {
    for (const t of transitions) {
      if (t.kind === "first-seen-fail") entries.add(entry(t.check, t.toFingerprint));
    }
  }
  const id = baseline ? checkpointId : (current?.checkpointId ?? "");
  const next: Findings = { checkpointId: id, entries: [...entries] };
  store.meta.set(metaKey(worktreeId), JSON.stringify(next));
}

/** Whether a first-seen fail of `check` with `fingerprint` is a baseline finding. */
export function baselineFindings(
  store: Store,
  worktreeId: WorktreeId,
): (check: CheckId, fingerprint: DiagnosticFingerprint | null) => boolean {
  const entries = new Set(read(store, worktreeId)?.entries);
  return (check, fingerprint) => entries.has(entry(check, fingerprint));
}
