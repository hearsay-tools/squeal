import type { AbsolutePath } from "../types/common.js";
import { failureOf, gitCall } from "./git.js";
import { EXPORT_NAME } from "./refs.js";

/*
 * Spec 018 D14, `transport.md` Q3: one `git fetch` of one results ref, with
 * no destination, then the export read from the fetched commit. Nothing is
 * written to the user's config, refs or `FETCH_HEAD`, and no maintenance
 * runs; the objects stay unreachable until git's own `gc` prunes them.
 */

export interface FetchCall {
  readonly timeoutMs: number;
  readonly env: Readonly<Record<string, string>>;
  /** The owner's stop: no git starts after it, and the one running is killed. */
  readonly signal?: AbortSignal;
}

export type Fetched = Buffer | { readonly failed: string; readonly timedOut: boolean };

/**
 * The export of `ref` on `remote`, whose results commit `ls-remote` named as
 * `oid`. A ref moved between the listing and the fetch reads nothing, and
 * the next start point tries again.
 */
export async function fetchExport(
  root: AbsolutePath,
  remote: string,
  ref: string,
  oid: string,
  call: FetchCall,
): Promise<Fetched> {
  const fetched = await gitCall(
    root,
    [
      "fetch",
      "--quiet",
      "--no-write-fetch-head",
      "--no-auto-maintenance",
      "--no-tags",
      "--no-recurse-submodules",
      "--no-prune",
      // An empty refmap: the user's configured refspecs update no remote-tracking ref.
      "--refmap=",
      remote,
      ref,
    ],
    call,
  );
  if (fetched.code !== 0) {
    return { failed: failureOf(fetched, call.timeoutMs), timedOut: fetched.timedOut };
  }
  const blob = await gitCall(root, ["cat-file", "blob", `${oid}:${EXPORT_NAME}`], {
    timeoutMs: call.timeoutMs,
    ...(call.signal === undefined ? {} : { signal: call.signal }),
  });
  if (blob.code === 0) return blob.stdout;
  return { failed: `${ref} holds no ${EXPORT_NAME} at ${oid.slice(0, 8)}`, timedOut: false };
}
