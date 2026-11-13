import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createCompositeRunner } from "../../src/core/daemon/composite-runner.js";
import { afterEachRun, EscapedChildren } from "../../src/core/daemon/escaped.js";
import { IdleGc } from "../../src/core/daemon/idle-gc.js";
import { createNodeTestRunners } from "../../src/core/daemon/node-test-runners.js";
import { createPytestRunners } from "../../src/core/daemon/pytest-runners.js";
import { createRecoveringRunner } from "../../src/core/daemon/runner.js";
import { withSlowInstance } from "../../src/core/daemon/slow-instance.js";
import { withRemoteLane } from "../../src/core/runner-host/remote/lane.js";
import type { AbsolutePath, EpochMs } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { RunnerAdapter } from "../../src/core/types/runner.js";
import { declareTraits, type RunnerTraits } from "../../src/core/types/runner-traits.js";
import { vitestTraits } from "../../src/runners/vitest/traits.js";
import { fakeAdapter } from "../runner-host/fake-channel.js";
import { A, answers, B, DEFAULTS } from "./runner-traits-fixture.js";

/*
 * Row 011-329, the runner traits table: the daemon's chain, assembled as
 * `daemon.ts` assembles it, answers each file from its owner's traits, and
 * a project no member owns yet from the defaults; every layer carries the
 * object it was given; the composite's own rules: lane, part, slow width.
 */

const dir = mkdtempSync(join(tmpdir(), "squeal-traits-chain-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const NT = { project: "nt", path: "nt/a.mjs" };
const PY = { project: "py", path: "py/test_a.py" };
const PB = { project: "pb", path: "pb/test_a.py" };
const OTHER = { project: "other", path: "x.test.ts" };

/** `runner`, its `testFiles` listing one file of `project`: its owner, with no adapter built. */
const owned = (runner: RunnerAdapter, project: string): RunnerAdapter =>
  Object.create(runner, { testFiles: { value: async () => [{ project, path: `${project}/a` }] } });

/** Vitest's recovering runner as the daemon builds each of its instances; none starts here. */
const vitest = () =>
  createRecoveringRunner({
    name: "vitest",
    adapterVersion: "1",
    traits: vitestTraits(),
    create: () => Promise.reject(new Error("not built here")),
    onFailure: () => {},
  });

describe("runner traits by holder: the daemon's chain", () => {
  it("answers each file from its owner's traits, and a project no member owns from the defaults", async () => {
    let tierSize = 4;
    const options = {
      root: dir as AbsolutePath,
      stateDir: dir as AbsolutePath,
      tempDir: dir as AbsolutePath,
      tierSize: () => tierSize,
      note: () => {},
    };
    const project = { cwd: "x", args: [], env: {}, include: ["test_*.py"] };
    const [nt] = createNodeTestRunners(
      [{ name: "nt", cwd: "nt", node: "node", argv: [], env: {}, include: ["*.mjs"] }],
      options,
    );
    const [py, pb] = createPytestRunners(
      [
        { ...project, name: "py" },
        { ...project, name: "pb", batchSize: 2 },
      ],
      options,
    );
    if (nt === undefined || py === undefined || pb === undefined) throw new Error("no runners");
    const composite = createCompositeRunner([
      owned(withSlowInstance(vitest(), vitest, vitest), ""),
      owned(nt, "nt"),
      owned(py, "py"),
      owned(pb, "pb"),
    ]);
    const gc = new IdleGc({ now: () => 0 as EpochMs, note: () => {}, log: () => {} });
    const daemon = gc.track(afterEachRun(composite, new EscapedChildren(), () => {}));
    const none = { ...DEFAULTS, lane: "vitest+node-test+pytest+pytest" };
    // Before a listing no project has an owner: the defaults, in a lane of their own.
    expect(answers(daemon.traits, NT)).toEqual({ ...none, slowWidth: 3 });
    await daemon.testFiles();
    const perProcess = {
      ...DEFAULTS,
      slowWidth: 1,
      tierWidth: 4,
      besideBacklog: true,
      backlogSlot: 1,
    };
    const pytest = { ...perProcess, focuses: true, lane: "pytest" };
    expect(answers(daemon.traits, A)).toEqual({
      ...DEFAULTS,
      tierPart: "0:",
      focuses: true,
      lane: "vitest",
    });
    expect(answers(daemon.traits, NT)).toEqual({
      ...perProcess,
      tierPart: "1:",
      lane: "node-test",
    });
    expect(answers(daemon.traits, PY)).toEqual({ ...pytest, tierPart: "2:", backlogSlot: 5 });
    expect(answers(daemon.traits, PB)).toEqual({ ...pytest, tierPart: "3:", backlogSlot: 2 });
    expect(answers(daemon.traits, OTHER)).toEqual(none);
    tierSize = 6;
    expect([NT, PY, A].map((file) => daemon.traits.tierWidth(file, 8))).toEqual([6, 6, 8]);
    await daemon.close();
  });
});

describe("runner traits: every layer carries the object it was given", () => {
  it("is the inner runner's in the slow instance, afterEachRun, the idle GC's track and the remote lane", async () => {
    const traits = declareTraits({ tierWidth: () => 3 });
    const inner = fakeAdapter({ traits });
    const gc = new IdleGc({ now: () => 0 as EpochMs, note: () => {}, log: () => {} });
    const lane = withRemoteLane({
      target: "box",
      whenLost: "local",
      root: dir,
      version: "0.0.0-test",
      local: inner,
      connect: () => Promise.reject(new Error("no remote here")),
      allowlist: () => [],
      status: () => {},
      log: () => {},
      repository: () => {},
      now: () => 0,
      backoffMs: [60_000],
    });
    const layers: RunnerAdapter[] = [
      withSlowInstance(inner, () => inner),
      afterEachRun(inner, new EscapedChildren(), () => {}),
      gc.track(inner),
      lane,
    ];
    for (const layer of layers) expect(layer.traits).toBe(traits);
    await lane.close();
  });
});

/** A runner named `name` owning `projects`, with `traits`. */
function member(name: string, projects: readonly string[], traits: RunnerTraits): RunnerAdapter {
  return fakeAdapter({
    name,
    traits,
    environment: async () =>
      projects.map((project) => ({
        project,
        runnerName: name,
        runnerVersion: "1.0.0",
        adapterVersion: `${name}-1`,
        resolvedConfig: "{}",
        files: [],
      })),
  });
}

describe("runner traits by holder: the composite across two owners", () => {
  const ref = (project: string, path: string): TestFileRef => ({ project, path });
  const b = ref("b", "b.test.ts");
  const unit = ref("unit", "u.test.ts");

  it("answers the lane, part and slow width from the owner, and the defaults for no owner", async () => {
    const composite = createCompositeRunner([
      member(
        "vitest",
        ["", "b"],
        declareTraits({
          omittedTestFiles: () => 2,
          slowWidth: (files) => Math.min(4, files.length),
          tierWidth: (_, grant) => Math.max(2, grant),
          tierPart: () => "p",
        }),
      ),
      member(
        "node-test",
        ["unit"],
        declareTraits({ omittedTestFiles: () => 3, tierWidth: () => 3 }),
      ),
    ]);
    const { traits } = composite;
    expect([traits.lane(A), traits.tierPart(A), traits.slowWidth([A, B])]).toEqual([
      "vitest+node-test",
      "",
      2,
    ]);
    await composite.environment();
    expect([A, b, unit, OTHER].map((file) => traits.lane(file))).toEqual([
      "vitest",
      "vitest",
      "node-test",
      "vitest+node-test",
    ]);
    // The composite runs its owners in turn, so their files are parts of a tier (review wave-3 B1).
    expect([A, b, unit, OTHER].map((file) => traits.tierPart(file))).toEqual([
      "0:p",
      "0:p",
      "1:",
      "",
    ]);
    // A slow tier starts only the first file's owner's, of its own files (review 001-394 B2).
    expect(traits.slowWidth([A, b, A])).toBe(3);
    expect(traits.slowWidth([A, unit, b])).toBe(1);
    expect(traits.slowWidth([unit, unit, A])).toBe(2);
    expect(traits.slowWidth([OTHER, A])).toBe(2);
    expect([
      traits.tierWidth(A, 1),
      traits.tierWidth(unit, 23),
      traits.tierWidth(OTHER, 5),
    ]).toEqual([2, 3, 5]);
    expect(traits.omittedTestFiles()).toBe(5);
    expect(answers(traits, OTHER)).toEqual({ ...DEFAULTS, omitted: 5, lane: "vitest+node-test" });
  });
});
