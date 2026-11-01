import type { Comparison } from "./compare.js";

/*
 * The raises of `KEY_FORMAT_VERSION` the human approved with no case whose
 * outputs differ (011 C3, task 011-37 D6 as amended for row 011-105), each
 * with the decision. D6 keeps a raise from being the cheap way past a
 * coverage gap: a raise re-runs every project once. A recorded raise costs
 * only re-runs the human accepted. It must still empty
 * `KEY_FORMATS_READ_AS_ONE` (risk 6), and a raised, emptied format reads no
 * stored key, so no changed line can reuse a result.
 */
export const APPROVED_RAISES: Readonly<Record<number, string>> = {
  21: 'the human, 2026-10-31, decision card "Key change: All three now": rows 011-60, 011-270 and 011-105',
};

/** What a comparison's format raise allows its components (row 011-105). */
export interface Raise {
  /** The format's raise is in the record: it needs no differing case. */
  readonly approved: boolean;
  /** The format moved and reads no earlier one: no component is held to its changed lines. */
  readonly emptied: boolean;
}

/** The format raise of `c`, read against `approved`. */
export function raiseOf(c: Comparison, approved: Readonly<Record<number, string>>): Raise {
  const format = c.alarms.find((a) => a.component.name === "global")?.versions;
  // Only a higher format reads no stored key (review 0.1.388 S1): a move down could reach keys
  // an earlier release stored, so it is no raise and earns no exemption.
  if (format === undefined || !(Number(format.candidate) > Number(format.baseline))) {
    return { approved: false, emptied: false };
  }
  return {
    approved: approved[Number(format.candidate)] !== undefined,
    emptied: c.readAsOne.length === 0,
  };
}
