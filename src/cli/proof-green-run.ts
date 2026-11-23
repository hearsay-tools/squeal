import type { KeyedFile } from "../core/commit/at-keys-checkout.js";
import { resultsAt, withStores } from "../core/commit/at-keys-checkout.js";
import { testFileId } from "../core/keys/reverse-index.js";
import { NOT_RUN_BUDGET } from "../core/proof/verdict.js";
import type { CommitAskState } from "../core/types/commit-ask.js";
import type { AbsolutePath, WorktreeId } from "../core/types/common.js";
import type { CheckKey } from "../core/types/keys.js";
import type { ResultRecord, TestFileKeyRecord } from "../core/types/store-records.js";
import { liveRows } from "./proof-green-rows.js";
import { endOfRecords } from "./proof-run.js";
import type { SideFile } from "./proof-side.js";
import { idOf } from "./status-at-after.js";
import { readUntilQueued } from "./status-at-commit-ask.js";
import type { AtDaemons } from "./status-at-daemons.js";
import { keptAlive } from "./status-at-now-ask.js";

/*
 * Spec 023 D7.6 (row 023-42): the green side's runs on the commit daemon
 * at HEAD. One `commit-ask` names the files' own paths with no change, so
 * the daemon runs those with no result at their live key first, and only
 * those. The call sends it once D5.2 admits the files (the stop and the
 * case are decided; a stopped proof asks nothing, review 0.1.597 B2), and
 * before the red side runs (`askGreen`): a red run whose test rewrote an input its key
 * did not cover yet can be kept at the key HEAD's file has before its
 * first run, and a daemon asked after it would read that result as the
 * green side's (`proof-mutated.test.ts`). It is read only when the red
 * side decides (`readGreen`): the call waits for its files, then reads
 * each at its live key again, so a run that observed new inputs is read
 * at the key it completed at. All by the proof's deadline: a file still
 * queued or running then reads `not run (budget)`, and its run goes on in
 * the daemon, where the rerun reads it.
 */

export interface RunInput {
  readonly daemons: AtDaemons;
  /** The user's worktree: an input generated there counts as one git does not hold (D4.9). */
  readonly root: AbsolutePath;
  /** The commit daemon's worktree. */
  readonly tree: AbsolutePath;
  readonly commonDir: AbsolutePath;
  /** Epoch ms when the proof's budget ends. */
  readonly by: number;
  /** The commit, short, for the reasons. */
  readonly at: string;
}

/** The green ask as the daemon kept it, or why every file of it reads unknown. */
export type GreenAsk = { readonly own: CommitAskState } | { readonly side: SideFile };

/** D7.6: one ask of `toRun`'s own paths, read back until the daemon queued it or `by`. */
export async function askGreen(
  input: RunInput,
  toRun: readonly KeyedFile[],
  owner: string,
): Promise<GreenAsk> {
  const { daemons, tree, by, at } = input;
  if (Date.now() >= by) return { side: unknown(NOT_RUN_BUDGET) };
  const named = [...new Set(toRun.map((f) => f.ref.path))].sort();
  const ask = { owner, changed: [], named, allMissing: false, root: input.root };
  const refused = await keptAlive(daemons.commitAsk(tree, ask, by)).catch(String);
  if (refused !== null)
    return { side: unknown(`its commit daemon at ${at} took no run: ${refused}`) };
  const read = await keptAlive(readUntilQueued(daemons, tree, [owner], by, by));
  const own = read.asks.find((a) => a.owner === owner);
  if (own === undefined)
    return { side: unknown(read.problem ?? `its commit daemon at ${at} kept no ask`) };
  if (own.phase === "failed")
    return { side: unknown(own.text ?? "the commit daemon's ask failed") };
  return { own };
}

/** Each of `toRun`'s green side, by `testFileId`, once the daemon ran what `asked` queued or `by`. */
export async function readGreen(
  input: RunInput,
  asked: GreenAsk,
  toRun: readonly KeyedFile[],
  owner: string,
): Promise<Map<string, SideFile>> {
  const { daemons, tree, by } = input;
  const out = new Map<string, SideFile>();
  if ("side" in asked) {
    for (const file of toRun) out.set(testFileId(file.ref), asked.side);
    return out;
  }
  // The ask as it stands now: one still waiting for the setup or selecting is read again.
  const own =
    asked.own.phase === "queued"
      ? asked.own
      : ((await keptAlive(readUntilQueued(daemons, tree, [owner], by, by))).asks.find(
          (a) => a.owner === owner,
        ) ?? asked.own);
  const ids = new Set(toRun.map((f) => testFileId(f.ref)));
  const mine = own.files.filter((ref) => ids.has(testFileId(ref)));
  if (own.phase === "queued" && mine.length > 0)
    await keptAlive(daemons.wait(tree, mine, by)).catch(String);
  const queued = new Set(own.files.map(testFileId));
  const refusals = new Map((own.refused ?? []).map((r) => [testFileId(r.ref), r.reason]));
  // Review 0.1.611 B1 (row 023-70): a file that lists a folder holds only the commit worktree's result.
  const ownOnly = new Map((own.ownOnly ?? []).map((r) => [testFileId(r.ref), r.reason]));
  const treeId = idOf(tree);
  await withStores(input.commonDir, async (main) => {
    const rows = liveRows(
      main,
      tree,
      toRun.map((f) => f.ref),
    );
    for (const file of toRun) {
      const id = testFileId(file.ref);
      const results = (key: CheckKey) => (main === null ? [] : resultsAt(main, file.ref, key));
      out.set(
        id,
        sideOf(own, rows.get(id), results, {
          refused: refusals.get(id),
          queued: queued.has(id),
          ownOnly: ownOnly.get(id),
          treeId,
        }),
      );
    }
  });
  return out;
}

/** What the ask and the commit daemon say of one file. */
interface FileFacts {
  /** D4.9: why the daemon does not run it; `undefined`: it does. */
  readonly refused: string | undefined;
  /** The ask queued it: it had no result at selection. */
  readonly queued: boolean;
  /** Review 0.1.611 B1: why another worktree's result is not the commit's; `undefined`: any is. */
  readonly ownOnly: string | undefined;
  /** The commit daemon's worktree, the writer of its own results. */
  readonly treeId: WorktreeId;
}

/** One file's side after the wait: its result at its live key, or why it has none. */
function sideOf(
  own: CommitAskState,
  row: TestFileKeyRecord | undefined,
  results: (key: CheckKey) => readonly ResultRecord[],
  facts: FileFacts,
): SideFile {
  if (facts.refused !== undefined) return unknown(facts.refused);
  if (row === undefined) return unknown("its commit daemon no longer lists it");
  if (row.key === null) return unknown("its commit daemon could not key it");
  const all = results(row.key);
  const mine = all.filter((r) => r.provenance.worktreeId === facts.treeId);
  if (facts.ownOnly !== undefined && mine.length === 0 && all.length > 0)
    return unknown(facts.ownOnly);
  const records = facts.ownOnly === undefined ? all : mine;
  // Review 0.1.611 B1: a queued file ran here only when the commit worktree wrote its result;
  // another worktree's result at the shared key is read from the store.
  const ran = facts.queued && mine.length > 0;
  if (records.length > 0)
    return {
      end: endOfRecords(records),
      from: ran ? "run" : "store",
      stored: true,
      notStored: null,
      runs: ran ? 1 : 0,
    };
  if (own.phase !== "queued" || (row.pending !== null && row.pending !== undefined))
    return unknown(NOT_RUN_BUDGET);
  return unknown("its commit daemon kept no result for it");
}

function unknown(reason: string): SideFile {
  return { end: { end: "unknown", reason }, from: null, stored: false, notStored: null, runs: 0 };
}
