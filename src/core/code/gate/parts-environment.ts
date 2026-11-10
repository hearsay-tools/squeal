import { type RunView, runDifferences } from "../../ci/export-check.js";
import { type Part, snapshotFields } from "../../ci/parts.js";
import { coreEnvironmentInputs } from "../../keys/environment.js";
import { describeEnvironment, sawCi } from "../../keys/environment-descriptor.js";
import { KEY_FORMAT_VERSION } from "../../keys/key-format.js";
import type { ProjectName } from "../../types/common.js";
import type { RunnerEnvironment } from "../../types/runner.js";

/*
 * Spec 020 D13.2 (amended 2026-11-10, review 0.1.427 B1; row 020-08b R1):
 * a part's evidence of a file stands here only when the part's project ran
 * in the environment the gate's runner has now, compared as `ci export`
 * compares a shard's with its job's (`runDifferences`: 018 D9, D10). An
 * allow-listed variable, Node, the platform, the runner's version and its
 * resolved config must match; the fields Squeal sets for its own instance
 * and the ones D10 lets `CI` change are left out. The gate's runner does
 * not observe and a part's run did, so the gate's adapter version is
 * compared with the recorder's suffix this Squeal adds.
 */

/** What the gate's environment of a project holds beside its runner's own. */
export interface GateEnvironment {
  /** The variables the gate's runs see; the allow-listed ones are compared. */
  readonly env: NodeJS.ProcessEnv;
  /** Policy `env.allowlist` here, as the daemon and `ci record` read it. */
  readonly allowlist: readonly string[];
  /**
   * This Squeal's runtime-input recorder version: a part's run observed,
   * and its adapter version carries `+observe.<version>`, as
   * `VitestObserver.adapterVersion` adds it.
   */
  readonly recorderVersion: string;
}

/** Why a part's project gives no evidence here; `null` when its environment is the gate's. */
export type Certify = (part: Part, project: ProjectName) => string | null;

/**
 * The gate runner's environments, from `runners` (the adapter's
 * `environment()`), as a part's project is compared: why none, or the
 * check of a part's project against them, which names each difference.
 */
export async function environmentCheck(
  runners: (() => Promise<readonly RunnerEnvironment[]>) | undefined,
  gate: GateEnvironment,
): Promise<Certify> {
  const here = await gateViews(runners, gate);
  if (typeof here === "string") return () => here;
  const told = new Map<Part, Map<ProjectName, string | null>>();
  return (part, project) => {
    const held = told.get(part) ?? new Map<ProjectName, string | null>();
    told.set(part, held);
    if (!held.has(project)) held.set(project, compared(part, project, here));
    return held.get(project) ?? null;
  };
}

/** Each project's view as `runDifferences` reads it, or why the runner gives none. */
async function gateViews(
  runners: (() => Promise<readonly RunnerEnvironment[]>) | undefined,
  gate: GateEnvironment,
): Promise<ReadonlyMap<ProjectName, RunView> | string> {
  if (runners === undefined) return "the gate's runner gave no environment to compare";
  let environments: readonly RunnerEnvironment[];
  try {
    environments = await runners();
  } catch (error) {
    return `the gate's runner gave no environment (${error instanceof Error ? error.message : String(error)})`;
  }
  const core = coreEnvironmentInputs({
    squealVersion: "",
    installedDependencies: "none",
    allowlist: gate.allowlist,
    env: gate.env,
  });
  const ci = sawCi(gate.env);
  const views = new Map<ProjectName, RunView>();
  for (const runner of environments) {
    const observed = {
      ...runner,
      adapterVersion: `${runner.adapterVersion}+observe.${gate.recorderVersion}`,
    };
    views.set(runner.project, {
      descriptor: describeEnvironment(KEY_FORMAT_VERSION, core, observed, [], ci),
      snapshotOptions: snapshotFields(runner.resolvedConfig),
    });
  }
  return views;
}

function compared(
  part: Part,
  project: ProjectName,
  here: ReadonlyMap<ProjectName, RunView>,
): string | null {
  const run = part.projects.find((p) => p.descriptor.project === project);
  if (run === undefined) return "it holds no environment of the project";
  const view = here.get(project);
  if (view === undefined) return "the gate's Vitest has no such project";
  const differences = runDifferences(run, view);
  if (differences.length === 0) return null;
  const texts = differences.map((d) => d.text).join("; ");
  return `its run had another environment than this gate's: ${texts} (the part as the export)`;
}
