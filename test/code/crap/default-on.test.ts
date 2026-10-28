import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSummary } from "../../../src/core/code/crap/index.js";
import { loadPolicy } from "../../../src/core/daemon/policy.js";
import { freshStore, WT } from "../../state/helpers.js";
import { open } from "../helpers.js";
import { daemonPass, worktree } from "../pass/helpers.js";
import { consumer, coverageRig } from "./rig.js";

/* Omitted and empty coverage settings enable the same daemon states and
 * session guidance as explicit true. Explicit false still opts out.
 */

const PYTEST = { pytest: [{ name: "py", include: ["tests/test_*.py"] }] };

const UNSET: readonly [string, Record<string, unknown>][] = [
  ["no code key at all", PYTEST],
  ["empty coverage", { ...PYTEST, coverage: {} }],
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

describe("coverage on by default", () => {
  it.each([...UNSET, ["explicit true", ON] as const])(
    "with %s, collects coverage, keeps both checks and gives session guidance",
    async (_, config) => {
      const run = await passed(config);
      expect(run.steps).toBe(1);
      expect(run.measures).toEqual(["complexity", "crap", "uncovered"]);
      expect(run.summary).not.toBeNull();
      expect(await codeLine(config)).toEqual([
        "Complexity: 0 functions over 20; squeal code lists them. Coverage comes from Vitest and node:test runs only; functions that only pytest tests run read not measured.",
      ]);
    },
  );

  it("with explicit false, skips coverage and keeps only complexity", async () => {
    const config = { ...PYTEST, coverage: { enabled: false } };
    expect(await passed(config)).toEqual({ steps: 0, measures: ["complexity"], summary: null });
    expect(await codeLine(config)).toEqual([
      "Complexity: 0 functions over 20; squeal code lists them.",
    ]);
  });

  it.each([...UNSET, ["explicit true", ON] as const])(
    "with %s and complexity disabled, collects no coverage or code states",
    async (_, config) => {
      const disabled = { ...config, complexity: { enabled: false } };
      expect(await passed(disabled)).toEqual({ steps: 0, measures: [], summary: null });
      expect(await codeLine(disabled)).toEqual([]);
    },
  );
});
