import { describe, expect, it } from "vitest";
import {
  partsRefusal,
  type RefusalKind,
  type RunRefusalKind,
} from "../../../src/core/ci/export-check.js";
import { PART_FORMAT, type Part, type PartProject } from "../../../src/core/ci/parts.js";
import { environmentCheck } from "../../../src/core/code/gate/parts-environment.js";
import { configFieldHash } from "../../../src/core/keys/environment-descriptor.js";
import { KEY_FORMAT_VERSION } from "../../../src/core/keys/key-format.js";
import type { RunnerEnvironment } from "../../../src/core/types/runner.js";
import { ENVIRONMENT, GATE, observedAt, partProject, RUNNER } from "./parts-fixture.js";

/*
 * Spec 020 D13.2 (amended 2026-11-10; reviews 0.1.427 B1 and 0.1.427-r2
 * B1, rows 020-08b R1 and R2): a part's run of a project gives evidence
 * only where `ci export` would take it at its job, by the one rule both
 * apply (`reuseRefusal`), at the environment the gate's runner has. The
 * end-to-end cases with a real `ci record` are in
 * `test/cli/code-gate-parts-cases.test.ts`.
 */

const COMMIT = "a".repeat(40);

/** A completed part of this key format at `COMMIT`, holding `projects`. */
function holding(projects: PartProject[], header: Partial<Part["header"]> = {}): Part {
  return {
    format: PART_FORMAT,
    header: {
      squealVersion: "0.0.0-test",
      keyFormat: KEY_FORMAT_VERSION,
      runner: "vitest",
      runnerVersion: "5.0.3",
      commit: COMMIT,
      dirty: false,
      shard: { index: 1, count: 1 },
      createdAt: 0,
      source: { kind: "local" },
      end: "completed",
      observing: true,
      ...header,
    },
    projects,
    testFiles: [],
    evidence: {},
  };
}

/** Why `part`'s project `""` gives no evidence against the runner and gate given. */
async function checked(
  part: Part,
  gate = GATE,
  runners: () => Promise<readonly RunnerEnvironment[]> = ENVIRONMENT,
): Promise<string | null> {
  return (await environmentCheck(runners, gate))({ file: "p.json", part }, "");
}

/** The reason of a project whose run had another environment. */
const other = (texts: string) =>
  `p.json ran project "" in another environment than this gate's: ${texts} (the export as p.json's, here as this gate's)`;

describe("environmentCheck: the environment a part's project ran in (spec 020 D13.2)", () => {
  it("certifies the gate's environment, the observing suffix and the CI fields aside", async () => {
    const config = JSON.parse(RUNNER.resolvedConfig) as Record<string, unknown>;
    // Squeal's own instance runs its coverage provider, a field D10 lets differ.
    const gate = { ...RUNNER, resolvedConfig: JSON.stringify({ ...config, coverage: { x: 1 } }) };
    expect(await checked(holding([partProject()]), GATE, async () => [gate])).toBeNull();
  });

  it("certifies a gate runner that observes, as it does when its runs may be kept", async () => {
    // Spec 020 D17.3 (row 020-17c): the suffix is there already, and is not added twice.
    const observing = { ...RUNNER, adapterVersion: `${RUNNER.adapterVersion}+observe.6` };
    expect(GATE.observedAdapterVersion(RUNNER.adapterVersion)).toBe(observing.adapterVersion);
    expect(await checked(holding([partProject()]), GATE, async () => [observing])).toBeNull();
  });

  it("certifies a variable off the allow-list at another value", async () => {
    const gate = { ...GATE, env: { PROBE: "yes", OTHER: "y" } };
    expect(await checked(holding([partProject()]), gate)).toBeNull();
  });

  it("names an allow-listed variable at another value, or set on one side only", async () => {
    const no = { ...GATE, env: { PROBE: "no" } };
    expect(await checked(holding([partProject()]), no)).toBe(
      other("allow-listed variables differ (values: PROBE)"),
    );
    expect(await checked(holding([partProject()]), { ...GATE, env: {} })).toBe(
      other("allow-listed variables differ (names: PROBE)"),
    );
  });

  it("names a runner, Node or config field that differs", async () => {
    const node = partProject();
    const older = { ...node, descriptor: { ...node.descriptor, nodeVersion: "v1.0.0" } };
    expect(await checked(holding([older]))).toMatch(
      /: Node v1\.0\.0 in the export, v\d+\.\d+\.\d+ here /,
    );
    const gate = { ...RUNNER, runnerVersion: "5.0.4" };
    expect(await checked(holding([partProject()]), GATE, async () => [gate])).toBe(
      other("runner version 5.0.3 in the export, 5.0.4 here"),
    );
    const config = { ...node.descriptor.config, testTimeout: configFieldHash(1) };
    const timed = { ...node, descriptor: { ...node.descriptor, config } };
    expect(await checked(holding([timed]))).toBe(other("config fields testTimeout differ"));
  });

  it("names another recorder version, which keys what a run observed", async () => {
    expect(
      await checked(holding([partProject()]), { ...GATE, observedAdapterVersion: observedAt("7") }),
    ).toBe(other("adapter version 9+observe.6 in the export, 9+observe.7 here"));
  });

  it("gives no evidence of a project the part or the gate's runner lacks", async () => {
    expect(await checked(holding([]))).toBe(`p.json holds no environment of project ""`);
    const unit = async () => [{ ...RUNNER, project: "unit" }];
    expect(await checked(holding([partProject()]), GATE, unit)).toBe(
      `the gate's Vitest has no project "", which p.json ran`,
    );
  });

  it("gives no evidence when the runner gives no environment", async () => {
    const failing = async (): Promise<RunnerEnvironment[]> => {
      throw new Error("no config");
    };
    expect(await checked(holding([partProject()]), GATE, failing)).toBe(
      "the gate's runner gave no environment (no config)",
    );
    const none = await environmentCheck(undefined, GATE);
    expect(none({ file: "p.json", part: holding([partProject()]) }, "")).toBe(
      "the gate's runner gave no environment to compare",
    );
  });
});

/** `partProject()` with `change` over its own fields. */
const run = (change: Partial<PartProject>): PartProject => ({ ...partProject(), ...change });

/**
 * Review 0.1.427-r2 B1: every refusal `reuseRefusal` makes, each with a part
 * that makes it at the gate's environment. A refusal kind added to the rule
 * fails to typecheck here until it has a case, which the gate must make.
 */
const REFUSED: Record<RunRefusalKind, readonly [string, Part, string][]> = {
  "key-format": [
    [
      "another key format",
      holding([partProject()], { keyFormat: KEY_FORMAT_VERSION + 1 }),
      `p.json was made with key format ${KEY_FORMAT_VERSION + 1}`,
    ],
  ],
  incomplete: [
    ["a crashed run", holding([partProject()], { end: "crashed" }), "did not complete (crashed)"],
  ],
  snapshot: ["all", "new", "unknown"].map((mode) => [
    `snapshot update "${mode}"`,
    holding([run({ updateSnapshot: mode })]),
    `p.json ran project "" with snapshot update "${mode}"`,
  ]),
  environment: [
    ["no descriptor of the project", holding([]), `holds no environment of project ""`],
    [
      "another Node",
      holding([run({ descriptor: { ...partProject().descriptor, nodeVersion: "v1.0.0" } })]),
      "Node v1.0.0 in the export",
    ],
  ],
};

/**
 * The export's refusals of a set of parts, none of one run: the gate takes
 * each file from the one part that holds it and certifies every input by
 * its content here, not by a commit.
 */
const SET_ONLY: Record<Exclude<RefusalKind, RunRefusalKind>, string> = {
  "no-commit": "an export names the commit its keys are of",
  commits: "an export is of one commit",
  checkout: "an export's keys are of the checkout's commit",
  shards: "an export holds every shard of one run",
  duplicate:
    "an export holds one result per file; the gate takes a file two parts hold from neither",
};

describe("reuseRefusal: one rule for ci export and the gate (review 0.1.427-r2 B1)", () => {
  const cases = Object.entries(REFUSED).flatMap(([kind, list]) =>
    list.map(([name, part, text]) => ({ kind, name, part, text })),
  );

  it.each(cases)("refuses $kind in both commands: $name", async ({ kind, part, text }) => {
    expect(await checked(part)).toContain(text);
    // The export makes each refusal of a run before its job's runner is
    // open, but the comparison with the job's environment, which it makes
    // once it is (`export-keys.test.ts`).
    const exported = partsRefusal([{ file: "p.json", part }], COMMIT);
    const made = exported === null ? null : [exported.kind, exported.text.includes(text)];
    expect(made).toEqual(kind === "environment" ? null : [kind, true]);
  });

  it("takes the part every case varies, at the gate's environment and in the export", async () => {
    const part = holding([partProject()]);
    expect(await checked(part)).toBeNull();
    expect(partsRefusal([{ file: "p.json", part }], COMMIT)).toBeNull();
  });

  it("names every other export refusal as one of a set of parts", () => {
    // `SET_ONLY` typechecks only when it and `REFUSED` hold every kind between them.
    expect(Object.keys(SET_ONLY).sort()).toEqual([
      "checkout",
      "commits",
      "duplicate",
      "no-commit",
      "shards",
    ]);
  });
});
