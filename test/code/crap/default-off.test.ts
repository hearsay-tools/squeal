import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSummary } from "../../../src/core/code/crap/index.js";
import { loadPolicy } from "../../../src/core/daemon/policy.js";
import { freshStore, WT } from "../../state/helpers.js";
import { open } from "../helpers.js";
import { daemonPass, worktree } from "../pass/helpers.js";
import { consumer, coverageRig } from "./rig.js";

/*
 * Row 015-89 (the human, 2026-10-26: "OK, off by default for now"): a
 * project whose squeal.config.json does not set `coverage.enabled` takes no
 * coverage step, hears no session-start coverage sentence and keeps no
 * `untested` or CRAP state, while complexity stays on. One that sets it
 * true gets all three, as in 0.1.358. Each reads the file as the daemon
 * and the hooks do.
 */

const PYTEST = { pytest: [{ name: "py", include: ["tests/test_*.py"] }] };

const UNSET: readonly [string, Record<string, unknown>][] = [
  ["no code key at all", PYTEST],
  [
    "coverage without enabled",
    { ...PYTEST, coverage: { untested: true }, crap: { enabled: true } },
  ],
];
const ON = { ...PYTEST, coverage: { enabled: true } };

const write = (root: string, config: Record<string, unknown>) =>
  writeFileSync(join(root, "squeal.config.json"), JSON.stringify(config));

/** The daemon's code pass over one counted function, by the policy `config` loads to; its coverage steps and states. */
async function passed(config: Record<string, unknown>) {
  const tree = worktree(WT);
  write(tree.root, config);
  tree.write("src/a.ts", "f 3 b1\n").revise();
  let steps = 0;
  const pass = daemonPass(tree, {
    policy: () => loadPolicy(tree.root).policy,
    coverage: {
      main: freshStore(),
      closures: () => null,
      writing: () => {
        steps++;
        return false;
      },
    },
  });
  pass.code.nudge();
  await pass.code.idle();
  await pass.code.close();
  const store = open(tree.commonDir);
  return {
    steps,
    measures: store.states.list(WT).map((s) => s.measure),
    summary: readSummary(store.meta, WT),
  };
}

/** The registration's code line, by `config`. */
async function codeLine(config: Record<string, unknown>) {
  const rig = coverageRig();
  write(rig.tree.root, config);
  await rig.edit({ "src/a.ts": "hot 12 h1\n" });
  return (await rig.register(consumer("s1"))).filter((l) => l.startsWith("Complexity:"));
}

describe("coverage off by default (row 015-89)", () => {
  it.each(UNSET)("with %s, makes no coverage step and keeps only complexity", async (_, config) => {
    expect(await passed(config)).toEqual({ steps: 0, measures: ["complexity"], summary: null });
  });

  it.each(UNSET)("with %s, says nothing of coverage at the session start", async (_, config) => {
    expect(await codeLine(config)).toEqual([
      "Complexity: 0 functions over 20; squeal code lists them.",
    ]);
  });

  it("with coverage.enabled true, steps, keeps both coverage states and says the sentence", async () => {
    const run = await passed(ON);
    expect(run.steps).toBe(1);
    expect(run.measures).toEqual(["complexity", "crap", "uncovered"]);
    expect(run.summary).not.toBeNull();
    expect(await codeLine(ON)).toEqual([
      "Complexity: 0 functions over 20; squeal code lists them. Coverage comes from Vitest and node:test runs only; functions that only pytest tests run read not measured.",
    ]);
  });
});
