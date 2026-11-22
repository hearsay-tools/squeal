import { existsSync } from "node:fs";
import { join } from "node:path";
import { withStores } from "../core/commit/at-keys-checkout.js";
import { testFileId } from "../core/keys/reverse-index.js";
import type { AbsolutePath, RelativePath, WorktreeId } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { AtDaemons } from "./status-at-daemons.js";
import { daemonSide, type NowSide, select, unlisted } from "./status-at-now.js";
import { SYNC_POLL_MS, syncDaemon } from "./status-sync.js";

/*
 * Spec 023 D7.3 as amended 2026-11-22 (the human after review
 * wave-23-third B1, "Ask the daemon"): with `--run` or `--wait` the call
 * computes no keys for the working tree. It starts this worktree's daemon
 * when none runs (never over the user's stop or a command hold, review
 * wave-23 S1) and asks it a `sync`, as `squeal status --wait` does: the
 * daemon reconciles and answers with the revision it stored, and the readers
 * of each named path in its key index. The side is then the daemon's own
 * rows at that revision (its keys and states) and the results at those keys.
 * Each step ends by the call's bound. A daemon that has not answered by then
 * still starts or loads its configuration: the side reads "still setting
 * up", and no keying runs in the call.
 */

/** What this worktree's daemon gave the call. */
export type NowAsked =
  /** It answered its `sync`: its rows hold its keys at `revision`. */
  | {
      readonly kind: "read";
      readonly revision: number;
      readonly readers?: ReadonlyMap<RelativePath, readonly TestFileRef[]> | undefined;
    }
  /** The call's bound came first: the daemon still starts or loads its configuration. */
  | { readonly kind: "setting up" }
  /** No daemon serves: `problem` says why (stopped, held, its start failed). */
  | { readonly kind: "unserved"; readonly problem: string };

/** Why a side not read gives no answer, as the queue line names it. */
export const SETTING_UP =
  "the call's wait ended while this worktree's daemon set up (it starts or loads its configuration)";

/**
 * Awaits `pending` with a ref'd timer held, so the process lives until it
 * settles: `syncDaemon` polls a pending answer on unref'd sleeps, and with
 * nothing else ref'd a `status --at` call exited 13 ("unsettled top-level
 * await") with no output (`tasks/023-40d-measure.md`: 4 of 16 second calls).
 */
export async function keptAlive<T>(pending: Promise<T>): Promise<T> {
  const keep = setInterval(() => {}, 60_000);
  try {
    return await pending;
  } finally {
    clearInterval(keep);
  }
}

/**
 * The real `AtDaemons.now`: one `sync` of the daemon of `root`, with the
 * named paths for their readers, polled until it answers or `deadline`
 * (epoch ms; `Infinity` for a bare `--wait`). A request on the wire is cut
 * at the deadline (`syncDaemon`'s socket timeouts), so the call is not held.
 */
export async function askNow(
  root: AbsolutePath,
  paths: readonly RelativePath[],
  deadline: number,
): Promise<NowAsked> {
  const until = performance.now() + Math.max(0, deadline - Date.now());
  const sync = syncDaemon(root, SYNC_POLL_MS, paths, until);
  try {
    if (sync.answered !== undefined) await keptAlive(sync.answered);
  } finally {
    sync.stop();
  }
  const state = sync.current();
  if (state.state === "synced")
    return { kind: "read", revision: state.revision, readers: state.readers };
  if (Date.now() >= deadline) return { kind: "setting up" };
  return {
    kind: "unserved",
    problem: "this worktree's daemon gave no state (it stopped, or its start failed)",
  };
}

/** Where the working tree's side is read. */
export interface NowPlace {
  readonly daemons: AtDaemons;
  readonly root: AbsolutePath;
  readonly commonDir: AbsolutePath;
  readonly worktreeId: WorktreeId;
  /** The paths that narrow the test files; `null` for every file. */
  readonly paths: readonly RelativePath[] | null;
}

/** The working tree's side and what its daemon gave; `late`: the bound ended the start. */
export interface NowRead {
  readonly side: NowSide;
  readonly asked: NowAsked;
  readonly late: boolean;
}

/** `--wait` alone starts no daemon: what a side with none answering says. */
export const NOT_STARTED =
  "no daemon answers in this worktree, and --wait alone starts none; squeal start starts it";

/**
 * D7.3 as amended 2026-11-22: this worktree's daemon, started when none
 * runs (its waits end by `bound`; with `start` false, `--wait` alone, none
 * is started), then asked; its side read from its rows.
 */
export async function worktreeNow(
  place: NowPlace,
  bound: number,
  start: boolean,
): Promise<NowRead> {
  const { daemons, root } = place;
  if (Date.now() >= bound) return notRead(place, { kind: "setting up" }, true);
  const problem = start ? await daemons.worktree(root, bound) : null;
  if (problem !== null) return notRead(place, { kind: "unserved", problem }, Date.now() >= bound);
  const asked = await daemons.now(root, place.paths ?? [], bound);
  if (asked.kind === "unserved" && !start)
    return notRead(place, { kind: "unserved", problem: NOT_STARTED }, false);
  if (asked.kind !== "read") return notRead(place, asked, asked.kind === "setting up");
  return { side: await readSide(place, asked), asked, late: false };
}

/**
 * The side again once the waits ended: the daemon's rows as they are now
 * (a run that observed new inputs is read at its completed key), when the
 * daemon answered at the start; else the side as it was.
 */
export async function nowAgain(place: NowPlace, first: NowRead): Promise<NowSide> {
  if (first.asked.kind !== "read") return first.side;
  return readSide(place, first.asked);
}

/** The daemon's rows and the results at their keys, read from the store. */
async function readSide(
  place: NowPlace,
  asked: Extract<NowAsked, { kind: "read" }>,
): Promise<NowSide> {
  const { root, worktreeId, paths } = place;
  return withStores(place.commonDir, async (main) => {
    if (main === null) return unknownSide(place, [], "the store cannot be read");
    const rows = main.testFileKeys.list(worktreeId);
    const answered = { revision: asked.revision, readers: asked.readers };
    return daemonSide({ root, worktreeId, paths }, main, rows, answered);
  });
}

/** A side with no answer: its files from the daemon's last stored listing, each still setting up or unknown. */
async function notRead(place: NowPlace, asked: NowAsked, late: boolean): Promise<NowRead> {
  const listed = await withStores(place.commonDir, async (main) =>
    (main?.testFileKeys.list(place.worktreeId) ?? []).map((row) => row.testFile),
  );
  const why = asked.kind === "unserved" ? asked.problem : null;
  return { side: unknownSide(place, listed, why), asked, late };
}

/**
 * `why` `null`: still setting up, each file present `no result (setting
 * up)`; else not determined with `why`. A file the working tree lacks is
 * absent.
 */
function unknownSide(
  place: Pick<NowPlace, "root" | "paths">,
  listed: readonly TestFileRef[],
  why: string | null,
): NowSide {
  const { root } = place;
  const refs = select(listed, place.paths);
  const state = (ref: TestFileRef) => {
    if (!existsSync(join(root, ref.path))) return unlisted(root, ref, "");
    return why === null
      ? { state: "no result" as const, key: "", pending: "setting up" as const }
      : { state: "not determined" as const, reason: why };
  };
  const ids = new Set(refs.map(testFileId));
  return {
    source: why === null ? { kind: "setting up" } : { kind: "unserved", why },
    refs,
    state,
    sources: new Map(),
    unlisted: (ref) => !ids.has(testFileId(ref)),
  };
}
