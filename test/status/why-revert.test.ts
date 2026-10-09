import { describe, expect, it } from "vitest";
import { formatWhy, readWhy } from "../../src/core/status/index.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "../scheduler/helpers.js";
import { reportOf } from "./why-seed.js";

const PLAIN = "test/plain.test.ts";

/** `test/plain.test.ts` printing `output` from its one test. */
const plain = (output: string) =>
  [
    'import { expect, it } from "vitest";',
    "",
    'it("is plain", () => {',
    `  console.log(${JSON.stringify(output)});`,
    "  expect(1).toBe(1);",
    "});",
    "",
  ].join("\n");

/*
 * Review wave-13i B4, the revert probe: K0 passes, an edit's K1 passes, and
 * restoring K0's bytes takes K0's stored pass back without a run. `why`
 * names K0's run, not the newer K1 run, and prints only K0's console.
 */
describe("squeal why after a revert", SLOW, () => {
  it("names the run that stored the restored key's result", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir);
    h.write(PLAIN, plain("K0 OUTPUT"));
    await h.scheduler.start();
    await h.scheduler.idle();
    const k0 = h.keyOf(PLAIN);
    const k0RunId = store.results.byKey(k0, 0).find((r) => r.check.testPath === PLAIN)
      ?.provenance.runId;

    h.write(PLAIN, plain("K1 OUTPUT"));
    await h.batch(PLAIN);
    await h.scheduler.idle();
    const k1 = h.keyOf(PLAIN);
    expect(k1).not.toBe(k0);
    expect(h.runsOf(PLAIN)).toHaveLength(2);

    h.write(PLAIN, plain("K0 OUTPUT"));
    await h.batch(PLAIN);
    await h.scheduler.idle();
    expect(h.keyOf(PLAIN)).toBe(k0);
    expect(h.runsOf(PLAIN)).toHaveLength(2);

    const why = reportOf(readWhy(h.root, `${PLAIN} > is plain`, { includeLogs: true }));

    expect(why.knownState).toMatchObject({ outcome: "pass", validity: "current" });
    expect(why.results[0]?.result.key).toBe(k1);
    expect(k0RunId).toBeDefined();
    expect(why.runLog).toMatchObject({ runId: k0RunId, state: "present" });
    expect(why.runLog?.console?.lines).toEqual([`[stdout] ${PLAIN}: K0 OUTPUT`]);
    const text = formatWhy(why);
    expect(text).toContain(
      `Run ${k0RunId} in ${h.root} (this worktree) produced the result shown.`,
    );
    expect(text).not.toContain("K1 OUTPUT");
  });
});
