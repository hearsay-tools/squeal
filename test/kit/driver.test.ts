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
import { K8 } from "./scenarios/k8-cut.js";
import { K10 } from "./scenarios/k10-two-worktrees.js";

/*
 * Spec 016 D1: the driver's verdicts over a fake pack, and the rule that
 * the driver and the scenarios name no runner, so that everything a runner
 * knows stays in its pack.
 */

const KIT = import.meta.dirname;
/**
 * The scenarios the fake pack renders: values, re-exports, static tests,
 * broken and held modules, computed imports and child processes.
 */
const FAKED = [K1, K2, K3, K7, K8, K10];
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
      "FAIL step 0 before any run: m/leaf.json is in no static closure of direct (closure=true, keyed=true, environment=false)",
    );
  });

  it("asserts a cut that reached the held file's marker and sent the abort", async () => {
    const played = await playIn(K8, fakePack());
    expect(played.verdict, describePlayed(played)).toBe("PASS");
    expect(played.lines).toContain(
      "ok   step 0 cut for stop: the held file started, then the abort was sent",
    );
    expect(played.lines).toContain("ok   step 0 run (completed): cut is unknown, expected unknown");
  });

  it("reads a cut run that crashed before its marker as FAIL, though its file is unknown (review 0.1.303 B2)", async () => {
    const played = await playIn(K8, fakePack({ crashFirst: true }));
    expect(played.verdict).toBe("FAIL");
    expect(played.lines).toEqual(
      expect.arrayContaining([
        "FAIL step 0 cut for stop: the run ended before the abort, so nothing was cut",
        "ok   step 0 run (crashed): cut is unknown, expected unknown",
        "ok   step 2 run (completed): cut is pass, expected pass",
      ]),
    );
  });

  it("reaches worktree b and the restart only through the store: marks kept in memory fail there", async () => {
    const played = await playIn(K10, fakePack({ marks: "memory" }));
    expect(played.verdict).toBe("FAIL");
    expect(played.lines).toEqual(
      expect.arrayContaining([
        "ok   step 3 in b: lists t/loads.json, t/spawns.json (got t/loads.json, t/spawns.json)",
        "ok   step 5 holds: m/dep.json is in a closure of spawns (closure=false, keyed=true)",
        "FAIL step 7 direct: m/dep.json puts spawns in direct (affected=none)",
        "ok   step 9 restarted a: lists t/loads.json, t/spawns.json (got t/loads.json, t/spawns.json)",
        "FAIL step 13 direct: m/dep.json puts spawns in direct (affected=none)",
      ]),
    );
  });

  it("reads what a run observed as held elsewhere only through the core's path: no observations fail there", async () => {
    const played = await playIn(K10, fakePack({ observes: false }));
    expect(played.verdict).toBe("FAIL");
    expect(played.lines).toEqual(
      expect.arrayContaining([
        "FAIL step 4 holds: m/hidden.json is in a closure of loads (closure=false, keyed=false)",
        "FAIL step 10 holds: m/hidden.json is in a closure of loads (closure=false, keyed=false)",
      ]),
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
    for (const path of ["driver.ts", "steps.ts", "files.ts", "worktrees.ts", ...scenarios]) {
      expect(text(path), path).not.toMatch(RUNNER);
      expect(text(path), path).not.toMatch(/from\s+["'][^"']*\/runners\//);
      // A runner's injected store is its pack's to open (spec 016 D4 removes it).
      expect(text(path), path).not.toMatch(/from\s+["'][^"']*-runners\.js["']/);
    }
  });

  it("is each pack, so the rule above can fail", () => {
    for (const name of readdirSync(join(KIT, "packs"))) {
      expect(text(`packs/${name}`), name).toMatch(RUNNER);
    }
  });
});
