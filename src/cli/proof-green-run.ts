import type { KeyedFile } from "../core/commit/at-keys-checkout.js";
import { resultsAt, withStores } from "../core/commit/at-keys-checkout.js";
import { testFileId } from "../core/keys/reverse-index.js";
import { NOT_RUN_BUDGET } from "../core/proof/verdict.js";
import type { CommitAskState } from "../core/types/commit-ask.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { CheckKey } from "../core/types/keys.js";
import type { ResultRecord, TestFileKeyRecord } from "../core/types/store-records.js";
import { liveRows } from "./proof-green-rows.js";
import { endOfRecords } from "./proof-run.js";
import type { SideFile } from "./proof-side.js";
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
  await withStores(input.commonDir, async (main) => {
    const rows = liveRows(
      main,
      tree,
      toRun.map((f) => f.ref),
    );
    for (const file of toRun) {
      const id = testFileId(file.ref);
      const results = (key: CheckKey) => (main === null ? [] : resultsAt(main, file.ref, key));
      out.set(id, sideOf(own, rows.get(id), refusals.get(id), queued.has(id), results));
    }
  });
  return out;
}

/** One file's side after the wait: its result at its live key, or why it has none. */
function sideOf(
  own: CommitAskState,
  row: TestFileKeyRecord | undefined,
  refused: string | undefined,
  queued: boolean,
  results: (key: CheckKey) => readonly ResultRecord[],
): SideFile {
  if (refused !== undefined) return unknown(refused);
  if (row === undefined) return unknown("its commit daemon no longer lists it");
  if (row.key === null) return unknown("its commit daemon could not key it");
  const records = results(row.key);
  if (records.length > 0)
    return {
      end: endOfRecords(records),
      from: queued ? "run" : "store",
      stored: true,
      notStored: null,
      runs: queued ? 1 : 0,
    };
  if (own.phase !== "queued" || (row.pending !== null && row.pending !== undefined))
    return unknown(NOT_RUN_BUDGET);
  return unknown("its commit daemon kept no result for it");
}

function unknown(reason: string): SideFile {
  return { end: { end: "unknown", reason }, from: null, stored: false, notStored: null, runs: 0 };
}
