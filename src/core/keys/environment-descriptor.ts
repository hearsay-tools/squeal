import { createHash } from "node:crypto";
import { compare } from "../fs/compare.js";
import type { ProjectName, RelativePath } from "../types/common.js";
import type { CoreEnvironmentInputs, FileHash } from "../types/keys.js";
import type { RunnerEnvironment } from "../types/runner.js";

/**
 * The parts of one environment hash (spec 018 D1), so a person can see which
 * part two hashes differ in. Built by `environmentRecord` from the inputs the
 * hash encodes, in the same call. It never holds the value of an allow-listed
 * variable or of a config field: those are hashed, so a descriptor can leave
 * the machine in an export.
 */
export interface EnvironmentDescriptor {
  readonly keyFormat: number;
  readonly project: ProjectName;
  readonly runnerName: string;
  readonly runnerVersion: string;
  readonly adapterVersion: string;
  /** `process.version`, as the hash holds it. */
  readonly nodeVersion: string;
  readonly platform: string;
  readonly arch: string;
  /** The installed-dependency fingerprint, itself a hash; `"none"` without an install. */
  readonly installedDependencies: string;
  /** The allow-listed variables that are set: their sorted names and one hash over names and values. */
  readonly env: { readonly names: readonly string[]; readonly hash: string };
  /** One hash per top-level field of the resolved runner config, by field name. */
  readonly config: Readonly<Record<string, string>>;
  /** Config and setup files, sorted, with the file hash the environment hash holds; `null` is absent. */
  readonly files: readonly (readonly [RelativePath, FileHash | null])[];
  /** Whether the process saw a CI environment. A hint for the difference text; in no hash. */
  readonly ci: boolean;
}

/** The config field name of a resolved config that is not a JSON object. */
export const WHOLE_CONFIG = "(config)";

/** The descriptor of the inputs `environmentHash` encodes: `files` are its hashed runner files. */
export function describeEnvironment(
  format: number,
  core: CoreEnvironmentInputs,
  runner: RunnerEnvironment,
  files: readonly (readonly [RelativePath, FileHash | null])[],
  ci: boolean,
): EnvironmentDescriptor {
  const env = Object.entries(core.env).sort(([a], [b]) => compare(a, b));
  return {
    keyFormat: format,
    project: runner.project,
    runnerName: runner.runnerName,
    runnerVersion: runner.runnerVersion,
    adapterVersion: runner.adapterVersion,
    nodeVersion: core.nodeVersion,
    platform: core.platform,
    arch: core.arch,
    installedDependencies: core.installedDependencies,
    env: { names: env.map(([name]) => name), hash: digest(JSON.stringify(env)) },
    config: configFields(runner.resolvedConfig),
    files: files.map(([path, hash]) => [path, hash] as const),
    ci,
  };
}

/** One hash per top-level field of a resolved config; runners give canonical JSON, so equal values serialize equally. */
function configFields(resolvedConfig: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(configObject(resolvedConfig)).sort(([a], [b]) =>
    compare(a, b),
  )) {
    fields[name] = digest(JSON.stringify(value));
  }
  return fields;
}

/** The resolved config as an object; anything but a JSON object is one field, `WHOLE_CONFIG`. */
function configObject(resolvedConfig: string): object {
  try {
    const parsed: unknown = JSON.parse(resolvedConfig);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed;
  } catch {
    // Not JSON: a test's fake runner gives one.
  }
  return { [WHOLE_CONFIG]: resolvedConfig };
}

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Variables CI services set, beside `CI`, as std-env (which Vitest reads) detects them. */
const CI_SERVICE_VARIABLES = [
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "CIRCLECI",
  "BUILDKITE",
  "TF_BUILD",
  "JENKINS_URL",
  "TEAMCITY_VERSION",
  "BITBUCKET_COMMIT",
  "DRONE_BUILD_EVENT",
] as const;

/**
 * Whether `env` describes a CI environment: `CI` set to anything but empty or
 * `"false"` (std-env's reading), or a variable a common CI service sets. A
 * hint only (D1): the runner's own reading is what its config holds.
 */
export function sawCi(env: NodeJS.ProcessEnv): boolean {
  const ci = env.CI;
  if (ci !== undefined && ci !== "" && ci !== "false") return true;
  return CI_SERVICE_VARIABLES.some((name) => (env[name] ?? "") !== "");
}

/** A part of `EnvironmentDescriptor` two descriptors can differ in, in the order differences are named. */
export type DifferencePart =
  | "keyFormat"
  | "project"
  | "runnerName"
  | "runnerVersion"
  | "adapterVersion"
  | "nodeVersion"
  | "platform"
  | "arch"
  | "installedDependencies"
  | "env"
  | "config"
  | "files";

/** One part two descriptors differ in. */
export interface Difference {
  readonly part: DifferencePart;
  /** A plain part's value in the first descriptor and in the second. */
  readonly values?: readonly [string, string];
  /** A hashed part's names that differ: variable names, config fields or file paths. */
  readonly names?: readonly string[];
  /** One line for a person, the first descriptor as the export and the second as here. */
  readonly text: string;
}

/** The plain parts with the word that names each in the text. */
const PLAIN: readonly (readonly [DifferencePart & keyof EnvironmentDescriptor, string])[] = [
  ["keyFormat", "key format"],
  ["project", "project"],
  ["runnerName", "runner"],
  ["runnerVersion", "runner version"],
  ["adapterVersion", "adapter version"],
  ["nodeVersion", "Node"],
  ["platform", "platform"],
  ["arch", "arch"],
];

/** Names a list shows before it says how many more there are. */
const SHOWN = 5;

/**
 * The parts `a` (an export's environment) and `b` (this worktree's) differ
 * in, in `DifferencePart` order; empty when every part is equal, so the two
 * hashes are equal (018 D1). Plain parts name both values, hashed parts the
 * names that differ. When `a` saw a CI environment, `b` did not and only
 * config fields differ, the text says so, since Vitest derives fields from CI.
 */
export function describeDifferences(
  a: EnvironmentDescriptor,
  b: EnvironmentDescriptor,
): Difference[] {
  const differences: Difference[] = [];
  for (const [part, word] of PLAIN) {
    const [x, y] = [String(a[part]), String(b[part])];
    if (x === y) continue;
    const shown = part === "project" ? [JSON.stringify(x), JSON.stringify(y)] : [x, y];
    differences.push({
      part,
      values: [x, y],
      text: `${word} ${shown[0]} in the export, ${shown[1]} here`,
    });
  }
  if (a.installedDependencies !== b.installedDependencies) {
    differences.push({ part: "installedDependencies", text: installedText(a, b) });
  }
  if (a.env.hash !== b.env.hash) differences.push(envDifference(a.env.names, b.env.names));
  const fields = differingNames(
    new Map(Object.entries(a.config)),
    new Map(Object.entries(b.config)),
  );
  const files = differingNames(new Map(a.files), new Map(b.files));
  if (fields.length > 0) {
    const onlyFields = differences.length === 0 && files.length === 0;
    const ci = a.ci && !b.ci && onlyFields ? " (the export ran with CI set)" : "";
    differences.push({
      part: "config",
      names: fields,
      text: `config fields ${listed(fields)} differ${ci}`,
    });
  }
  if (files.length > 0) {
    differences.push({
      part: "files",
      names: files,
      text: `config and setup files differ: ${listed(files)}`,
    });
  }
  return differences;
}

function installedText(a: EnvironmentDescriptor, b: EnvironmentDescriptor): string {
  if (a.installedDependencies === "none") return "no installed dependencies in the export";
  if (b.installedDependencies === "none") return "no installed dependencies here";
  return "installed dependencies differ";
}

/** Names set on one side only; with equal names, a value differs, and the hash cannot say which. */
function envDifference(a: readonly string[], b: readonly string[]): Difference {
  const ours = new Set(b);
  const theirs = new Set(a);
  const apart = [...new Set([...a, ...b])].filter((n) => !ours.has(n) || !theirs.has(n));
  if (apart.length > 0) {
    return {
      part: "env",
      names: apart.sort(compare),
      text: `allow-listed variables differ (names: ${listed(apart)})`,
    };
  }
  return {
    part: "env",
    names: [...b],
    text: `allow-listed variables differ (values: ${listed(b)})`,
  };
}

/** The sorted names whose hash differs or that one side lacks. */
function differingNames<T>(a: ReadonlyMap<string, T>, b: ReadonlyMap<string, T>): string[] {
  const names = new Set([...a.keys(), ...b.keys()]);
  return [...names].filter((n) => !a.has(n) || !b.has(n) || a.get(n) !== b.get(n)).sort(compare);
}

function listed(names: readonly string[]): string {
  const shown = names.slice(0, SHOWN).join(", ");
  return names.length > SHOWN ? `${shown} and ${names.length - SHOWN} more` : shown;
}
