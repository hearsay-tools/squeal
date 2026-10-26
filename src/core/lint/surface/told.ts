import type { Consumer, RelativePath } from "../../types/index.js";
import type { LintMetaRepo } from "../store/types.js";

/*
 * Spec 017 D8: what a consumer's lint view accounts for, beside the view
 * itself, in the lint store's `meta` under `lint-told:<consumer>` (017-05's
 * notes: a `lint-` prefix). The view holds the outcome and fingerprint each
 * file was told at; this mark holds the newest transition the view took in,
 * as a row id, never a clock: the pass reads its clock before it writes, so
 * a clock lets a change it commits after a delivery's read look older than
 * that delivery.
 */

export interface LintToldMark {
  /** The newest transition id the view took in. */
  readonly transition: number;
  /** The last keying (`LintKeying.seq`) whose files the view holds by count; 0 for none. */
  readonly keying: number;
  /**
   * Files with transitions the view has not taken in: `pending`, `unknown`
   * or a stale `pass` when read. Each with the id its transitions count
   * after.
   */
  readonly deferred: readonly (readonly [RelativePath, number])[];
  /** D9's reasons last told, so each is told once. */
  readonly failed: string | null;
  readonly off: string | null;
}

/** A consumer with no mark: one that registered before the store existed or lint was on. */
export const NO_MARK: LintToldMark = {
  transition: 0,
  keying: 0,
  deferred: [],
  failed: null,
  off: null,
};

export const toldKey = (c: Consumer) => `lint-told:${c.worktreeId}:${c.sessionId}:${c.agentId}`;

const textOrNull = (value: unknown) => (typeof value === "string" ? value : null);

/** `consumer`'s mark; `null` when none is written or it does not parse. */
export function readTold(meta: LintMetaRepo, consumer: Consumer): LintToldMark | null {
  const raw = meta.get(toldKey(consumer));
  if (raw === null) return null;
  let value: Partial<Record<keyof LintToldMark, unknown>>;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const { transition, keying, deferred } = value ?? {};
  if (typeof transition !== "number" || typeof keying !== "number" || !Array.isArray(deferred)) {
    return null;
  }
  const pairs = deferred.filter(
    (d): d is [string, number] =>
      Array.isArray(d) && typeof d[0] === "string" && typeof d[1] === "number",
  );
  return {
    transition,
    keying,
    deferred: pairs,
    failed: textOrNull(value.failed),
    off: textOrNull(value.off),
  };
}

export function writeTold(meta: LintMetaRepo, consumer: Consumer, mark: LintToldMark): void {
  meta.set(toldKey(consumer), JSON.stringify(mark));
}

/** Drops `consumer`'s mark: it unregistered. */
export function forgetTold(meta: LintMetaRepo, consumer: Consumer): void {
  meta.delete(toldKey(consumer));
}

export function sameMark(a: LintToldMark, b: LintToldMark): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
