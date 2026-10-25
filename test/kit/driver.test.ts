import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { accepted, describePlayed, forms, type Pack, play } from "./driver.js";
import { fakePack } from "./fake.js";
import type { Scenario } from "./scenarios/index.js";
import { K1 } from "./scenarios/k1-flip.js";
import { K2 } from "./scenarios/k2-two-hops.js";
import { K3 } from "./scenarios/k3-load-error.js";
import { K7 } from "./scenarios/k7-same-stat.js";

/*
 * Spec 016 D1: the driver's verdicts over a fake pack, and the rule that
 * the driver and the scenarios name no runner, so that everything a runner
 * knows stays in its pack.
 */

const KIT = import.meta.dirname;
/** The scenarios the fake pack renders: values, re-exports, static tests and broken modules. */
const FAKED = [K1, K2, K3, K7];
const SPEC = "a spec line that documents the gap";
/** K1's gap in a stale pack: the run after the first edit still passes. */
const GAP = { spec: SPEC, fails: ["step 2 run"] };
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-kit-driver-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let plays = 0;
/** Plays in a directory of its own, so one scenario plays more than once. */
const playIn = (scenario: Scenario, pack: Pack) =>
  play(scenario, pack, join(scratch, `${plays++}`));

describe("the kit's driver (spec 016 D1)", () => {
  it.each(FAKED)("plays $name through a faithful pack as PASS", async (scenario) => {
    const played = await playIn(scenario, fakePack());
    expect(played.verdict, describePlayed(played)).toBe("PASS");
    expect(accepted(played.verdict)).toBe(true);
  });

  it("reads a listed gap that fails only its listed assertions as KNOWN, which the kit accepts", async () => {
    const played = await playIn(K1, fakePack({ stale: true, known: { K1: GAP } }));
    expect(played.verdict).toBe("KNOWN");
    expect(accepted(played.verdict)).toBe(true);
    expect(played.lines).toContain("FAIL step 2 run (completed): direct is pass, expected fail");
  });

  it("reads a listed gap that passes as UNEXPECTED PASS, which fails the kit", async () => {
    const played = await playIn(K1, fakePack({ known: { K1: GAP } }));
    expect(played.verdict).toBe("UNEXPECTED PASS");
    expect(accepted(played.verdict)).toBe(false);
    expect(describePlayed(played)).toContain(`UNEXPECTED PASS K1 × fake (listed gap: ${SPEC})`);
  });

  it("reads a listed gap that fails another assertion as FAIL (review 016-12 B2)", async () => {
    const played = await playIn(
      K1,
      fakePack({ stale: true, known: { K1: { spec: SPEC, fails: ["step 1 edit"] } } }),
    );
    expect(played.verdict).toBe("FAIL");
    expect(accepted(played.verdict)).toBe(false);
  });

  it("reads a listed gap whose pack cannot open, or cannot close, as FAIL (review 016-12 B2)", async () => {
    const unopened = await playIn(K1, {
      ...fakePack({ known: { K1: GAP } }),
      open: () => Promise.reject(new Error("unrelated adapter start failure")),
    });
    expect(unopened.verdict).toBe("FAIL");
    expect(unopened.lines.join("\n")).toContain("threw: Error: unrelated adapter start failure");
    const pack = fakePack({ stale: true, known: { K1: GAP } });
    const unclosed = await playIn(K1, {
      ...pack,
      open: async (root, scratch, fixture) => {
        const adapter = await pack.open(root, scratch, fixture);
        adapter.close = () => Promise.reject(new Error("no close"));
        return adapter;
      },
    });
    expect(unclosed.verdict).toBe("FAIL");
    expect(unclosed.lines.join("\n")).toContain("close threw: Error: no close");
  });

  it("reads an unlisted gap as FAIL, and a pack that cannot open as FAIL", async () => {
    const stale = await playIn(K1, fakePack({ stale: true }));
    expect(stale.verdict).toBe("FAIL");
    expect(accepted(stale.verdict)).toBe(false);
    const broken: Pack = {
      ...fakePack(),
      open: () => Promise.reject(new Error("no runner here")),
    };
    const unopened = await playIn(K1, broken);
    expect(unopened.verdict).toBe("FAIL");
    expect(unopened.lines.join("\n")).toContain("threw: Error: no runner here");
  });
});

describe("the driver's steps (spec 016 D1)", () => {
  const modules = {
    leaf: { kind: "value", value: 1 },
    direct: { kind: "test", check: "direct", from: "leaf", expect: 1 },
  } as const;

  it("plays each scenario through the pack, then through each variant that lists it", () => {
    const variant = { ...fakePack(), name: "fake variant" };
    const pack = { ...fakePack(), variants: [{ name: "v", scenarios: ["K2"], pack: variant }] };
    const listed = forms([K1, K2], pack).map((f) => [f.scenario.name, f.variant, f.pack.name]);
    expect(listed).toEqual([
      ["K1", undefined, "fake"],
      ["K2", undefined, "fake"],
      ["K2", "v", "fake variant"],
    ]);
  });

  it("fails a precondition whose path the static closure holds, so it can prove something", async () => {
    const scenario: Scenario = {
      name: "P",
      title: "a path the static closure holds",
      modules,
      steps: [{ lacks: "leaf", of: ["direct"] }],
    };
    const played = await playIn(scenario, fakePack());
    expect(played.verdict).toBe("FAIL");
    expect(played.lines).toContain(
      "FAIL step 0 before any run: m/leaf.json is in no static closure of direct (closure=true, environment=false)",
    );
  });

  it("reads a same-stat edit that changes the size as FAIL", async () => {
    const scenario: Scenario = {
      name: "S",
      title: "a same-stat edit of another size",
      modules,
      steps: [{ edit: "leaf", to: { kind: "value", value: 10 }, reaches: [], sameStat: true }],
    };
    const played = await playIn(scenario, fakePack());
    expect(played.verdict).toBe("FAIL");
    expect(played.lines.join("\n")).toContain(
      "step 0 edit m/leaf.json changes the size it is to keep",
    );
  });
});

describe("what names a runner (spec 016 D1)", () => {
  const RUNNER = /vitest|node\W*test|pytest|python|\.py\b|\.mjs\b/i;
  const text = (path: string) => readFileSync(join(KIT, path), "utf8");
  const scenarios = readdirSync(join(KIT, "scenarios")).map((name) => `scenarios/${name}`);

  it("is never the driver or a scenario", () => {
    for (const path of ["driver.ts", "steps.ts", "files.ts", ...scenarios]) {
      expect(text(path), path).not.toMatch(RUNNER);
      expect(text(path), path).not.toMatch(/from\s+["'][^"']*\/runners\//);
    }
  });

  it("is each pack, so the rule above can fail", () => {
    for (const name of readdirSync(join(KIT, "packs"))) {
      expect(text(`packs/${name}`), name).toMatch(RUNNER);
    }
  });
});
