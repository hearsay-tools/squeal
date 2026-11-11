import { type NamedPart, type Place, type RunView, reuseRefusal } from "../../ci/export-check.js";
import { type Part, snapshotFields } from "../../ci/parts.js";
import { coreEnvironmentInputs } from "../../keys/environment.js";
import { describeEnvironment, sawCi } from "../../keys/environment-descriptor.js";
import { KEY_FORMAT_VERSION } from "../../keys/key-format.js";
import type { ProjectName } from "../../types/common.js";
import type { RunnerEnvironment } from "../../types/runner.js";

/*
 * Spec 020 D13.2 (amended 2026-11-10, review 0.1.427 B1; rows 020-08b R1,
 * R2): a part's evidence of a file stands here only when the part's run of
 * the file's project is evidence at the gate's runner by the rule `ci
 * export` applies to a shard at its job, `reuseRefusal` (018 D9, D10; the
 * human, 2026-11-10: one owner). The run must be of this key format, have
 * completed and have written no snapshot. An allow-listed variable, Node,
 * the platform, the runner's version and its resolved config must match;
 * the fields Squeal sets for its own instance and the ones D10 lets `CI`
 * change are left out. A part's run observed; the gate's runner observes
 * only when its runs may be kept (D17.3, row 020-17c), so the gate's
 * adapter version is compared with the recorder's suffix this Squeal adds,
 * added when it lacks it.
 */

/** What the gate's environment of a project holds beside its runner's own. */
export interface GateEnvironment {
  /** The variables the gate's runs see; the allow-listed ones are compared. */
  readonly env: NodeJS.ProcessEnv;
  /** Policy `env.allowlist` here, as the daemon and `ci record` read it. */
  readonly allowlist: readonly string[];
  /**
   * The adapter version an observing run carries, from its `base`, as
   * this Squeal's recorder adds it (`observedAdapterVersion`): a part's
   * run observed. The CLI passes it, since the core imports no runner.
   */
  readonly observedAdapterVersion: (base: string) => string;
}

/** Why a part's run of a project gives no evidence here; `null` when it may. */
export type Certify = (named: NamedPart, project: ProjectName) => string | null;

/**
 * The gate runner's environments, from `runners` (the adapter's
 * `environment()`), as the place a part's run is evidence at: why none, or
 * the check of a part's run of a project there (`reuseRefusal`).
 */
export async function environmentCheck(
  runners: (() => Promise<readonly RunnerEnvironment[]>) | undefined,
  gate: GateEnvironment,
): Promise<Certify> {
  const here = await gatePlace(runners, gate);
  if (typeof here === "string") return () => here;
  const told = new Map<Part, Map<ProjectName, string | null>>();
  return (named, project) => {
    const held = told.get(named.part) ?? new Map<ProjectName, string | null>();
    told.set(named.part, held);
    if (!held.has(project)) held.set(project, reuseRefusal(named, here, project)?.text ?? null);
    return held.get(project) ?? null;
  };
}

/** Each project's run as the gate's runner has it, or why the runner gives none. */
async function gatePlace(
  runners: (() => Promise<readonly RunnerEnvironment[]>) | undefined,
  gate: GateEnvironment,
): Promise<Place | string> {
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
  const runs = new Map<ProjectName, RunView>();
  for (const runner of environments) {
    const observed = {
      ...runner,
      adapterVersion: gate.observedAdapterVersion(runner.adapterVersion),
    };
    runs.set(runner.project, {
      descriptor: describeEnvironment(KEY_FORMAT_VERSION, core, observed, [], ci),
      snapshotOptions: snapshotFields(runner.resolvedConfig),
    });
  }
  return { name: "this gate's", runner: "the gate's Vitest", runs };
}
