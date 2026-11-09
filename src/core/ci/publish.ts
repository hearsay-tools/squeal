import { failureOf, gitCall, networkEnv, textOf } from "../shared/git.js";
import { EXPORT_NAME, refOf, remoteExports } from "../shared/refs.js";
import { sourceLabel } from "../store/imports.js";
import { decodeBundle } from "../store/transfer-bundle.js";
import type { AbsolutePath } from "../types/common.js";

/*
 * Spec 018 D13: `squeal ci publish`. One ref per main commit,
 * `<prefix>/<sha>`, so writers never conflict; it points at a parentless
 * commit whose tree holds the export as it is (`transport.md` 1). The same
 * push deletes the refs of main commits beyond the newest `keep`
 * (`transport.md` 2).
 */

/** Local git work: objects and the history walk. */
const LOCAL_TIMEOUT_MS = 30_000;
/** A push of about 2 MB, or a listing, from a CI runner. */
export const PUBLISH_NETWORK_TIMEOUT_MS = 120_000;
/** First-parent commits walked to place the remote's refs. */
const WALK_LIMIT = 100_000;

/** Squeal's own identity on the results commit, which holds no project file. */
const IDENTITY = { name: "Squeal", email: "squeal@invalid" };

export interface PublishInput {
  /** A checkout that holds the export's commit and its first-parent history. */
  readonly root: AbsolutePath;
  /** The export file (`squeal ci export`). */
  readonly bytes: Buffer;
  /** Main commits whose refs stay, the export's own included; at least 1. */
  readonly keep: number;
  readonly remote: string;
  /** `shared.ref`, for example `refs/squeal`. */
  readonly prefix: string;
  readonly networkTimeoutMs?: number;
}

export interface Published {
  readonly ref: string;
  /** The results commit the ref points at. */
  readonly result: string;
  /** Main commits whose refs this push deleted, newest first. */
  readonly deleted: readonly string[];
  /** Main commits whose refs the remote refused to delete. */
  readonly failed: readonly string[];
  /** Refs kept because this checkout cannot place their commit on the first-parent line. */
  readonly unplaced: number;
  /** This checkout is shallow, so older refs may be among `unplaced`. */
  readonly shallow: boolean;
}

export type PublishOutcome = Published | { readonly refused: string };

/** Publishes `input.bytes` for its header's commit; never throws. */
export async function publishExport(input: PublishInput): Promise<PublishOutcome> {
  const { root, prefix, remote } = input;
  const bundle = decodeBundle(input.bytes);
  if (typeof bundle === "string") return { refused: bundle };
  const commit = bundle.header.commit;
  if (commit === null) return { refused: "the export names no commit (an unborn HEAD)" };
  const local = (args: readonly string[], input?: Buffer | string) =>
    gitCall(root, args, { timeoutMs: LOCAL_TIMEOUT_MS, ...(input === undefined ? {} : { input }) });
  if ((await local(["cat-file", "-e", `${commit}^{commit}`])).code !== 0) {
    return {
      refused: `this checkout does not hold commit ${commit}; publish from a checkout of it`,
    };
  }
  const result = await resultCommit(root, input.bytes, commit, bundle.header);
  if (typeof result !== "string") return result;

  const timeoutMs = input.networkTimeoutMs ?? PUBLISH_NETWORK_TIMEOUT_MS;
  const env = await networkEnv(root);
  const existing = await remoteExports(root, remote, prefix, { timeoutMs, env });
  if ("timedOut" in existing) {
    return { refused: `cannot list ${remote}'s results refs: ${failureOf(existing, timeoutMs)}` };
  }
  const line = textOf(
    await local(["rev-list", "--first-parent", `--max-count=${WALK_LIMIT}`, commit]),
  );
  const position = new Map((line ?? "").split("\n").map((sha, i) => [sha, i] as const));
  const deleted: string[] = [];
  let unplaced = 0;
  for (const sha of existing.keys()) {
    const at = position.get(sha);
    if (at === undefined) unplaced += 1;
    else if (at >= input.keep) deleted.push(sha);
  }
  deleted.sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));

  const ref = refOf(prefix, commit);
  const push = await gitCall(
    root,
    [
      "push",
      "--porcelain",
      "--no-verify",
      remote,
      `+${result}:${ref}`,
      ...deleted.map((sha) => `:${refOf(prefix, sha)}`),
    ],
    { timeoutMs, env },
  );
  const updates = porcelain(push.stdout.toString("utf8"));
  if (!updates.get(ref)) return { refused: `cannot push ${ref}: ${failureOf(push, timeoutMs)}` };
  const shallow = textOf(await local(["rev-parse", "--is-shallow-repository"])) === "true";
  return {
    ref,
    result,
    deleted: deleted.filter((sha) => updates.get(refOf(prefix, sha)) === true),
    failed: deleted.filter((sha) => updates.get(refOf(prefix, sha)) !== true),
    unplaced,
    shallow,
  };
}

/**
 * The results commit: the export as one blob in a tree, no parent, Squeal's
 * identity, and the export's creation time, so the same export makes the
 * same commit.
 */
async function resultCommit(
  root: AbsolutePath,
  bytes: Buffer,
  commit: string,
  header: Parameters<typeof sourceLabel>[0],
): Promise<string | { readonly refused: string }> {
  const call = (args: readonly string[], input: Buffer | string, env = {}) =>
    gitCall(root, args, { timeoutMs: LOCAL_TIMEOUT_MS, input, env });
  const blob = await call(["hash-object", "-w", "--stdin"], bytes);
  const blobId = textOf(blob);
  if (blobId === null) return { refused: `cannot store the export: ${failureOf(blob, 0)}` };
  const tree = await call(["mktree"], `100644 blob ${blobId}\t${EXPORT_NAME}\n`);
  const treeId = textOf(tree);
  if (treeId === null) return { refused: `cannot store the export: ${failureOf(tree, 0)}` };
  const date = `${Math.floor(header.createdAt / 1000)} +0000`;
  const made = await call(
    ["commit-tree", "--no-gpg-sign", treeId],
    `Squeal results for ${commit}\n\n${sourceLabel(header)}\n`,
    {
      GIT_AUTHOR_NAME: IDENTITY.name,
      GIT_AUTHOR_EMAIL: IDENTITY.email,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: IDENTITY.name,
      GIT_COMMITTER_EMAIL: IDENTITY.email,
      GIT_COMMITTER_DATE: date,
    },
  );
  const madeId = textOf(made);
  return madeId === null ? { refused: `cannot store the export: ${failureOf(made, 0)}` } : madeId;
}

/**
 * `git push --porcelain`'s lines, by remote ref: whether its update took.
 * A line is `<flag> TAB <from>:<to> TAB <summary>`; `!` is a rejection.
 */
function porcelain(stdout: string): Map<string, boolean> {
  const updates = new Map<string, boolean>();
  for (const line of stdout.split("\n")) {
    const [flag, refs] = line.split("\t");
    if (flag === undefined || refs === undefined || flag.length !== 1) continue;
    const to = refs.slice(refs.indexOf(":") + 1);
    updates.set(to, flag !== "!");
  }
  return updates;
}
