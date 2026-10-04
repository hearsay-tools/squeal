import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  isStoreOpenFailure,
  META_STORE_RECOVERED,
  openStore,
  storePaths,
} from "../../src/core/store/index.js";
import { spawnWorker } from "./child/spawn.js";
import { fakeCommonDir, open } from "./helpers.js";

const KILLS = 10;
const ROWS_PER_TX = 50;

describe("store after SIGKILL during writes (spec 001 D8, D12)", () => {
  it(`stays intact and never half-applies a transaction across ${KILLS} kills`, async () => {
    const commonDir = fakeCommonDir();
    open(commonDir).close();

    for (let kill = 0; kill < KILLS; kill++) {
      const crasher = spawnWorker(["crasher", commonDir, String(ROWS_PER_TX)]);
      await crasher.waitFor("committed 10");
      // Land the kill at a different point of the write loop each time.
      await new Promise((resolve) => setTimeout(resolve, 5 + kill * 7));
      crasher.child.kill("SIGKILL");
      const finished = await crasher.done;
      expect(finished.signal).toBe("SIGKILL");
    }

    const raw = new DatabaseSync(storePaths(commonDir).database);
    expect(raw.prepare("PRAGMA integrity_check").all()).toEqual([{ integrity_check: "ok" }]);
    const groups = raw
      .prepare("SELECT key, count(*) AS n FROM results GROUP BY key")
      .all()
      .map((row) => Number(row.n));
    raw.close();
    expect(groups.length).toBeGreaterThanOrEqual(KILLS * 11);
    expect(new Set(groups)).toEqual(new Set([ROWS_PER_TX]));

    const store = openStore(commonDir, { checkIntegrity: true });
    if (isStoreOpenFailure(store)) throw new Error(`open failed: ${JSON.stringify(store)}`);
    expect(store.meta.get(META_STORE_RECOVERED)).toBeNull();
    store.close();
  }, 180_000);
});
