import { describe, expect, it } from "vitest";
import { namedSnapshotCommand } from "../../src/cli/status-paths.js";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { CLOSURE_METHOD } from "../../src/core/keys/closure.js";
import type { RevisionNumber } from "../../src/core/types/index.js";
import { focusedRun, writeRuns } from "../status/focused-fixture.js";
import { A, NOW, ref, repoWith } from "./status-wait-fixture.js";
import { A_QUEUED, capture } from "./status-wait-focus-fixture.js";

/*
 * Row 011-146 (011 C6 as amended 2026-10-23): `status <path>... --check
 * <text>...` without `--wait` reads the focused answers of the selected
 * checks in its one read and requests nothing (coordinator request
 * 0dcc4623 grants `status-paths.ts` this reader call).
 */

const synced = (): SyncState => ({
  state: "synced",
  revision: 4 as RevisionNumber,
  incarnation: null,
});
const options = { now: () => NOW, sync: (): DaemonSync => ({ current: synced, stop: () => {} }) };

describe("status <path> --check without --wait (011 C6, row 011-146)", () => {
  it("names the applying focused run of the selected checks and exits as the snapshot", async () => {
    const { repo, store } = repoWith([A]);
    writeRuns(store, repo.mainId, [focusedRun(A, { key: A_QUEUED })]);
    const io = capture(repo.main);

    const code = await namedSnapshotCommand(
      [A],
      { json: false, checks: ["claude U"] },
      io,
      options,
    );

    // The snapshot's own code: no verdict while A is pending; the focused fail is not counted.
    expect(code).toBe(3);
    const text = io.out.join("");
    expect(text).toContain(
      `Focused: 1 check of ${A} at revision 4, run alone in 7.8 s; not the file's verdict.`,
    );
    expect(text).toContain("  FAIL  claude U2 ci and timer open");
    expect(text).toMatch(
      /Named test files have no verdict: 1 test file still pending at revision 4/,
    );
  });

  it("--json carries selection.focused with the snapshot outcome", async () => {
    const { repo, store } = repoWith([A]);
    writeRuns(store, repo.mainId, [focusedRun(A, { key: A_QUEUED })]);
    const io = capture(repo.main);

    await namedSnapshotCommand([A], { json: true, checks: ["claude U"] }, io, options);

    const json = JSON.parse(io.out.join(""));
    expect(json.selection.outcome).toBe("snapshot");
    expect(json.selection.focused.testFiles[0]).toMatchObject({
      path: A,
      source: "focused",
      matched: 1,
    });
    expect(json.focused[0]).toMatchObject({ applies: true });
  });

  it("with source paths only it is a usage error, exit 2", async () => {
    const { repo, store } = repoWith([A]);
    store.testFiles.put({
      testFile: ref(A),
      closure: {
        testFile: ref(A),
        paths: [A, "src/shared.ts"].sort() as never,
        complete: false,
        method: CLOSURE_METHOD,
      },
      updatedAt: NOW,
      updatedBy: repo.mainId,
    });
    const io = capture(repo.main);

    const code = await namedSnapshotCommand(
      ["src/shared.ts"],
      { json: false, checks: ["x"] },
      io,
      options,
    );

    expect(code).toBe(2);
    expect(io.err.join("")).toBe(
      "squeal status: --check selects checks inside a test file named by its own path\n",
    );
  });
});
