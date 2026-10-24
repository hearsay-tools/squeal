import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatWhy, readWhy, WHY_RESULT_LIMIT } from "../../src/core/status/index.js";
import type { CheckId, ResultRecord } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { addWorktree, createRepo, openHarness, openRepoStore, SLOW } from "../scheduler/helpers.js";
import { result } from "../store/helpers.js";
import { reportOf } from "./why-seed.js";

const CURSOR = "test/cursor.test.ts";
const NAME = "installed runners resolve both bundled mocks";
const cursor: CheckId = { kind: "test", project: "", testPath: CURSOR, fullName: NAME };

/*
 * Issue 15 (011-04), the research probe's three steps as a fixture: A fails
 * at key K, its error naming A's root. B has the same bytes, so key K; its
 * own run fails too and replaces the one row K holds (spec 011 C7). A's
 * known state is unchanged, so `why` in A says the stored errors are B's and
 * names A's run log from the producer the state sink recorded. Then more
 * than `WHY_RESULT_LIMIT` newer results under other keys push B's row out of
 * the listed results: the attribution and A's log stand.
 */
describe("squeal why after another worktree's run replaced the result at its key", SLOW, () => {
  it("names that worktree and run, keeps this worktree's state and resolves its run log", async () => {
    const repo = createRepo();
    writeFileSync(
      join(repo.main, CURSOR),
      [
        'import { expect, test } from "vitest";',
        "",
        `test(${JSON.stringify(NAME)}, () => {`,
        '  console.log("ran in " + import.meta.dirname);',
        '  expect(import.meta.dirname).toBe("present");',
        "});",
        "",
      ].join("\n"),
    );
    git(repo.main, ["add", CURSOR]);
    git(repo.main, ["commit", "-qm", "cursor"]);
    const other = addWorktree(repo.main, repo.dir, "other");
    const store = openRepoStore(repo.commonDir);

    const a = await openHarness(repo.main, store, repo.commonDir, { policy: RUN_MISSING });
    await a.scheduler.start();
    await a.scheduler.idle();
    const key = a.keyOf(CURSOR) ?? expect.unreachable("A keyed no cursor test");
    const own = store.results.byKey(key, 0).find((r) => r.check.kind === "test");
    expect(own?.outcome).toBe("fail");
    const ownRun = own?.provenance.runId;
    const before = reportOf(readWhy(a.root, `${CURSOR} > ${NAME}`, { includeLogs: true }));
    expect(before.knownState).toMatchObject({ outcome: "fail", origin: { kind: "own" } });
    expect(before.runLog).toMatchObject({ runId: ownRun, worktreeId: a.worktreeId });
    expect(before.runLog?.fromProducer).toBeUndefined();
    expect(before.replacedAtKey).toBeUndefined();

    const b = await openHarness(other, store, repo.commonDir);
    // As the daemon registers its worktree before it starts the scheduler.
    store.worktrees.upsert({
      id: b.worktreeId,
      root: b.root,
      commonDir: repo.commonDir,
      isMain: false,
      registeredAt: Date.now(),
      daemon: null,
    });
    await b.scheduler.start();
    await b.scheduler.idle();
    expect(b.keyOf(CURSOR)).toBe(key);
    const foreign = store.results.byKey(key, 0).find((r) => r.check.kind === "test");
    expect(foreign?.provenance.worktreeId).toBe(b.worktreeId);
    const foreignRun = foreign?.provenance.runId;
    expect(foreignRun).not.toBe(ownRun);
    // Both roots share the prefix the fingerprint keeps: the issue's same fingerprint.
    expect(foreign?.fingerprint).toBe(own?.fingerprint);

    const check = (why: ReturnType<typeof reportOf>) => {
      expect(why.knownState).toEqual(before.knownState);
      expect(why.replacedAtKey).toEqual({
        runId: foreignRun,
        worktreeId: b.worktreeId,
        recordedAt: foreign?.provenance.recordedAt,
        key,
        logDir: store.runs.get(foreignRun ?? "")?.logDir,
      });
      expect(why.runLog).toMatchObject({
        runId: ownRun,
        worktreeId: a.worktreeId,
        state: "present",
        fromProducer: true,
      });
      expect(why.runLog?.path.startsWith(store.runs.get(ownRun ?? "")?.logDir ?? "?")).toBe(true);
      expect(why.runLogUnavailable).toBeUndefined();
      expect(why.runLog?.console?.lines).toEqual([
        `[stdout] ${CURSOR}: ran in ${join(a.root, "test")}`,
      ]);
      const text = formatWhy(why);
      expect(text).toContain(
        `Result at key ${key.slice(0, 12)}: replaced by run ${foreignRun} in ${b.root} at `,
      );
      expect(text).toContain(`    Its log: ${store.runs.get(foreignRun ?? "")?.logDir}\n`);
      expect(text).toContain(`Run ${ownRun} in ${a.root} (this worktree) produced the known state`);
    };

    const replaced = reportOf(readWhy(a.root, `${CURSOR} > ${NAME}`, { includeLogs: true }));
    check(replaced);
    expect(replaced.results.map((e) => e.result.provenance.runId)).toEqual([foreignRun]);
    expect(formatWhy(replaced)).toContain(
      `run ${foreignRun}, ${Math.round(foreign?.durationMs ?? 0)} ms, key ${key.slice(0, 12)}, replaced the result behind this worktree's known state`,
    );

    // The history cap: newer failures under other keys, from a third worktree.
    const newer = Date.now() + 1_000;
    store.results.putMany(
      Array.from({ length: WHY_RESULT_LIMIT + 1 }, (_, i): ResultRecord => {
        const r = result(cursor, `other-${i}`, {
          outcome: "fail",
          worktreeId: "wt-c",
          runId: `run-c-${i}`,
          recordedAt: newer + i,
        });
        return { ...r, provenance: { ...r.provenance, revision: i } };
      }),
    );
    const capped = reportOf(readWhy(a.root, `${CURSOR} > ${NAME}`, { includeLogs: true }));
    expect(capped.results).toHaveLength(WHY_RESULT_LIMIT);
    expect(capped.results.some((e) => e.result.provenance.runId === foreignRun)).toBe(false);
    check(capped);
  });
});
