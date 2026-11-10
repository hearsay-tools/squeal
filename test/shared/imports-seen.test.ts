import { describe, expect, it } from "vitest";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import { ImportsSeen } from "../../src/core/shared/imports-seen.js";
import type { ResultsBundle } from "../../src/core/store/transfer-bundle.js";
import { RESULTS_FORMAT } from "../../src/core/store/transfer-bundle.js";
import { importResults } from "../../src/core/store/transfer-import.js";
import type { ProjectName } from "../../src/core/types/common.js";
import type { Store } from "../../src/core/types/store.js";
import { fakeCommonDir, open } from "../store/helpers.js";

/*
 * Row 018-28: the daemon's retry request reads again the observed entries of
 * each import its keys have not read, whichever path imported it (the
 * reader, `squeal import`). An import before the daemon's start is read by
 * the start; one a busy scheduler did not take is handed again.
 */

/** An export of `files`, each `project/path`, with no result. */
function bundleOf(
  commit: string,
  files: readonly (readonly [ProjectName, string])[],
): ResultsBundle {
  return {
    format: RESULTS_FORMAT,
    header: {
      squealVersion: "0.0.0",
      keyFormat: KEY_FORMAT_VERSION,
      commit,
      dirty: false,
      createdAt: 1_762_000_000_000,
      source: { kind: "local" },
    },
    environments: [],
    testFiles: files.map(([project, path]) => ({
      project,
      path,
      key: `k-${project}-${path}`,
      closure: null,
      observed: {},
    })),
    observedStartup: [],
    results: [],
  };
}

function imported(store: Store, id: string, files: readonly (readonly [ProjectName, string])[]) {
  importResults(store, bundleOf(id.padEnd(40, "0"), files), {
    importId: id,
    fileHash: id,
    now: 1_762_100_000_000,
  });
}

describe("the imports a daemon's keys read (row 018-28)", () => {
  it("hands each later import's projects once, and again while the scheduler does not take them", () => {
    const store = open(fakeCommonDir());
    imported(store, "before", [["web", "a.test.ts"]]);
    const seen = new ImportsSeen(store);
    const handed: (readonly ProjectName[])[] = [];
    const take = (accept: boolean) =>
      seen.take((projects) => {
        handed.push(projects);
        return accept;
      });

    take(true);
    expect(handed).toEqual([]);

    imported(store, "first", [
      ["server", "s.test.ts"],
      ["web", "w.test.ts"],
      ["server", "t.test.ts"],
    ]);
    take(false);
    take(true);
    take(true);
    expect(handed).toEqual([
      ["server", "web"],
      ["server", "web"],
    ]);

    imported(store, "second", [["contract", "c.test.ts"]]);
    take(true);
    expect(handed.at(-1)).toEqual(["contract"]);
    expect(handed).toHaveLength(3);
  });
});
