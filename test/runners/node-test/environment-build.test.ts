import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import type { NodeTestProject } from "../../../src/core/types/policy.js";
import {
  probeNode,
  projectEnvironment,
} from "../../../src/runners/node-test/adapter-environment.js";

/*
 * Spec 018 D12: node:test keys the project's Node by its build, not by the
 * absolute path of its binary. CI's `setup-node` puts the same build under
 * another directory than a developer's install, so a path in the key made
 * every node:test result of CI miss locally (018-08: 127 files).
 */

const SLOW = { timeout: 60_000 } as const;

const scratch = mkdtempSync(join(tmpdir(), "squeal-node-build-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
afterEach(() => {
  vi.unstubAllEnvs();
});

const root = join(scratch, "root") as AbsolutePath;
mkdirSync(root);

/** `node` unset: the `node` first on the daemon's PATH, as cezar's config and CI's setup-node have it. */
const project: NodeTestProject = { name: "unit", argv: [], env: {}, include: ["test/*.mjs"] };

/** The project's environment with `dir` first on the daemon's PATH. */
async function environmentWith(dir: string) {
  vi.stubEnv("PATH", `${dir}${delimiter}${process.env.PATH ?? ""}`);
  const probe = await probeNode(project, root);
  expect(probe).toMatchObject({ ok: true });
  return projectEnvironment(root, project, probe, [], "1");
}

/** A directory whose `node` is this Node's binary at another path. */
function samePathElsewhere(): string {
  const dir = mkdtempSync(join(scratch, "copy-"));
  const node = join(dir, "node");
  try {
    linkSync(process.execPath, node);
  } catch {
    // Another file system: a copy is the same build too.
    copyFileSync(process.execPath, node);
    chmodSync(node, 0o755);
  }
  return dir;
}

/** A directory whose `node` runs this Node's binary with `property` of `process` replaced. */
function patched(property: string, value: string): string {
  const dir = mkdtempSync(join(scratch, `${property}-`));
  const patch = join(dir, "patch.cjs");
  writeFileSync(
    patch,
    `Object.defineProperty(process, ${JSON.stringify(property)}, { value: ${value}, enumerable: true });\n`,
  );
  const node = join(dir, "node");
  writeFileSync(
    node,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} --require ${JSON.stringify(patch)} "$@"\n`,
  );
  chmodSync(node, 0o755);
  return dir;
}

/** Other builds of this version, each as `process` reports it. */
const OTHER_BUILDS: readonly (readonly [string, string, string])[] = [
  // Node's BUILDING.md, "Trimmed: small-icu": the configure options differ.
  [
    "a small-icu build",
    "config",
    "{ ...process.config, variables: { ...process.config.variables, icu_small: !process.config.variables.icu_small } }",
  ],
  ["a build on another OpenSSL", "versions", '{ ...process.versions, openssl: "0.0.0-other" }'],
  ["a build for another platform", "platform", '"aix"'],
  ["a build for another arch", "arch", '"s390x"'],
];

describe("the node:test environment of the project's Node (018 D12)", () => {
  it("is equal for one build at two paths, and names neither", SLOW, async () => {
    const elsewhere = samePathElsewhere();
    // The copy names its own path, which keyed it apart until D12.
    expect(
      execFileSync(join(elsewhere, "node"), ["-p", "process.execPath"], { encoding: "utf8" }),
    ).toBe(`${join(elsewhere, "node")}\n`);
    const here = await environmentWith(dirname(process.execPath));
    const there = await environmentWith(elsewhere);
    expect(there).toEqual(here);
    expect(here.runnerVersion).toBe(process.version);
    expect(JSON.parse(here.resolvedConfig)).toMatchObject({
      nodeBuild: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(here.resolvedConfig).not.toContain(dirname(process.execPath));
    expect(here.resolvedConfig).not.toContain(elsewhere);
  });

  it.each(OTHER_BUILDS)("differs for %s of one version", SLOW, async (_, property, value) => {
    const here = await environmentWith(dirname(process.execPath));
    const other = await environmentWith(patched(property, value));
    expect(other.runnerVersion).toBe(here.runnerVersion);
    expect(other.resolvedConfig).not.toBe(here.resolvedConfig);
  });

  it("is equal whatever order the build lists its configure options in", SLOW, async () => {
    const reversed = "Object.fromEntries(Object.entries(process.config).reverse())";
    expect(Object.keys(process.config).length).toBeGreaterThan(1);
    const here = await environmentWith(dirname(process.execPath));
    expect(await environmentWith(patched("config", reversed))).toEqual(here);
  });
});
