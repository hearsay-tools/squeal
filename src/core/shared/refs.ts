import type { AbsolutePath } from "../types/common.js";
import { type GitAnswer, gitCall } from "./git.js";

/*
 * Spec 018 D13, D14: one ref per main commit, `<prefix>/<sha>`, each a
 * parentless commit whose tree holds the export as one file.
 */

/** The export's name in a results commit's tree. */
export const EXPORT_NAME = "squeal-results.json.gz";

/** The prefix `squeal ci publish` writes under when the project sets no `shared.ref`. */
export const DEFAULT_SHARED_REF = "refs/squeal";

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** Whether `text` is a full commit id (SHA-1 or SHA-256). */
export function isSha(text: string): boolean {
  return SHA.test(text);
}

/** The ref of `commit`'s export under `prefix`. */
export function refOf(prefix: string, commit: string): string {
  return `${prefix}/${commit}`;
}

/** The remote's results refs: by main commit, the results commit it points at. */
export type RemoteExports = ReadonlyMap<string, string>;

/**
 * `git ls-remote <remote> '<prefix>/*'`: every results ref the remote holds,
 * or git's answer when it failed. A ref whose last part is not a commit id
 * is not one of ours and is left out.
 */
export async function remoteExports(
  root: AbsolutePath,
  remote: string,
  prefix: string,
  call: { readonly timeoutMs: number; readonly env: Readonly<Record<string, string>> },
  started?: Parameters<typeof gitCall>[2]["started"],
): Promise<RemoteExports | GitAnswer> {
  const answer = await gitCall(root, ["ls-remote", remote, `${prefix}/*`], {
    ...call,
    ...(started === undefined ? {} : { started }),
  });
  if (answer.code !== 0) return answer;
  const exports = new Map<string, string>();
  for (const line of answer.stdout.toString("utf8").split("\n")) {
    const [oid, ref] = line.split("\t");
    if (oid === undefined || ref === undefined || !ref.startsWith(`${prefix}/`)) continue;
    const commit = ref.slice(prefix.length + 1);
    if (isSha(commit) && isSha(oid)) exports.set(commit, oid);
  }
  return exports;
}
