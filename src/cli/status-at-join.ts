import { withStores } from "../core/commit/at-keys-checkout.js";
import { selects } from "../core/commit/at-keys-narrow.js";
import { readPolicy } from "../core/daemon/policy.js";
import { NARROW_NOT_SUPPORTED } from "../core/daemon/run-group.js";
import { testFileId } from "../core/keys/reverse-index.js";
import { groupView } from "../core/scheduler/slow.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { DaemonResponse, RecordedRequest } from "../core/types/daemon.js";
import type { TestFileRef } from "../core/types/keys.js";
import { takenRequest } from "./run-group.js";
import { idOf } from "./status-at-after.js";
import type { Asked, AtDaemons, CommitDaemonInput } from "./status-at-daemons.js";
import { NOTHING, type SideQueue } from "./status-at-queue.js";
import type { SideState } from "./status-at-report.js";
import { askWithin } from "./wait/socket.js";

/*
 * Spec 023 D7.3 (row 023-40; research `run-wait-model.md` Q7, replacing
 * T5's refusal): `status --at <commit> --wait` without `--run` joins the
 * work already queued, on both sides, and starts none. Review wave-23 B2:
 * work is queued from the moment a daemon recorded the narrow request, also
 * while its startup or a listing keeps the scheduler from taking it, and
 * no file row says so yet. So each side's daemon is asked which requests
 * it recorded (`PingResponse.recorded`); a request whose paths select a
 * file of the call is joined until it is taken, failed or gone, then its
 * files are joined as the files the daemon lists pending are. One still
 * recorded at the deadline keeps its files queued. No commit worktree, or
 * none for this environment: nothing to join at the commit.
 */

/**
 * Review wave-23 B2: what `AtDaemons` adds for the join. Optional, so a
 * stand-in without them lists no recorded request.
 */
export interface RecordedJoins {
  /**
   * The narrow requests the daemon of `root` recorded and has not taken;
   * none when none answers by `deadline` (the call's, review wave-23 B1).
   */
  recorded?(root: AbsolutePath, deadline: number): Promise<readonly RecordedRequest[]>;
  /** Joins recorded `request` until taken, failed (why) or `deadline` (`pending`). */
  joinRequest?(root: AbsolutePath, request: RecordedRequest, deadline: number): Promise<Asked>;
}

export interface JoinInput {
  readonly daemons: AtDaemons;
  readonly commit: CommitDaemonInput;
  readonly refs: readonly TestFileRef[];
  /** The commit side as the call keyed it. */
  readonly at: (ref: TestFileRef) => SideState;
  /** The working tree's side as listed at the call's start. */
  readonly now: (ref: TestFileRef) => SideState;
  /** The user's worktree: its daemon is the working tree's side. */
  readonly root: AbsolutePath;
  readonly commonDir: AbsolutePath;
  /** Epoch ms; `Infinity` for a bare `--wait`. The call's one deadline (B1). */
  readonly deadline: number;
  /**
   * Review wave-23 B1: the bound of the join's daemon reads, as of `--run`'s
   * requests (`askBound`): the deadline, or a few seconds after the first.
   */
  readonly askBy: () => number;
}

/** Both sides joined, commit side first. */
export async function joinBoth(input: JoinInput): Promise<[SideQueue, SideQueue]> {
  const { daemons, refs } = input;
  const bounds = { deadline: input.deadline, askBy: input.askBy };
  const atSide = async (): Promise<SideQueue> => {
    const tree = daemons.find(input.commit);
    if (tree === null) return NOTHING;
    const listed = await pendingRows(input.commonDir, tree);
    const without = refs.filter((ref) => input.at(ref).state === "no result");
    return joinSide(daemons, tree, without, (ref) => listed.has(testFileId(ref)), bounds);
  };
  const without = refs.filter((ref) => input.now(ref).state === "no result");
  const pendingNow = (ref: TestFileRef) => {
    const s = input.now(ref);
    return s.state === "no result" && s.pending !== undefined;
  };
  return Promise.all([atSide(), joinSide(daemons, input.root, without, pendingNow, bounds)]);
}

/**
 * One side: of `without` (the call's files with no result there), the ones
 * the daemon lists pending and the ones a recorded request selects; each
 * such request joined until taken, then the wait over the files.
 */
async function joinSide(
  daemons: AtDaemons,
  root: AbsolutePath,
  without: readonly TestFileRef[],
  listed: (ref: TestFileRef) => boolean,
  { deadline, askBy }: Pick<JoinInput, "deadline" | "askBy">,
): Promise<SideQueue> {
  if (without.length === 0) return NOTHING;
  // Review wave-23 B1: the ping and the requests' joins end with the call's requests, as `--run`'s.
  const recorded = (await daemons.recorded?.(root, askBy()).catch(() => [])) ?? [];
  const view = groupView(readPolicy(root));
  const groupOf = (ref: TestFileRef) => view.of(ref).name;
  const covers = (request: RecordedRequest, ref: TestFileRef) =>
    groupOf(ref) === request.group && selects(request.paths, ref.path);
  const joined = recorded.filter((request) => without.some((ref) => covers(request, ref)));
  const files = without.filter((ref) => listed(ref) || joined.some((r) => covers(r, ref)));
  if (files.length === 0) return NOTHING;
  const outcomes = await Promise.all(
    joined.map(async (request) => ({
      request,
      asked:
        daemons.joinRequest === undefined
          ? ("taken" as const)
          : await daemons.joinRequest(root, request, askBy()).catch(problemOf),
    })),
  );
  const pending = new Set<string>();
  const problems: string[] = [];
  for (const { request, asked } of outcomes) {
    if (asked === "pending")
      for (const ref of files) if (covers(request, ref)) pending.add(testFileId(ref));
    if (typeof asked === "object") problems.push(`group ${request.group}: ${asked.problem}`);
  }
  const waited = files.filter((ref) => !pending.has(testFileId(ref)));
  if (waited.length > 0) {
    const ended = await daemons
      .wait(root, waited, deadline)
      .catch((error: unknown) => String(error));
    if (ended !== null) problems.push(ended);
  }
  return { root, files, pending, problems, groupOf };
}

/** The files the daemon of `tree` lists pending in the store. */
async function pendingRows(commonDir: AbsolutePath, tree: AbsolutePath): Promise<Set<string>> {
  const id = idOf(tree);
  return withStores(commonDir, async (main) => {
    const rows = main?.testFileKeys.list(id) ?? [];
    return new Set(
      rows.filter((row) => row.pending !== null).map((row) => testFileId(row.testFile)),
    );
  });
}

const problemOf = (error: unknown): Asked => ({ problem: String(error) });

/**
 * Review wave-23 B2: the narrow requests the daemon on `socketPath`
 * recorded and has not taken; none when none answers. Review wave-23 B1:
 * the ping waits what is left before `deadline` (`askWithin`), never the
 * CLI's whole socket bound.
 */
export async function recordedAt(
  socketPath: AbsolutePath,
  deadline: number,
): Promise<readonly RecordedRequest[]> {
  const answer = await askWithin(socketPath, { type: "ping" }, deadline);
  if (answer === null || "unanswered" in answer) return [];
  return answer.ok && answer.type === "ping" ? (answer.recorded ?? []) : [];
}

/**
 * Review wave-23 B2: joins recorded `request` on `socketPath`, as `run
 * <group> --wait` follows its own request, until the scheduler took it
 * (`taken`), failed it (why), or `deadline` (`pending`). A request the
 * daemon no longer remembers is taken as done: its files' rows say the rest.
 */
export async function joinRequestAt(
  socketPath: AbsolutePath,
  request: RecordedRequest,
  deadline: number,
): Promise<Asked> {
  const ask = { type: "run-group-status", requestId: request.requestId } as const;
  const first: DaemonResponse | null | { unanswered: string } = await askWithin(
    socketPath,
    ask,
    deadline,
  );
  if (first === null) return { problem: "no daemon answered" };
  if ("unanswered" in first) return { problem: `the daemon did not answer${first.unanswered}` };
  if (!first.ok) return "taken";
  const taken = await takenRequest(
    socketPath,
    first,
    deadline,
    request.group,
    NARROW_NOT_SUPPORTED,
  );
  if (typeof taken === "string") return { problem: taken };
  return "pending" in taken ? "pending" : "taken";
}
