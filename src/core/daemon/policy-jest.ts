import { posix } from "node:path";
import type { JestProject } from "../types/policy-jest.js";
import {
  boolean,
  type EntryCheck,
  type Field,
  globs,
  insideRoot,
  nonEmptyString,
  type ProjectEntries,
  projectEntries,
  strings,
  variables,
} from "./policy-node-test.js";

/** The config file extensions Jest 30 reads (`JEST_CONFIG_EXT_ORDER`); Jest 29 reads all but `.mts` and `.cts`. */
const CONFIG_EXTENSIONS: readonly string[] = [
  ".js",
  ".ts",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".json",
];

/** D1: a file inside the worktree, relative to its root. */
const configPath: Field = (v) => nonEmptyString(v) ?? insideRoot(v);

/** D4: files per Jest process; absent means the adapter's default of 5. */
const positiveInteger: Field = (v) =>
  Number.isInteger(v) && (v as number) > 0 ? null : "a positive integer";

/** Every key of `JestProject`; `name` and `config` are required. */
const FIELDS: Readonly<Record<keyof JestProject, Field>> = {
  name: nonEmptyString,
  config: configPath,
  project: nonEmptyString,
  cwd: insideRoot,
  include: globs,
  exclude: globs,
  args: strings,
  env: variables,
  slow: boolean,
  batchSize: positiveInteger,
  container: nonEmptyString,
};
const REQUIRED: ReadonlySet<string> = new Set(["name", "config"]);

/**
 * The `jest` rule of the policy loader (spec 028 D1), with 003 D1's entry
 * rules: a bad entry is one problem and that project is skipped. `include`,
 * `exclude` and `args` default to `[]`, `env` to `{}`.
 */
export function jestProjects(value: unknown, path: string): ProjectEntries<JestProject> {
  return projectEntries(value, path, FIELDS, REQUIRED, withDefaults, configFile);
}

function withDefaults(entry: Partial<JestProject>): JestProject {
  return {
    ...entry,
    include: entry.include ?? [],
    exclude: entry.exclude ?? [],
    args: entry.args ?? [],
    env: entry.env ?? {},
  } as JestProject;
}

/** D1: `config` names a file Jest reads as a config, or a `package.json`. */
const configFile: EntryCheck = (entry) => {
  const config = posix.basename((entry.config as string).replaceAll("\\", "/"));
  if (config === "package.json" || CONFIG_EXTENSIONS.includes(posix.extname(config))) return null;
  return {
    key: "config",
    problem: `must name a Jest config file (${CONFIG_EXTENSIONS.join(", ")}) or a package.json, got ${JSON.stringify(entry.config)}`,
  };
};
