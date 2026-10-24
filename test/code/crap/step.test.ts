import { describe, expect, it } from "vitest";
import {
  BUSY_RECHECK_MS,
  crapScore,
  RECORD_WAIT_MS,
  readSummary,
} from "../../../src/core/code/crap/index.js";
import { WT } from "../../state/helpers.js";
import { type CoverageRig, coverageRig, sourceOf } from "./rig.js";

/*
 * Spec 015 goal 11 and D9 (row 015-12): each counted function's `crap` and
 * `uncovered` states, pending until every test file that loads its source
 * has a current result with a record, unknown while one cannot have one.
 */

const A = "hot 12 h1\ncold 6 c1\ntiny 1 t1\n";

const blobOf = (rig: CoverageRig, path: string) => rig.store.files.list(WT, [path])[0]?.blob ?? "";

/** A record entry for `src/a.ts` that ran `hot` and `tiny`. */
const ranHotAndTiny = (rig: CoverageRig) => [
  sourceOf("src/a.ts", blobOf(rig, "src/a.ts"), 3, [1, 3]),
];

const fileState = (rig: CoverageRig, path: string) => readSummary(rig.store.meta, WT)?.files[path];

describe("the coverage step", () => {
  it("leaves every state pending until each loader has a current record, then judges by the formula", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": A });
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record: ranHotAndTiny(rig) });
    rig.loader("test/b.test.ts", { closure: ["src/a.ts"], pending: "queued" });

    rig.step();
    expect(rig.states("crap")).toEqual(["cold pending -", "hot pending -", "tiny pending -"]);
    expect(rig.states("uncovered")).toEqual(["cold pending -", "hot pending -", "tiny pending -"]);
    expect(fileState(rig, "src/a.ts")).toMatchObject({
      state: "pending",
      reason: "run",
      waiting: 1,
    });

    // The second loader ran, and its record holds nothing of `src/a.ts`.
    rig.loader("test/b.test.ts", { closure: ["src/a.ts"], record: [] });
    rig.step();
    expect(rig.states("crap")).toEqual([
      `cold fail ${crapScore(6, 0)}`,
      "hot pass 12",
      "tiny pass 1",
    ]);
    expect(rig.states("uncovered")).toEqual(["cold fail -", "hot pass -", "tiny pass -"]);
    expect(crapScore(6, 0)).toBe(42);
    // The first judgement of functions there when coverage started is quiet.
    expect(rig.transitions("src/a.ts", ["hot", "cold", "tiny"])).toEqual([]);
  });

  it("judges a source no test file loads as run by none", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": A, "scripts/x.ts": "tool 3 x1\n" });
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record: ranHotAndTiny(rig) });
    rig.step();
    expect(rig.states("uncovered")).toContain("tool fail -");
    expect(rig.states("crap")).toContain(`tool pass ${crapScore(3, 0)}`);
  });

  it("judges nothing before the worktree's test files are listed", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": A });
    rig.step();
    expect(fileState(rig, "src/a.ts")).toMatchObject({ state: "pending", waiting: 0 });
    expect(rig.states("uncovered")).toEqual(["cold pending -", "hot pending -", "tiny pending -"]);
  });

  it("waits for a record while the writer has work or the result is young, then reads unknown", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": A });
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], recordedAt: rig.clock });
    const young = rig.step();
    expect(fileState(rig, "src/a.ts")).toMatchObject({ state: "pending", reason: "record" });
    expect(young?.wakeAt).toBe(rig.clock + RECORD_WAIT_MS);

    rig.clock += RECORD_WAIT_MS + 1;
    // Review 0.1.297 S1: past its wait, a busy writer's record is looked for again later, not at once.
    expect(rig.step({ writing: true })?.wakeAt).toBe(rig.clock + BUSY_RECHECK_MS);
    expect(fileState(rig, "src/a.ts")).toMatchObject({ state: "pending", reason: "record" });
    rig.step();
    expect(fileState(rig, "src/a.ts")).toEqual({
      state: "unknown",
      blob: blobOf(rig, "src/a.ts"),
      cause: "no-record",
    });
    expect(rig.states("crap")).toEqual(["cold pending -", "hot pending -", "tiny pending -"]);
  });

  it.each([
    ["skipped", { outcomes: ["pass", "skip"] as const }],
    ["unkeyed", { key: null }],
    ["unread", { unread: ["src/a.ts"] }],
  ] as const)("reads unknown for %s", async (cause, spec) => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": A });
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record: ranHotAndTiny(rig) });
    rig.loader("test/b.test.ts", { closure: ["src/a.ts"], record: [], ...spec });
    rig.step();
    expect(fileState(rig, "src/a.ts")).toMatchObject({ state: "unknown", cause });
    expect(rig.states("uncovered")).toEqual(["cold pending -", "hot pending -", "tiny pending -"]);
  });

  it("reads unknown for a record of other bytes of the source", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": A });
    rig.loader("test/a.test.ts", {
      closure: ["src/a.ts"],
      record: [sourceOf("src/a.ts", "0".repeat(40), 3, [1])],
    });
    rig.step();
    expect(fileState(rig, "src/a.ts")).toMatchObject({ state: "unknown", cause: "unread" });
  });

  it("keeps a pending source's last judged states, and records a crossing once judged again", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": A });
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record: ranHotAndTiny(rig) });
    rig.step();

    // An edit adds `fresh` and re-keys the loader: pending, the last judged states stay.
    await rig.edit({ "src/a.ts": `${A}fresh 8 f1\n` });
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], key: "key-2", pending: "queued" });
    rig.step();
    expect(rig.states("uncovered")).toEqual(["cold fail -", "hot pass -", "tiny pass -"]);

    // The run calls `cold` now and no longer `hot`.
    const blob = blobOf(rig, "src/a.ts");
    rig.loader("test/a.test.ts", {
      closure: ["src/a.ts"],
      key: "key-2",
      record: [sourceOf("src/a.ts", blob, 4, [2, 3])],
    });
    rig.step();
    expect(rig.states("uncovered")).toEqual([
      "cold pass -",
      "fresh fail -",
      "hot fail -",
      "tiny pass -",
    ]);
    expect(rig.transitions("src/a.ts", ["hot", "cold", "fresh"])).toEqual([
      "crap pass-to-fail hot",
      "uncovered pass-to-fail hot",
      "crap fail-to-pass cold",
      "uncovered fail-to-pass cold",
      "crap first-seen-fail fresh",
      "uncovered first-seen-fail fresh",
    ]);
  });

  it("resolves a failing function an edit removed", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": A });
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record: ranHotAndTiny(rig) });
    rig.step();
    await rig.edit({ "src/a.ts": "hot 12 h1\ntiny 1 t1\n" });
    expect(rig.transitions("src/a.ts", ["cold"])).toEqual([
      "crap removed cold",
      "uncovered removed cold",
    ]);
    expect(rig.states("crap").some((s) => s.startsWith("cold"))).toBe(false);
  });
});

describe("the coverage step's meta and the prune", () => {
  it("drops the summary and evidence of a worktree no longer live, and keeps a live one's", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": A });
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record: ranHotAndTiny(rig) });
    rig.step();
    rig.store.meta.set("coverage:wt-gone", "{}");
    rig.store.meta.set("coverage:wt-gone:src/a.ts", "{}");
    rig.store.prune({ now: rig.clock, retentionDays: 7, worktrees: [WT], consumers: [] });
    expect(rig.store.meta.get("coverage:wt-gone")).toBeNull();
    expect(rig.store.meta.get("coverage:wt-gone:src/a.ts")).toBeNull();
    expect(readSummary(rig.store.meta, WT)).not.toBeNull();
    expect(rig.store.meta.get(`coverage:${WT}:src/a.ts`)).not.toBeNull();
  });
});
