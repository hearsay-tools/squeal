import type { RelativePath } from "../../types/common.js";
import type { Consumer } from "../../types/delivery.js";
import type { LintCheckId, LintTool } from "../../types/lint.js";
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

/**
 * A lint check as a delivery's maps and the told mark name it (D11): its
 * path for ESLint, so ESLint's marks read and write as before, else its
 * path and tool, apart by a character no path holds.
 */
export type LintCheckName = string;

const SEPARATOR = "\u0000";

export function lintCheckName(check: Pick<LintCheckId, "path" | "tool">): LintCheckName {
  return check.tool === "eslint" ? check.path : `${check.path}${SEPARATOR}${check.tool}`;
}

/** The check `lintCheckName` named. */
export function lintCheckOf(name: LintCheckName): LintCheckId {
  const at = name.indexOf(SEPARATOR);
  if (at < 0) return { kind: "lint", path: name, tool: "eslint" };
  return { kind: "lint", path: name.slice(0, at), tool: name.slice(at + 1) as LintTool };
}

export interface LintToldMark {
  /** The newest transition id the view took in. */
  readonly transition: number;
  /** The last keying (`LintKeying.seq`) whose files the view holds by count; 0 for none. */
  readonly keying: number;
  /**
   * Checks with transitions the view has not taken in: `pending`,
   * `unknown` or a stale `pass` when read. Each with the id its transitions
   * count after. Stored as `[path, id]` for ESLint and `[path, id, tool]`
   * for another tool.
   */
  readonly deferred: readonly (readonly [LintCheckName, number])[];
  /**
   * D9: the pass's counts of failed keyings and of times lint went off
   * (`failuresKey`, `offsKey`) last told, so each failed pass and each off
   * is told once, by the identity the pass records, never by its wording.
   */
  readonly failures: number;
  readonly offs: number;
}

/** A consumer with no mark: one that registered before the store existed or lint was on. */
export const NO_MARK: LintToldMark = {
  transition: 0,
  keying: 0,
  deferred: [],
  failures: 0,
  offs: 0,
};

export const toldKey = (c: Consumer) => `lint-told:${c.worktreeId}:${c.sessionId}:${c.agentId}`;

const count = (value: unknown) => (typeof value === "number" ? value : 0);

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
  const pairs = deferred.flatMap((d): [LintCheckName, number][] => {
    if (!Array.isArray(d) || typeof d[0] !== "string" || typeof d[1] !== "number") return [];
    const tool = typeof d[2] === "string" ? (d[2] as LintTool) : "eslint";
    return [[lintCheckName({ path: d[0], tool }), d[1]]];
  });
  return {
    transition,
    keying,
    deferred: pairs,
    failures: count(value.failures),
    offs: count(value.offs),
  };
}

export function writeTold(meta: LintMetaRepo, consumer: Consumer, mark: LintToldMark): void {
  const deferred = mark.deferred.map(([name, id]): readonly [RelativePath, number, ...string[]] => {
    const { path, tool } = lintCheckOf(name);
    return tool === "eslint" ? [path, id] : [path, id, tool];
  });
  meta.set(toldKey(consumer), JSON.stringify({ ...mark, deferred }));
}

/** Drops `consumer`'s mark: it unregistered. */
export function forgetTold(meta: LintMetaRepo, consumer: Consumer): void {
  meta.delete(toldKey(consumer));
}

/** Whether two marks are one: `null` is no mark. */
export function sameMark(a: LintToldMark | null, b: LintToldMark | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
