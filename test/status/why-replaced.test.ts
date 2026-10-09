import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatWhy, readWhy } from "../../src/core/status/index.js";
import type { CheckId, ResultRecord } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { addWorktree, createRepo, openHarness, openRepoStore, SLOW } from "../scheduler/helpers.js";
import { result } from "../store/helpers.js";
import { fakeRepo, seedStore } from "./helpers.js";
import { at, COMMIT, LOGIN, reportOf, seedLogin } from "./why-seed.js";

const PLAIN = "test/plain.test.ts";
const plain: CheckId = { kind: "test", project: "", testPath: PLAIN, fullName: "plain" };

const markers: string[] = [];
afterEach(() => {
  for (const marker of markers.splice(0)) rmSync(marker, { force: true });
});

/*
 * Review wave-13j B4, the reviewer's probe: `plain` prints a marker outside
 * the worktree, which no key covers, and passes. A passes it with FIRST
 * OUTPUT and B inherits that pass without a run. A's forced full suite
 * passes it again with SECOND OUTPUT under the same key, commit and
 * revision; PASS -> PASS heals nothing, so B's state is still the first
 * run's. `why` in B names the first run, or none, never the replacement.
 */
describe("squeal why after a same-key replacement", SLOW, () => {
  it("does not name a later run of the same key as the producer of an inherited state", async () => {
    const repo = createRepo();
    const marker = join(tmpdir(), `squeal-001-190-${randomUUID()}`);
    markers.push(marker);
    writeFileSync(marker, "FIRST OUTPUT");
    writeFileSync(
      join(repo.main, PLAIN),
      [
        'import { readFileSync } from "node:fs";',
        'import { it } from "vitest";',
        "",
        'it("plain", () => {',
        `  console.log(readFileSync(${JSON.stringify(marker)}, "utf8"));`,
        "});",
        "",
      ].join("\n"),
    );
    git(repo.main, ["add", PLAIN]);
    git(repo.main, ["commit", "-qm", "plain"]);
    const other = addWorktree(repo.main, repo.dir, "other");
    const store = openRepoStore(repo.commonDir);

    const a = await openHarness(repo.main, store, repo.commonDir);
    await a.scheduler.start();
    await a.scheduler.idle();
    const first = store.results.byKey(a.keyOf(PLAIN), 0).find((r) => r.check.testPath === PLAIN);
    expect(first?.outcome).toBe("pass");

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
    expect(b.runsOf(PLAIN)).toHaveLength(0);
    const inherited = b.sink.stateOf(plain);
    expect(inherited).toMatchObject({ outcome: "pass", origin: { kind: "inherited" } });
    const before = reportOf(readWhy(b.root, `${PLAIN} > plain`, { includeLogs: true }));
    expect(before.runLog).toMatchObject({ runId: first?.provenance.runId });
    expect(before.runLog?.console?.lines).toEqual([`[stdout] ${PLAIN}: FIRST OUTPUT`]);

    writeFileSync(marker, "SECOND OUTPUT");
    await a.scheduler.requestFullSuite({ force: true });
    await a.scheduler.idle();
    const replaced = store.results.byKey(a.keyOf(PLAIN), 0).find((r) => r.check.testPath === PLAIN);
    expect(replaced?.provenance.runId).not.toBe(first?.provenance.runId);
    expect(replaced?.provenance).toMatchObject({
      commit: first?.provenance.commit,
      revision: first?.provenance.revision,
    });
    expect(b.sink.stateOf(plain)).toEqual(inherited);

    const why = reportOf(readWhy(b.root, `${PLAIN} > plain`, { includeLogs: true }));

    expect(why.knownState).toMatchObject({ outcome: "pass", validity: "current" });
    expect(why.runLog).toBeNull();
    const text = formatWhy(why);
    expect(text).toContain("Run log: unknown, no stored result is identifiably");
    expect(text).not.toContain("SECOND OUTPUT");
  });
});

/*
 * The seeded cases: `b` inherited main's `auth > login` pass at its revision
 * 2, created at 13:00. A row at `b`'s current key recorded later is a
 * replacement, whatever its commit and revision; one recorded earlier was
 * the row `b` applied.
 */
describe("squeal why: an inherited state's producer predates it", () => {
  const NAME = "src/auth.test.ts > auth > login";

  function seeded() {
    const repo = fakeRepo();
    const store = seedStore(repo);
    const b = seedLogin(repo, store);
    store.testFileKeys.upsertMany([
      {
        worktreeId: b.id,
        testFile: { project: "", path: "src/auth.test.ts" },
        key: "k1",
        revision: 1,
        pending: null,
      },
    ]);
    /** Main's pass at `k1`, replacing the row there. */
    const replace = (runId: string, revision: number, recordedAt: number) => {
      const r: ResultRecord = result(LOGIN, "k1", { worktreeId: repo.mainId, runId, recordedAt });
      store.results.putMany([
        { ...r, provenance: { ...r.provenance, revision, commit: COMMIT, dirty: false } },
      ]);
    };
    const producer = () => reportOf(readWhy(b.root, NAME)).runLog?.runId ?? null;
    return { replace, producer, b };
  }

  it("names the row recorded before the state was observed", () => {
    const { replace, producer } = seeded();
    expect(producer()).toBe("run-a1");
    replace("run-a0", 5, at(12, 59));
    expect(producer()).toBe("run-a0");
  });

  it("names none once a later run replaced the row at the same commit and revision", () => {
    const { replace, producer } = seeded();
    replace("run-a2", 3, at(14));
    expect(producer()).toBeNull();
  });

  it("names none once a later run replaced the row at the same commit and another revision", () => {
    const { replace, producer, b } = seeded();
    replace("run-a3", 4, at(14));
    const why = reportOf(readWhy(b.root, NAME));
    expect(producer()).toBeNull();
    expect(formatWhy(why)).toContain("Run log: unknown, no stored result is identifiably");
  });
});
