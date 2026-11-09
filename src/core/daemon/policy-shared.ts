import type { Leaf, Shape } from "./config-file.js";

/*
 * Spec 018 D14: the `shared` key of the policy loader. A project opts in to
 * fetching CI's results by naming the ref prefix its CI publishes under
 * (decision filter 5); a wrong value is one problem and the default, `null`,
 * applies (001 D11).
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

/** The section's keys, spread into the loader's shape. */
export const SHARED_SHAPE: Shape = { shared: { ref } };
