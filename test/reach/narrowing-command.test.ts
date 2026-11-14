import { afterEach, describe, expect, it } from "vitest";
import type { ReachReport } from "../../src/core/reach/report-types.js";
import { LOADED_MODULES_SQL, LOADED_MODULES_TABLE } from "../../src/core/store/loaded-modules.js";
import { changeMarker, connectionOf } from "../../src/core/store/store.js";
import type { Store } from "../../src/core/types/store.js";
import { A, B, closeStores, ON, records, run, seeded } from "./store-fixture.js";

/*
 * Row 022-04 (spec 022 D4): `squeal reach` reads the loaded lists from a
 * real store's `loaded_modules` table (D3), and a store without the table
 * reads none. It still writes nothing (015 D11).
 */

afterEach(closeStores);

const NOV_1 = Date.UTC(2026, 10, 1);

/** A's list leaves out `src/one.ts`, which it imports; B's holds it. */
function lists(store: Store) {
  const conn = connectionOf(store);
  conn.run(LOADED_MODULES_SQL);
  for (const [path, modules] of [
    [A, [A]],
    [B, [B, "src/one.ts"]],
  ] as const) {
    conn.run(
      `INSERT INTO ${LOADED_MODULES_TABLE} (project, path, key, recorded_at, modules) VALUES (?, ?, ?, ?, ?)`,
      "",
      path,
      `key-${path}`,
      NOV_1,
      JSON.stringify(modules.map((p) => ({ path: p, hash: `blob-${p}` }))),
    );
  }
}

describe("squeal reach: narrowing by loaded modules from the store", () => {
  it("estimates from the stored lists, in JSON and text, and writes nothing", async () => {
    const { repo, store } = seeded(ON);
    records(repo);
    lists(store);
    const before = changeMarker(store);
    const json = await run(repo.main, ["--json"]);
    expect(json.code).toBe(0);
    expect(changeMarker(store)).toEqual(before);
    const report = JSON.parse(json.stdout) as ReachReport;
    // Two edits of src/one.ts re-ran A (1 s) and B (2 s) each; only A did not load it.
    expect(report.narrowing).toEqual([
      {
        project: "",
        status: "estimate",
        lists: "lists: the newest recorded at or before each edit",
        rerunSeconds: 6,
        avoidableSeconds: 2,
        share: 1 / 3,
        files: [{ path: "src/one.ts", avoidableSeconds: 2, importedBy: 2, loadedBy: 1 }],
        moreFiles: 0,
        withoutList: [],
      },
    ]);
    const text = await run(repo.main, []);
    expect(text.stdout).toContain(
      "  default project: would save 33% of re-run seconds, 2 s of 6 s over the window's edits.\n" +
        "    src/one.ts: avoidable 2 s; imported by 2 test files, loaded by 1\n",
    );
  });

  it("reads no lists from a store without the table", async () => {
    const { repo } = seeded(ON);
    records(repo);
    const report = JSON.parse((await run(repo.main, ["--json"])).stdout) as ReachReport;
    expect(report.narrowing).toMatchObject([
      {
        status: "no lists",
        reason: "never recorded",
        withoutList: [{ reason: "never recorded", detail: null, testFiles: 2, seconds: 6 }],
      },
    ]);
    expect((await run(repo.main, [])).stdout).toContain(
      "  default project: no lists: never recorded; nothing estimated.\n",
    );
  });
});
