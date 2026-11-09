import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { relative, sep } from "node:path";
import { COVERAGE_PROVIDER_VERSION } from "../../core/code/coverage/record.js";
import { compare } from "../../core/fs/compare.js";
import type { AbsolutePath, RelativePath } from "../../core/types/common.js";
import type { NodeTestProject } from "../../core/types/policy.js";
import type { RunnerEnvironment, RunnerPackages } from "../../core/types/runner.js";
import { projectCwd } from "./adapter-files.js";
import { projectEnv } from "./recorders.js";

/**
 * What the project's Node said about its build, or why it could not run.
 * Spec 018 D12: the build, not the path of its binary, so one build at two
 * paths (CI's tool cache, a developer's install) keys alike, and two builds
 * of one version (another ICU, another OpenSSL) key apart.
 */
export type NodeProbe =
  | {
      readonly ok: true;
      /** `process.version`. */
      readonly version: string;
      /** `process.versions`: Node's and its dependencies' versions. */
      readonly versions: Readonly<Record<string, string>>;
      /** The sha256 of `process.config`, the build's configure options, with sorted keys. */
      readonly config: string;
      /** `process.platform` and `process.arch` of the project's Node, which may not be the daemon's. */
      readonly platform: string;
      readonly arch: string;
    }
  | { readonly ok: false; readonly error: string };

const PROBE_TIMEOUT_MS = 30_000;
// One line of its own: a preload in the project's NODE_OPTIONS may print first, without a newline.
const PROBE =
  'process.stdout.write("\\n" + JSON.stringify({ version: process.version, versions: process.versions, config: process.config, platform: process.platform, arch: process.arch }) + "\\n")';

/**
 * Runs the project's `node` (spec 003 D1: "an executable path or name,
 * default the `node` on the daemon's PATH") from its `cwd` with its `env`
 * merged, for the environment hash's description of the resolved
 * executable's build (018 D12). A failure is D1's missing executable.
 */
export function probeNode(project: NodeTestProject, cwd: AbsolutePath): Promise<NodeProbe> {
  const node = project.node ?? "node";
  return new Promise((done) => {
    execFile(
      node,
      ["-e", PROBE],
      { cwd, env: projectEnv(project, process.env), timeout: PROBE_TIMEOUT_MS, encoding: "utf8" },
      (error, stdout) => {
        // The probe's line is last.
        const build = error === null ? buildOf(stdout.trimEnd().split("\n").at(-1)) : null;
        if (build !== null) {
          done(build);
        } else {
          const reason =
            error?.message.split("\n")[0] ?? `unexpected output ${JSON.stringify(stdout)}`;
          done({ ok: false, error: `cannot run ${JSON.stringify(node)}: ${reason}` });
        }
      },
    );
  });
}

/** The probe's line as a build, or null when it is not one. */
function buildOf(line: string | undefined): NodeProbe | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line ?? "");
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { version, versions, config, platform, arch } = parsed as Record<string, unknown>;
  if (typeof version !== "string" || !version.startsWith("v")) return null;
  if (!isStrings(versions) || typeof config !== "object" || config === null) return null;
  if (typeof platform !== "string" || typeof arch !== "string") return null;
  const hash = createHash("sha256")
    .update(JSON.stringify(sortedKeys(config)))
    .digest("hex");
  return { ok: true, version, versions, config: hash, platform, arch };
}

function isStrings(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((v) => typeof v === "string")
  );
}

/** `value` with every object's keys sorted, so equal content serializes alike. */
function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => compare(a, b))
      .map(([k, v]) => [k, sortedKeys(v)]),
  );
}

/** `runnerVersion` while the project's Node cannot run: no stored result was produced under it. */
export const NODE_UNAVAILABLE = "unavailable";

/**
 * Spec 003 D1: the runner-side environment inputs of one node:test project.
 * `resolvedConfig` is the canonical JSON of the project entry plus the
 * resolved executable's build (018 D12: its versions, the hash of its
 * configure options, its platform and arch; never its path); `files` is
 * the preloads' closure from the graph; `root` is the project's `cwd`;
 * `packages` the graph's environment packages (task 003-22), absent for a
 * project whose graph did not build, which keys by the whole fingerprint.
 * With `coverage` the config holds Squeal's coverage marker; without, it
 * holds no coverage field (row 015-86).
 */
export function projectEnvironment(
  root: AbsolutePath,
  project: NodeTestProject,
  probe: NodeProbe,
  preloads: readonly RelativePath[],
  adapterVersion: string,
  packages?: RunnerPackages,
  coverage = false,
): RunnerEnvironment {
  const cwd = slashes(relative(root, projectCwd(root, project)));
  const config = {
    node: project.node ?? "node",
    nodeVersions: probe.ok ? sortedKeys(probe.versions) : null,
    nodeConfig: probe.ok ? probe.config : null,
    nodePlatform: probe.ok ? probe.platform : null,
    nodeArch: probe.ok ? probe.arch : null,
    argv: project.argv,
    env: Object.entries(project.env).sort(([a], [b]) => compare(a, b)),
    cwd,
    include: project.include,
    exclude: project.exclude ?? [],
    // Spec 015 D8 (row 015-86): Squeal's provider name and version alone, as Vitest's key holds them.
    ...(coverage ? { coverage: { provider: "squeal", version: COVERAGE_PROVIDER_VERSION } } : {}),
  };
  return {
    project: project.name,
    ...(cwd === "" ? {} : { root: cwd }),
    runnerName: "node-test",
    runnerVersion: probe.ok ? probe.version : NODE_UNAVAILABLE,
    adapterVersion,
    resolvedConfig: JSON.stringify(config),
    files: [...preloads],
    ...(packages === undefined ? {} : { packages }),
    // 016 D4, O8: its runs observe module loads, which key whatever `observe.runtimeInputs` says
    observedLoads: true,
  };
}

function slashes(path: string): string {
  return path.split(sep).join("/");
}
