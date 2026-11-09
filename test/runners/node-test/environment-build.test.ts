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
  type NodeProbe,
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

/** A directory whose `node` runs this Node's binary with another `process.config`. */
function otherBuildOfThisVersion(): string {
  const dir = mkdtempSync(join(scratch, "build-"));
  const patch = join(dir, "other-build.cjs");
  // A small-icu build of the same version (Node's BUILDING.md, "Trimmed: small-icu").
  writeFileSync(
    patch,
    [
      "const c = process.config;",
      "const variables = { ...c.variables, icu_small: !c.variables.icu_small };",
      'Object.defineProperty(process, "config", { value: { ...c, variables }, enumerable: true });',
      "",
    ].join("\n"),
  );
  const node = join(dir, "node");
  writeFileSync(
    node,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} --require ${JSON.stringify(patch)} "$@"\n`,
  );
  chmodSync(node, 0o755);
  return dir;
}

describe("the node:test environment of the project's Node (018 D12)", () => {
  it("is equal for one build at two paths", SLOW, async () => {
    const elsewhere = samePathElsewhere();
    // The copy names its own path, which keyed it apart until D12.
    expect(
      execFileSync(join(elsewhere, "node"), ["-p", "process.execPath"], { encoding: "utf8" }),
    ).toBe(`${join(elsewhere, "node")}\n`);
    const here = await environmentWith(dirname(process.execPath));
    const there = await environmentWith(elsewhere);
    expect(there).toEqual(here);
    expect(here.resolvedConfig).not.toContain(dirname(process.execPath));
  });

  it("differs for two builds of one version", SLOW, async () => {
    const here = await environmentWith(dirname(process.execPath));
    const other = await environmentWith(otherBuildOfThisVersion());
    expect(other.runnerVersion).toBe(process.version);
    expect(other.runnerVersion).toBe(here.runnerVersion);
    expect(other.resolvedConfig).not.toBe(here.resolvedConfig);
  });

  it("names the project's Node's own versions, platform and arch", SLOW, async () => {
    const environment = await environmentWith(dirname(process.execPath));
    expect(JSON.parse(environment.resolvedConfig)).toMatchObject({
      nodeVersions: { ...process.versions },
      nodeConfig: expect.stringMatching(/^[0-9a-f]{64}$/),
      nodePlatform: process.platform,
      nodeArch: process.arch,
    });
  });

  it("keys each of the build's fields", () => {
    const probe: NodeProbe = {
      ok: true,
      version: "v24.22.1",
      versions: { node: "24.22.1", openssl: "3.5.4" },
      config: "a".repeat(64),
      platform: "linux",
      arch: "x64",
    };
    const keyOf = (p: NodeProbe) => {
      const e = projectEnvironment(root, project, p, [], "1");
      return `${e.runnerVersion} ${e.resolvedConfig}`;
    };
    const base = keyOf(probe);
    const others: NodeProbe[] = [
      { ...probe, version: "v24.22.2" },
      { ...probe, versions: { ...probe.versions, openssl: "3.5.5" } },
      { ...probe, config: "b".repeat(64) },
      { ...probe, platform: "darwin" },
      { ...probe, arch: "arm64" },
    ];
    for (const other of others) expect(keyOf(other)).not.toBe(base);
    // The order Node lists its versions in keys nothing.
    const reordered = { openssl: "3.5.4", node: "24.22.1" };
    expect(keyOf({ ...probe, versions: reordered })).toBe(base);
  });
});
