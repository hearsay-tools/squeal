import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPolicy } from "../../src/core/daemon/policy.js";
import { configProblemsLine } from "../../src/core/status/config-problems.js";
import { ignoredConfigLines, ignoredConfigOf } from "../../src/core/status/ignored-config.js";
import { tempDir } from "../store/helpers.js";

/*
 * Row 011-275 (gh-120; 011 C6, C10): a `squeal.config.json` key a runtime
 * of this worktree does not apply is named apart from the applied
 * configuration, with that runtime's version, what it costs validation when
 * that is known, and the restart or update path. No rule is said to apply.
 */

const OWN = "0.1.383";
const RULE = { project: "e2e", tests: ["e2e/*.e2e.ts"], paths: [".ai/qa/test-env.json"] };
const COST = "extra re-runs: a change to a runtime file it names re-runs the tests that read it";

function rootWith(config: object): string {
  const root = tempDir("squeal-ignored-config-");
  writeFileSync(join(root, "squeal.config.json"), `${JSON.stringify(config)}\n`);
  return root;
}

describe("ignored configuration (011-275)", () => {
  it("an unknown key: named with this runtime's version, not applied, no cost claimed", () => {
    const root = rootWith({ futureKey: { on: true } });

    expect(ignoredConfigOf(root, null, OWN)).toEqual({
      ignoredConfig: [{ key: "futureKey", by: "command", version: OWN }],
    });
    expect(loadPolicy(root).unknownKeys).toEqual(["futureKey"]);
  });

  it("a recognized key beside it is applied and never listed as ignored", () => {
    const root = rootWith({ runner: { tierSize: 2, tierSiz: 3 }, futureKey: 1 });

    expect(ignoredConfigOf(root, null, OWN).ignoredConfig?.map((r) => r.key)).toEqual([
      "runner.tierSiz",
      "futureKey",
    ]);
    expect(loadPolicy(root).policy.runner.tierSize).toBe(2);
  });

  it("only known keys: no ignored part, whatever the daemon's version", () => {
    const root = rootWith({ runner: { tierSize: 2 }, observe: { runtimeInputs: true } });

    expect(ignoredConfigOf(root, null, OWN)).toEqual({});
    expect(ignoredConfigOf(root, "0.1.368", OWN)).toEqual({});
    expect(loadPolicy(root).unknownKeys).toBeUndefined();
  });

  it("an unknown key while the live daemon runs another version: whether it applies is open", () => {
    const root = rootWith({ futureKey: true });

    expect(ignoredConfigOf(root, "0.1.390", OWN)).toEqual({
      ignoredConfig: [{ key: "futureKey", by: "command", version: OWN, daemonVersion: "0.1.390" }],
    });
    expect(ignoredConfigOf(root, OWN, OWN).ignoredConfig?.[0]).not.toHaveProperty("daemonVersion");
  });

  it("runtimeFiles beside a daemon older than 0.1.369: the daemon's version and the known cost", () => {
    const root = rootWith({ runtimeFiles: [RULE] });

    expect(ignoredConfigOf(root, "0.1.368", OWN)).toEqual({
      ignoredConfig: [
        { key: "runtimeFiles", by: "daemon", version: "0.1.368", addedIn: "0.1.369", cost: COST },
      ],
    });
  });

  it("no daemon claim for runtimeFiles at its default, a daemon that knows it, or an unknown version", () => {
    expect(ignoredConfigOf(rootWith({ runtimeFiles: [] }), "0.1.368", OWN)).toEqual({});
    const root = rootWith({ runtimeFiles: [RULE] });
    for (const daemon of ["0.1.369", "0.1.370", "0.0.0-unknown", null])
      expect(ignoredConfigOf(root, daemon, OWN)).toEqual({});
  });

  it("text: one line per runtime that ignores keys, each naming what the JSON names", () => {
    const root = rootWith({ runtimeFiles: [RULE], futureKey: true, other: 1 });
    const result = ignoredConfigOf(root, "0.1.368", OWN);

    expect(ignoredConfigLines(result, "squeal", OWN)).toEqual([
      `Not applied: squeal.config.json keys "futureKey", "other" are unknown to squeal ${OWN}, the version that read them here: typos, or keys a newer Squeal added. Validation goes on without them; the daemon runs squeal 0.1.368, and whether it applies them is not known. \`squeal setup --check\` names each problem; \`squeal update\` installs the newest Squeal, and a session keeps the version it started on until it restarts.`,
      `Not applied: squeal.config.json key "runtimeFiles": the daemon runs squeal 0.1.368, older than 0.1.369, which added it. Cost: ${COST}. \`squeal stop\`, then \`squeal start\`, starts squeal ${OWN} in its place.`,
    ]);
    expect(ignoredConfigLines({}, "squeal", OWN)).toEqual([]);
  });

  it("text: one unknown key, the live daemon on this version", () => {
    const result = ignoredConfigOf(rootWith({ futureKey: true }), OWN, OWN);

    expect(ignoredConfigLines(result, "squeal", OWN)).toEqual([
      `Not applied: squeal.config.json key "futureKey" is unknown to squeal ${OWN}, the version that read it here: a typo, or a key a newer Squeal added. Validation goes on without it. \`squeal setup --check\` names each problem; \`squeal update\` installs the newest Squeal, and a session keeps the version it started on until it restarts.`,
    ]);
  });

  it("the Config problem line leaves out the unknown keys the ignored line names", () => {
    const root = rootWith({ futureKey: true, runner: { tierSize: 0 } });
    const result = {
      configProblems: loadPolicy(root).problems,
      ...ignoredConfigOf(root, null, OWN),
    };

    expect(result.configProblems).toEqual([
      'unknown key "futureKey"',
      '"runner.tierSize" must be a positive integer, got 0',
    ]);
    expect(configProblemsLine(result, "squeal")).toEqual([
      'Config problem: squeal.config.json: "runner.tierSize" must be a positive integer, got 0; the defaults apply in their place (`squeal setup --check` names each)',
    ]);
    expect(
      configProblemsLine({ ...result, configProblems: ['unknown key "futureKey"'] }, "squeal"),
    ).toEqual([]);
  });
});
