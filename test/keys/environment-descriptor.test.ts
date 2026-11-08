import { describe, expect, it } from "vitest";
import {
  type DifferencePart,
  describeDifferences,
  sawCi,
} from "../../src/core/keys/environment-descriptor.js";
import { environmentHash, environmentRecord } from "../../src/core/keys/environment-hash.js";
import type { RelativePath } from "../../src/core/types/common.js";
import type { CoreEnvironmentInputs, FileHash } from "../../src/core/types/keys.js";
import type { RunnerEnvironment } from "../../src/core/types/runner.js";

/*
 * Spec 018 D1: the descriptor of an environment hash holds its parts, from
 * the same inputs in the same call. Equal parts give equal hashes, each
 * changed part changes the hash and is named by `describeDifferences`, and
 * no descriptor holds an allow-listed variable's value or a config field's.
 */

const SECRET_ENV = "env-value-7f3a9c";
const SECRET_CONFIG = "config-value-2b8e41";

const CORE: CoreEnvironmentInputs = {
  squealVersion: "0.0.0-test",
  nodeVersion: "v24.22.1",
  platform: "linux",
  arch: "x64",
  installedDependencies: "a".repeat(64),
  env: { SQUEAL_TOKEN: SECRET_ENV, TZ: "UTC" },
};

const RUNNER: RunnerEnvironment = {
  project: "web",
  runnerName: "vitest",
  runnerVersion: "5.0.3",
  adapterVersion: "7",
  resolvedConfig: JSON.stringify({
    allowOnly: false,
    root: "<root>",
    snapshotOptions: { updateSnapshot: "new" },
    token: SECRET_CONFIG,
  }),
  files: ["vitest.config.ts", "test/setup.ts"],
};

const HASHES: Readonly<Record<string, FileHash | null>> = {
  "vitest.config.ts": "1".repeat(40),
  "test/setup.ts": "2".repeat(40),
  "test/other-setup.ts": null,
};

const hashOf = (path: RelativePath): FileHash | null | undefined => HASHES[path];

function record(
  core: CoreEnvironmentInputs = CORE,
  runner: RunnerEnvironment = RUNNER,
  options: { ci?: boolean; format?: number; files?: Record<string, FileHash | null> } = {},
) {
  const files = options.files ?? HASHES;
  return environmentRecord(core, runner, (p) => files[p], options.ci ?? false, options.format);
}

const config = (fields: Record<string, unknown>): string =>
  JSON.stringify({ ...JSON.parse(RUNNER.resolvedConfig), ...fields });

/** One changed part each: its inputs and the part `describeDifferences` must name. */
const CHANGES: readonly {
  readonly name: string;
  readonly part: DifferencePart;
  readonly core?: Partial<CoreEnvironmentInputs>;
  readonly runner?: Partial<RunnerEnvironment>;
  readonly format?: number;
  readonly files?: Record<string, FileHash | null>;
  readonly text: string;
}[] = [
  { name: "key format", part: "keyFormat", format: 9999, text: "key format 9999 in the export" },
  { name: "project", part: "project", runner: { project: "api" }, text: 'project "api"' },
  { name: "runner", part: "runnerName", runner: { runnerName: "jest" }, text: "runner jest" },
  {
    name: "runner version",
    part: "runnerVersion",
    runner: { runnerVersion: "4.1.10" },
    text: "runner version 4.1.10 in the export, 5.0.3 here",
  },
  { name: "adapter", part: "adapterVersion", runner: { adapterVersion: "8" }, text: "adapter" },
  {
    name: "Node",
    part: "nodeVersion",
    core: { nodeVersion: "v26.13.0" },
    text: "Node v26.13.0 in the export, v24.22.1 here",
  },
  { name: "platform", part: "platform", core: { platform: "darwin" }, text: "platform darwin" },
  { name: "arch", part: "arch", core: { arch: "arm64" }, text: "arch arm64" },
  {
    name: "installed dependencies",
    part: "installedDependencies",
    core: { installedDependencies: "b".repeat(64) },
    text: "installed dependencies differ",
  },
  {
    name: "a variable's value",
    part: "env",
    core: { env: { SQUEAL_TOKEN: "other", TZ: "UTC" } },
    text: "allow-listed variables differ (values: SQUEAL_TOKEN, TZ)",
  },
  {
    name: "a variable set on one side",
    part: "env",
    core: { env: { SQUEAL_TOKEN: SECRET_ENV, TZ: "UTC", LANG: "C" } },
    text: "allow-listed variables differ (names: LANG)",
  },
  {
    name: "config fields",
    part: "config",
    runner: { resolvedConfig: config({ allowOnly: true, snapshotOptions: {} }) },
    text: "config fields allowOnly, snapshotOptions differ",
  },
  {
    name: "a config field on one side",
    part: "config",
    runner: { resolvedConfig: config({ coverage: { enabled: true } }) },
    text: "config fields coverage differ",
  },
  {
    name: "a file's bytes",
    part: "files",
    files: { ...HASHES, "test/setup.ts": "3".repeat(40) },
    text: "config and setup files differ: test/setup.ts",
  },
  {
    name: "a file on one side",
    part: "files",
    runner: { files: [...RUNNER.files, "test/other-setup.ts"] },
    text: "config and setup files differ: test/other-setup.ts",
  },
];

describe("environment descriptor (018 D1)", () => {
  it("gives the hash environmentHash gives, for the formats it hashes under", () => {
    expect(record().hash).toBe(environmentHash(CORE, RUNNER, hashOf));
    expect(record(CORE, RUNNER, { format: 3 }).hash).toBe(environmentHash(CORE, RUNNER, hashOf, 3));
  });

  it("equal parts in another order give an equal hash and no difference", () => {
    const reordered = record(
      { ...CORE, env: { TZ: "UTC", SQUEAL_TOKEN: SECRET_ENV } },
      { ...RUNNER, files: ["test/setup.ts", "vitest.config.ts", "test/setup.ts"] },
    );
    const here = record();
    expect(reordered.hash).toBe(here.hash);
    expect(reordered.descriptor).toEqual(here.descriptor);
    expect(describeDifferences(reordered.descriptor, here.descriptor)).toEqual([]);
  });

  for (const change of CHANGES) {
    it(`a changed ${change.name} changes the hash and is named`, () => {
      const here = record();
      const there = record(
        { ...CORE, ...change.core },
        { ...RUNNER, ...change.runner },
        {
          ...(change.format === undefined ? {} : { format: change.format }),
          ...(change.files === undefined ? {} : { files: change.files }),
        },
      );
      expect(there.hash).not.toBe(here.hash);
      const differences = describeDifferences(there.descriptor, here.descriptor);
      expect(differences.map((d) => d.part)).toEqual([change.part]);
      expect(differences[0]?.text).toContain(change.text);
    });
  }

  it("never holds an allow-listed variable's value or a config field's value", () => {
    const { descriptor } = record();
    const text = JSON.stringify(descriptor);
    expect(text).not.toContain(SECRET_ENV);
    expect(text).not.toContain(SECRET_CONFIG);
    expect(text).not.toContain("updateSnapshot");
    expect(descriptor.env.names).toEqual(["SQUEAL_TOKEN", "TZ"]);
    expect(Object.keys(descriptor.config)).toEqual([
      "allowOnly",
      "root",
      "snapshotOptions",
      "token",
    ]);
  });

  it("keeps the CI hint out of the hash", () => {
    const ci = record(CORE, RUNNER, { ci: true });
    expect(ci.hash).toBe(record().hash);
    expect(ci.descriptor.ci).toBe(true);
    expect(describeDifferences(ci.descriptor, record().descriptor)).toEqual([]);
  });

  it("says the export ran with CI set when only config fields differ", () => {
    const changed = { ...RUNNER, resolvedConfig: config({ allowOnly: true }) };
    const there = record(CORE, changed, { ci: true }).descriptor;
    const here = record().descriptor;
    expect(describeDifferences(there, here).map((d) => d.text)).toEqual([
      "config fields allowOnly differ (the export ran with CI set)",
    ]);
    const node = record({ ...CORE, nodeVersion: "v26.13.0" }, changed, { ci: true }).descriptor;
    expect(describeDifferences(node, here).map((d) => d.text)).toEqual([
      "Node v26.13.0 in the export, v24.22.1 here",
      "config fields allowOnly differ",
    ]);
    const both = record(CORE, changed, { ci: true }).descriptor;
    const ciHere = record(CORE, RUNNER, { ci: true }).descriptor;
    expect(describeDifferences(both, ciHere).map((d) => d.text)).toEqual([
      "config fields allowOnly differ",
    ]);
  });

  it("names parts in order, and shortens a long list", () => {
    const many = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`f${i}`, i]));
    const there = record(
      { ...CORE, nodeVersion: "v26.13.0", installedDependencies: "none" },
      { ...RUNNER, runnerVersion: "4.1.10", resolvedConfig: config(many) },
    ).descriptor;
    const differences = describeDifferences(there, record().descriptor);
    expect(differences.map((d) => d.part)).toEqual([
      "runnerVersion",
      "nodeVersion",
      "installedDependencies",
      "config",
    ]);
    expect(differences[2]?.text).toBe("no installed dependencies in the export");
    expect(differences[3]?.names).toHaveLength(8);
    expect(differences[3]?.text).toBe("config fields f0, f1, f2, f3, f4 and 3 more differ");
  });

  it("reads a config that is not a JSON object as one field", () => {
    const there = record(CORE, { ...RUNNER, resolvedConfig: "not json" }).descriptor;
    const here = record(CORE, { ...RUNNER, resolvedConfig: "[1]" }).descriptor;
    expect(Object.keys(here.config)).toEqual(["(config)"]);
    expect(describeDifferences(there, here).map((d) => d.text)).toEqual([
      "config fields (config) differ",
    ]);
  });
});

describe("sawCi", () => {
  it("reads CI as std-env does, and a CI service's own variable", () => {
    expect(sawCi({})).toBe(false);
    expect(sawCi({ CI: "" })).toBe(false);
    expect(sawCi({ CI: "false" })).toBe(false);
    expect(sawCi({ CI: "true" })).toBe(true);
    expect(sawCi({ CI: "1" })).toBe(true);
    expect(sawCi({ GITHUB_ACTIONS: "true" })).toBe(true);
    expect(sawCi({ GITLAB_CI: "" })).toBe(false);
  });
});
