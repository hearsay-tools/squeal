import type { Leaf, Shape } from "./config-file.js";

/*
 * Spec 018 D14: the `shared` key of the policy loader. A project opts in to
 * fetching CI's results by naming the ref prefix its CI publishes under
 * (decision filter 5); a wrong value is one problem and the default, `null`,
 * applies (001 D11). Row 018-70: `lookAgain`, how often and how long the
 * reader lists the remote again while the start point's export is missing.
 */

/** Prefixes a clone fetches or shows by default: an export there would reach every developer. */
const RESERVED = ["refs/heads", "refs/tags", "refs/remotes"];

/** A component of a ref name git accepts, without wildcards (git-check-ref-format(1)). */
const COMPONENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/** Whether `prefix` names refs `<prefix>/<sha>` outside what a clone fetches. */
export function isSharedRef(prefix: string): boolean {
  const parts = prefix.split("/");
  if (parts[0] !== "refs" || parts.length < 2) return false;
  if (RESERVED.some((r) => prefix === r || prefix.startsWith(`${r}/`))) return false;
  return parts
    .slice(1)
    .every((p) => COMPONENT.test(p) && !p.includes("..") && !p.endsWith(".lock"));
}

const ref: Leaf = (v) =>
  v === null || (typeof v === "string" && isSharedRef(v))
    ? null
    : 'a ref prefix outside refs/heads, refs/tags and refs/remotes, such as "refs/squeal", or null';

/**
 * Review 0.1.588 S1: the longest wait Node's timers take, 2^31 - 1 ms, in
 * whole seconds. A longer delay would fire after 1 ms.
 */
export const MAX_LOOK_AGAIN_SECONDS = 2_147_483;

/** A whole number of seconds from `min` up to `MAX_LOOK_AGAIN_SECONDS`. */
const seconds =
  (min: 0 | 1): Leaf =>
  (v) =>
    Number.isInteger(v) && (v as number) >= min && (v as number) <= MAX_LOOK_AGAIN_SECONDS
      ? null
      : `a whole number from ${min} to ${MAX_LOOK_AGAIN_SECONDS}`;

/** The section's keys, spread into the loader's shape. */
export const SHARED_SHAPE: Shape = {
  shared: { ref, lookAgain: { everySeconds: seconds(1), forSeconds: seconds(0) } },
};
