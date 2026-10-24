import { describe, expect, it } from "vitest";
import { namedSnapshotCommand } from "../../src/cli/status-paths.js";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { namedWaitCommand } from "../../src/cli/status-wait-paths.js";
import type { RevisionNumber } from "../../src/core/types/index.js";
import { focusedRun, writeRuns } from "../status/focused-fixture.js";
import { A, NOW, repoWith } from "./status-wait-fixture.js";
import { A_QUEUED, capture, focusing } from "./status-wait-focus-fixture.js";

/*
 * Row 011-146 (011 C15 as amended 2026-10-23; review 0.1.286 B1): a
 * focused run for more texts than a wait's answers it with only the checks
 * that hold one of the wait's texts, and the file-level failure. Its exit
 * status, lines and JSON name those checks only, in the wait and in the
 * snapshot. A run that left checks out of its list does not answer a
 * narrower wait: the wait asks for its own.
 */

const shared = (over: Parameters<typeof focusedRun>[1] = {}) =>
  focusedRun(A, {
    key: A_QUEUED,
    texts: ["good", "bad"],
    passes: ["good"],
    fails: ["bad"],
    ...over,
  });

const synced = (): SyncState => ({
  state: "synced",
  revision: 4 as RevisionNumber,
  incarnation: null,
});

describe("a shared focused run answers each wait with its own checks (review 0.1.286 B1)", () => {
  it("two waits on one run of good and bad: a pass and a fail, each naming its check only", async () => {
    const good = repoWith([A]);
    writeRuns(good.store, good.repo.mainId, [shared()]);
    const bad = repoWith([A]);
    writeRuns(bad.store, bad.repo.mainId, [shared()]);
    const goodDaemon = focusing(good.store, good.repo.mainId, null);
    const badDaemon = focusing(bad.store, bad.repo.mainId, null);
    const goodText = capture(good.repo.main);
    const badJson = capture(bad.repo.main);

    const goodCode = await namedWaitCommand(
      [A],
      { json: false, checks: ["good"] },
      goodText,
      goodDaemon.options,
    );
    const badCode = await namedWaitCommand(
      [A],
      { json: true, checks: ["bad"] },
      badJson,
      badDaemon.options,
    );

    expect(goodCode).toBe(3);
    expect(goodDaemon.sent).toEqual([]);
    const text = goodText.out.join("");
    expect(text).toContain(`Focused: 1 check of ${A} at revision 4`);
    expect(text).toContain("  pass  good");
    expect(text).not.toContain("bad");
    expect(text).toContain("Focused: 0 of 1 selected check failed; no verdict for the file yet");

    expect(badCode).toBe(1);
    const payload = JSON.parse(badJson.out.join("")).selection.focused;
    expect(payload.texts).toEqual(["bad"]);
    expect(payload.testFiles[0]).toMatchObject({
      source: "focused",
      texts: ["good", "bad"],
      matched: 1,
      checks: [{ name: `${A} > bad`, outcome: "fail" }],
    });
    expect(payload.testFiles[0].checks).toHaveLength(1);
  });

  it("a narrower text that held no check: the no-match line, at once", async () => {
    const { repo, store } = repoWith([A]);
    writeRuns(store, repo.mainId, [shared({ texts: ["good", "zzz"], fails: [] })]);
    const daemon = focusing(store, repo.mainId, null);
    const io = capture(repo.main);

    const code = await namedWaitCommand([A], { json: false, checks: ["zzz"] }, io, daemon.options);

    expect(code).toBe(3);
    expect(daemon.sent).toEqual([]);
    const text = io.out.join("");
    expect(text).toContain(
      `No check of ${A} holds "zzz" at revision 4 (the run collected 78 checks).`,
    );
    expect(text).not.toContain("good");
  });

  it("a run for more texts that left checks out of its list: the wait asks for its own", async () => {
    const { repo, store } = repoWith([A]);
    writeRuns(store, repo.mainId, [shared({ fails: [], more: 1 })]);
    const daemon = focusing(store, repo.mainId, { texts: ["good"], passes: ["good"], fails: [] });
    const io = capture(repo.main);

    const code = await namedWaitCommand([A], { json: true, checks: ["good"] }, io, daemon.options);

    expect(code).toBe(3);
    expect(daemon.sent).toHaveLength(1);
    const file = JSON.parse(io.out.join("")).selection.focused.testFiles[0];
    expect(file).toMatchObject({ texts: ["good"], more: 0, checks: [{ outcome: "pass" }] });
  });

  it("the snapshot form names the wait's checks only", async () => {
    const { repo, store } = repoWith([A]);
    writeRuns(store, repo.mainId, [shared()]);
    const io = capture(repo.main);

    await namedSnapshotCommand([A], { json: true, checks: ["good"] }, io, {
      now: () => NOW,
      sync: (): DaemonSync => ({ current: synced, stop: () => {} }),
    });

    const file = JSON.parse(io.out.join("")).selection.focused.testFiles[0];
    expect(file.checks).toEqual([expect.objectContaining({ name: `${A} > good` })]);
    expect(file.matched).toBe(1);
  });
});
