import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  InputCheck,
  type Kept,
  type KeepWriter,
  keepFile,
  StoreWait,
  type Tried,
} from "../../../../../../src/core/code/gate/keep-write.js";
import type { AbsolutePath, EpochMs } from "../../../../../../src/core/types/common.js";
import type { CheckKey, TestFileRef } from "../../../../../../src/core/types/keys.js";

/*
 * Throwaway research probe for #220. Deterministic: a fake clock and a fake
 * writer, no store, no daemon, no runner. It drives the real `keepFile`,
 * `sliced` and `StoreWait` of the keeper's last pass (D17.5) the way
 * `writeQueued` in keep-pass.ts drives them: one StoreWait for the pass,
 * `giveUp` asked after every busy refusal with the files still to write.
 *
 * Question: is the 30 s bound "30 s with no write landing", or "30 s from
 * the first refusal, whatever lands after it"?
 */

const DB = "/tmp/issue-220-probe/store.sqlite" as AbsolutePath;
const databases = { main: DB, code: DB };
const BOUND_MS = 30_000;

function fileAt(i: number): Kept {
  const ref = { project: "", path: `test/f${i}.test.ts` } as unknown as TestFileRef;
  return {
    ref,
    key: `key-${i}` as unknown as CheckKey,
    paths: [],
    record: {} as Kept["record"],
  };
}

const report = {
  end: "completed",
  durationMs: 0,
  completedFiles: [],
  results: [],
  fileErrors: [],
  failure: null,
} as never;
const store = { results: { newestForTestFile: () => [] } } as never;
const provenance = {} as never;

/**
 * Each file's first coverage try is refused (another writer holds the lock
 * for that slice), its second lands; its results write lands at once. Each
 * refused try costs `refusedMs` of the fake clock (a busy slice), each
 * landed write `landedMs`.
 */
async function lastPass(files: number, refusedMs: number, landedMs: number) {
  let clock = 0;
  const now = () => clock as EpochMs;
  const lines: string[] = [];
  const wait = new StoreWait({ now, boundMs: BOUND_MS, tell: (t) => lines.push(t) });
  const all = Array.from({ length: files }, (_, i) => fileAt(i));
  const tries = new Map<string, number>();
  const writer: KeepWriter = {
    coverage: async (file): Promise<Tried> => {
      const n = (tries.get(file.ref.path) ?? 0) + 1;
      tries.set(file.ref.path, n);
      if (n === 1) {
        clock += refusedMs;
        return "busy";
      }
      clock += landedMs;
      return "kept";
    },
    results: async (): Promise<Tried> => {
      clock += landedMs;
      return "kept";
    },
  };
  const check = new InputCheck();
  let written = 0;
  let lastWriteAt = 0;
  let spentAt: number | null = null;
  for (const file of all) {
    const outcome = await keepFile(
      { store, keys: {} as never, writer },
      {
        file,
        report,
        provenance,
        databases,
        giveUp: (db) => wait.giveUp(db, all.slice(written)),
        check,
        steady: async () => true,
        unheld: async () => true,
      },
    );
    if (outcome === "spent") {
      spentAt = clock;
      lines.push(wait.spent(files - written, 0).replace(/ \(.*?\)/, ""));
      break;
    }
    written += 1;
    lastWriteAt = clock;
  }
  return { written, spentAt, lastWriteAt, lines };
}

describe("#220: the keeper's 30 s bound", () => {
  it("counts from the first refusal and is never reset by a write that lands", async () => {
    // 340 queued files, as in #220. A refusal costs one 250 ms slice, a landed write 50 ms.
    const r = await lastPass(340, 250, 50);
    const out = process.env.ISSUE220_OUT;
    if (out) appendFileSync(out, `${JSON.stringify({ case: "every second try lands", ...r })}\n`);
    // Every file landed on its second try, so the store was never busy for more than 250 ms
    // at a time, yet the pass stops at the bound and says the store "stayed busy for 30 s".
    expect(r.spentAt).not.toBeNull();
    expect(r.written).toBeLessThan(340);
    expect(r.spentAt! - r.lastWriteAt).toBeLessThanOrEqual(250);
    expect(r.lines.at(-1)).toMatch(/the store stayed busy for 30 s/);
  });
});
