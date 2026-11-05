import { describe, expect, it } from "vitest";
import {
  decision,
  HARNESSES,
  type Harness,
  markStopWait,
} from "../../harness/stop-slow-helpers.js";
import { FakeProvider, fakeOxlint, storeOf } from "../pass/helpers.js";
import { hookedRepo } from "./rig.js";

/*
 * Review 0.1.406 B3 (spec 019 D1, 017 D8): Stop decides from every untold
 * failure of the lint groups it waits for, not from the five entries a
 * delivery lists (`LINT_LISTED_MAX`). ESLint's group lints at `pause`,
 * oxlint's at `stop`; ESLint's failures come first in the news and fill
 * the list. The waiting entry still holds once for oxlint's failure, its
 * delivery lists five and counts the rest, and the next Stop is silent.
 * Claude Code and Codex, with `lint.blocking` off.
 */

const GROUPS = [
  { name: "es", lint: ["eslint"], at: "pause" },
  { name: "ox", lint: ["oxlint"], at: "stop" },
];
const OX_FINDING = "the ox group ran at revision 2: 1 file has lint findings: src/a5.js (oxlint).";

/**
 * A session in a turn over six passing files `src/a0.js` to `src/a5.js`,
 * the waiting entry known, whose `edits` both groups hold. The fake oxlint
 * finds no `no-undef`; the fake ESLint finds none of `eslintOff`.
 */
async function behindTheCap(
  harness: Harness,
  edits: Record<string, string>,
  eslintOff: readonly string[] = [],
) {
  const eslint = new FakeProvider();
  for (const rule of eslintOff) eslint.off.add(rule);
  const oxlint = fakeOxlint();
  oxlint.off.add("no-undef");
  const files = Object.fromEntries([0, 1, 2, 3, 4, 5].map((i) => [`src/a${i}.js`, "ok\n"]));
  const lint = { enabled: true, tools: ["eslint", "oxlint"] };
  const policy = { checks: GROUPS, stop: { slowWaitMs: 5_000 } };
  const hooked = await hookedRepo(files, lint, policy, { eslint, oxlint });
  await harness.startTurn(hooked.r);
  markStopWait(hooked.r, harness.name);
  await hooked.edit(edits);
  return hooked;
}

const NO_UNDEF = Object.fromEntries([0, 1, 2, 3, 4].map((i) => [`src/a${i}.js`, "bad no-undef\n"]));

describe.each(HARNESSES)("Stop news beyond display cap, $name (review 0.1.406 B3)", (harness) => {
  it.each([
    { name: "six ESLint failures, then oxlint's", a5: "bad other-rule\n", off: [] },
    { name: "oxlint's only failure, sixth", a5: "bad ox-only\n", off: ["ox-only"] },
  ])("$name: the waiting entry holds once for it, then Stop is silent", async ({ a5, off }) => {
    const hooked = await behindTheCap(harness, { ...NO_UNDEF, "src/a5.js": a5 }, off);
    const { r } = hooked;
    expect(decision(await harness.stop(r)), "the lint waits: the 2 s entry ends the turn").toEqual(
      {},
    );
    // The agent paused: both groups lint before the waiting entry decides.
    await hooked.settle();
    const failing = storeOf(hooked.tree)
      .states.list(r.worktreeId)
      .filter((s) => s.outcome === "fail")
      .map((s) => `${s.check.path} ${s.check.tool}`);
    expect(failing).toContain("src/a5.js oxlint");
    expect(failing.length, "five or more failures before oxlint's").toBeGreaterThan(5);
    const waiting = decision(await harness.stopSlow(r));
    expect(waiting.decision).toBe("block");
    expect(waiting.reason).toContain(OX_FINDING);
    expect(waiting.reason).toMatch(/and \d more lint change/);

    const active = { stop_hook_active: true };
    const quick = decision(await harness.stop(r, active));
    const next = quick.decision === undefined ? decision(await harness.stopSlow(r, active)) : {};
    expect({ quick, next }, "told once: the next Stop is silent").toEqual({ quick: {}, next: {} });
  });
});
