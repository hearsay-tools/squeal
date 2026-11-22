import { describe, expect, it, vi } from "vitest";
import { createDelivery } from "../../src/core/delivery/delivery.js";
import { tellUncovered, uncoveredTold } from "../../src/core/delivery/uncovered.js";
import type { Consumer } from "../../src/core/types/delivery.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { WT } from "../state/helpers.js";
import { fakeCommonDir, open } from "../store/helpers.js";
import { fixedStatus } from "./fakes.js";
import { sentStore } from "./sent-fixture.js";

/*
 * Spec 024 D2 (row 024-02): `tellUncovered` finds the paths read-only first and enters a
 * transaction, which takes a hook's write lease, only when it has paths to record. Its closure
 * scan stops once every changed code file is covered, and keeps the trust rule: a listed file
 * with no closure it can trust, reached before every path is covered, says nothing.
 */

const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const file = (n: number): TestFileRef => ({ project: "", path: `src/t${n}.test.ts` });

/**
 * A worktree with `files` listed (`closures[i]` the closure of file i, `null` none stored),
 * C1 registered, and a revision that changed `changed`. Returns a hook's store over a
 * `SendingConnection` whose writes go to a fake daemon.
 */
async function edited(closures: readonly (readonly string[] | null)[], changed: string[]) {
  const commonDir = fakeCommonDir();
  const setup = open(commonDir);
  setup.testFileKeys.upsertMany(
    closures.map((_, i) => ({
      worktreeId: WT,
      testFile: file(i),
      key: `k${i}`,
      revision: 1,
      pending: null,
    })),
  );
  closures.forEach((paths, i) => {
    if (paths === null) return;
    const testFile = file(i);
    setup.testFiles.put({
      testFile,
      closure: {
        testFile,
        paths: [...paths],
        complete: false,
        method: "static imports plus declared inputs",
      },
      updatedAt: 1,
      updatedBy: WT,
    });
  });
  const revision = (changes: string[]) =>
    setup.transaction(() =>
      setup.revisions.append({
        worktreeId: WT,
        createdAt: 2,
        head: null,
        dirty: true,
        trigger: "watch",
        changes: changes.map((path, i) => ({ path, oldHash: null, newHash: `h${i}${path}` })),
      }),
    );
  revision(["seed.md"]);
  await createDelivery(setup, { status: fixedStatus(), now: () => 1_000 }).register(C1);
  revision(changed);
  const sent = sentStore(commonDir);
  const { store } = sent;
  const tell = () => sent.write(() => tellUncovered(store, C1, () => true));
  const close = () => sent.close();
  return { store, setup, tell, log: sent.log, close };
}

describe("tellUncovered reads first (spec 024 D2)", () => {
  it("takes no write lease for a covered edit", async () => {
    const r = await edited([["src/a.ts"], ["src/b.ts"]], ["src/b.ts", "src/t0.test.ts"]);
    expect(await r.tell()).toEqual([]);
    expect(r.log).toEqual([]);
    r.close();
  });

  it("takes one lease for an uncovered edit and writes the told paths in one request", async () => {
    const r = await edited([["src/a.ts"]], ["scripts/x.mjs", "src/a.ts"]);
    expect(await r.tell()).toEqual(["scripts/x.mjs"]);
    expect(r.log.filter((l) => l === "lease")).toEqual(["lease"]);
    expect(uncoveredTold(r.setup, C1)).toEqual(["scripts/x.mjs"]);
    // Told once: the next edit boundary finds nothing new and takes no lease.
    r.log.length = 0;
    expect(await r.tell()).toEqual([]);
    expect(r.log).toEqual([]);
    r.close();
  });

  it("takes no lease while a listed file has no closure it can trust", async () => {
    const r = await edited([["src/a.ts"], null], ["scripts/x.mjs"]);
    expect(await r.tell()).toEqual([]);
    expect(r.log).toEqual([]);
    r.close();
  });
});

describe("the closure scan stops once every changed code file is covered (spec 024 D2)", () => {
  const many = (first: readonly string[] | null, rest: number) => [
    first,
    ...Array.from({ length: rest }, (_, i) => [`src/m${i}.ts`]),
  ];

  it("reads one closure when the first listed file covers the edit", async () => {
    const r = await edited(many(["src/a.ts"], 50), ["src/a.ts"]);
    const get = vi.spyOn(r.store.testFiles, "get");
    expect(await r.tell()).toEqual([]);
    expect(get).toHaveBeenCalledTimes(1);
    r.close();
  });

  it("says nothing when an untrusted file comes before the edit is covered", async () => {
    const r = await edited([null, ["src/a.ts"]], ["src/a.ts", "scripts/x.mjs"]);
    expect(await r.tell()).toEqual([]);
    r.close();
  });

  it("says nothing of a covered edit even when an untrusted file comes after its cover", async () => {
    const r = await edited([["src/a.ts"], null], ["src/a.ts"]);
    expect(await r.tell()).toEqual([]);
    r.close();
  });

  it("checks an uncovered path against every listed file", async () => {
    const r = await edited(many(["src/a.ts"], 20), ["src/a.ts", "src/m19.ts", "scripts/x.mjs"]);
    const get = vi.spyOn(r.store.testFiles, "get");
    expect(await r.tell()).toEqual(["scripts/x.mjs"]);
    // All 21 files, each time the paths are found: read first, then again once the write
    // lease is taken (`SendingConnection.unit` runs the work again), and in the transaction.
    expect(get).toHaveBeenCalledTimes(3 * 21);
    r.close();
  });
});
