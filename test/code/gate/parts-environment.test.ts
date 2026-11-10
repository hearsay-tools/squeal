import { describe, expect, it } from "vitest";
import type { Part, PartProject } from "../../../src/core/ci/parts.js";
import { environmentCheck } from "../../../src/core/code/gate/parts-environment.js";
import { configFieldHash } from "../../../src/core/keys/environment-descriptor.js";
import type { RunnerEnvironment } from "../../../src/core/types/runner.js";
import { ENVIRONMENT, GATE, partProject, RUNNER } from "./parts-fixture.js";

/*
 * Spec 020 D13.2 (amended 2026-11-10; review 0.1.427 B1, row 020-08b R1):
 * a part's project gives evidence only in the environment the gate's
 * runner has, compared as `ci export` compares a shard's with its job's.
 * The end-to-end case with a real `ci record` is in
 * `test/cli/code-gate-parts-cases.test.ts`.
 */

/** A part holding `projects`; nothing else is read. */
const holding = (...projects: PartProject[]) => ({ projects }) as unknown as Part;

/** Why `part`'s project `""` gives no evidence against the runner and gate given. */
async function checked(
  part: Part,
  gate = GATE,
  runners: () => Promise<readonly RunnerEnvironment[]> = ENVIRONMENT,
): Promise<string | null> {
  return (await environmentCheck(runners, gate))(part, "");
}

/** The reason of a project whose run had another environment. */
const other = (texts: string) =>
  `its run had another environment than this gate's: ${texts} (the part as the export)`;

describe("environmentCheck: the environment a part's project ran in (spec 020 D13.2)", () => {
  it("certifies the gate's environment, the observing suffix and the CI fields aside", async () => {
    const config = JSON.parse(RUNNER.resolvedConfig) as Record<string, unknown>;
    // Squeal's own instance runs its coverage provider, a field D10 lets differ.
    const gate = { ...RUNNER, resolvedConfig: JSON.stringify({ ...config, coverage: { x: 1 } }) };
    expect(await checked(holding(partProject()), GATE, async () => [gate])).toBeNull();
  });

  it("certifies a variable off the allow-list at another value", async () => {
    const gate = { ...GATE, env: { PROBE: "yes", OTHER: "y" } };
    expect(await checked(holding(partProject()), gate)).toBeNull();
  });

  it("names an allow-listed variable at another value, or set on one side only", async () => {
    const no = { ...GATE, env: { PROBE: "no" } };
    expect(await checked(holding(partProject()), no)).toBe(
      other("allow-listed variables differ (values: PROBE)"),
    );
    expect(await checked(holding(partProject()), { ...GATE, env: {} })).toBe(
      other("allow-listed variables differ (names: PROBE)"),
    );
  });

  it("names a runner, Node or config field that differs", async () => {
    const node = partProject();
    const older = { ...node, descriptor: { ...node.descriptor, nodeVersion: "v1.0.0" } };
    expect(await checked(holding(older))).toMatch(
      /: Node v1\.0\.0 in the export, v\d+\.\d+\.\d+ here /,
    );
    const gate = { ...RUNNER, runnerVersion: "5.0.4" };
    expect(await checked(holding(partProject()), GATE, async () => [gate])).toBe(
      other("runner version 5.0.3 in the export, 5.0.4 here"),
    );
    const config = { ...node.descriptor.config, testTimeout: configFieldHash(1) };
    const timed = { ...node, descriptor: { ...node.descriptor, config } };
    expect(await checked(holding(timed))).toBe(other("config fields testTimeout differ"));
  });

  it("names another recorder version, which keys what a run observed", async () => {
    expect(await checked(holding(partProject()), { ...GATE, recorderVersion: "7" })).toBe(
      other("adapter version 9+observe.6 in the export, 9+observe.7 here"),
    );
  });

  it("gives no evidence of a project the part or the gate's runner lacks", async () => {
    expect(await checked(holding())).toBe("it holds no environment of the project");
    const unit = async () => [{ ...RUNNER, project: "unit" }];
    expect(await checked(holding(partProject()), GATE, unit)).toBe(
      "the gate's Vitest has no such project",
    );
  });

  it("gives no evidence when the runner gives no environment", async () => {
    const failing = async (): Promise<RunnerEnvironment[]> => {
      throw new Error("no config");
    };
    expect(await checked(holding(partProject()), GATE, failing)).toBe(
      "the gate's runner gave no environment (no config)",
    );
    const none = await environmentCheck(undefined, GATE);
    expect(none(holding(partProject()), "")).toBe(
      "the gate's runner gave no environment to compare",
    );
  });
});
