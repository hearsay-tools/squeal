import { describe, expect, it } from "vitest";
import { squealEvidence } from "../../evals/lib/index.mjs";
import { formatDelta, formatRegistration } from "../../src/core/delivery/index.js";
import { createStateSink } from "../../src/core/state/index.js";
import { deliveryOf, type WiredRig, wiredRig } from "../lint/wiring/rig.js";
import { check, result } from "../state/helpers.js";
import { NOW } from "../status/slow-tier-seed.js";

/*
 * Spec 017 D8: the evals read lint lines as code lines, never as test
 * failures. Two sessions see one test failure, one with the lint part and
 * one without; the parser must read the same evidence from both, from the
 * real formatter, plain and in a Claude Code hook's JSON (0.1.197's B2).
 */

/** A Claude Code hook's reply carrying `text` as context. */
const hooked = (text: string) =>
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "PostToolBatch", additionalContext: text },
  });

/** The same news to a session with the lint part and one without, as the formatter words it. */
async function told(rig: WiredRig, failing: boolean) {
  const lint = deliveryOf(rig);
  const plain = deliveryOf(rig, { lint: false });
  const withLint = rig.consumer("lint");
  const without = rig.consumer("plain");
  const registered = [await lint.register(withLint), await plain.register(without)];
  await rig.edit(
    Object.fromEntries(
      ["a", "b", "c", "d", "e", "f"].map((n) => [`src/${n}.js`, "bad no-undef\n"]),
    ),
  );
  if (failing) {
    const file = { project: "", path: "src/a.test.ts" };
    createStateSink(rig.store, { now: () => NOW }).applyResults(
      rig.repo.mainId,
      2,
      [result(check("adds", file), "fail", { key: "key-src/a.test.ts" })],
      { checkpointId: null },
    );
  }
  const deltas = [await lint.onToolBoundary(withLint), await plain.onToolBoundary(without)];
  return {
    registrations: registered.map((r) => formatRegistration(r, undefined, "squeal", NOW)),
    deliveries: deltas.map((d) => (d === null ? null : formatDelta(d))),
  };
}

async function rig() {
  const failing = { "src/z.js": "bad no-console\n" };
  return wiredRig({
    ...failing,
    ...Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((n) => [`src/${n}.js`, "ok\n"])),
  });
}

describe("the evals' reading of lint lines (017 D8)", () => {
  it("reads a delivery with lint lines as the same delivery without them", async () => {
    const [withLint = "", without = ""] = (await told(await rig(), true)).deliveries.map(
      (d) => d ?? expect.unreachable(),
    );
    expect(withLint).toContain("FAIL lint: src/a.js: 1 finding, +1 no-undef (no-undef found)");
    expect(withLint).toContain("and 1 more lint change; squeal lint --changed lists them.");
    expect(without).not.toContain("lint");
    const read = squealEvidence(withLint, "push");
    expect(read?.checks).toEqual([
      expect.objectContaining({ file: "src/a.test.ts", to: "fail", validity: "current" }),
    ]);
    expect(read).toEqual(squealEvidence(without, "push"));
    expect(squealEvidence(hooked(withLint), "push")).toEqual(read);
  });

  it("reads no check and no failure from a delivery whose news is lint alone", async () => {
    const [told1, without] = (await told(await rig(), false)).deliveries;
    expect(without).toBeNull();
    const withLint = told1 ?? expect.unreachable();
    expect(withLint.split("\n")[0]).toBe("SQUEAL · 6 lint changes at revision 2");
    for (const text of [withLint, hooked(withLint)]) {
      const read = squealEvidence(text, "push");
      expect(read).toMatchObject({ checks: [], failures: 0, failing: [] });
    }
  });

  it("reads a registration with its lint line as the one without it", async () => {
    const { registrations } = await told(await rig(), false);
    const [withLint = "", without = ""] = registrations;
    expect(withLint).toContain("Lint: 1 file with findings; squeal lint lists them.");
    expect(squealEvidence(withLint, "push")).toEqual(squealEvidence(without, "push"));
    expect(squealEvidence(hooked(withLint), "push")).toEqual(squealEvidence(without, "push"));
  });
});
