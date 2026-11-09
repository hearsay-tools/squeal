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
 * What the project's Node said about itself, or why it could not run.
 * Spec 018 D12: `build` is the sha256 of its build, not the path of its
 * binary, so one build at two paths (CI's tool cache, a developer's
 * install) keys alike, and two builds of one version (another ICU, another
 * OpenSSL) key apart.
 */
export type NodeProbe =
  | { readonly ok: true; readonly version: string; readonly build: string }
  | { readonly ok: false; readonly error: string };

const PROBE_TIMEOUT_MS = 30_000;
/**
 * Prints `process.version`, then one JSON line with sorted keys: the
 * project's Node's `process.versions` (Node's and its dependencies'),
 * `process.config` (its configure options), `platform` and `arch`, which
 * may not be the daemon's. Each on a line of its own: a preload in the
 * project's NODE_OPTIONS may print first, without a newline.
 */
const PROBE = [
  "const sorted = (v) => v === null || typeof v !== 'object' ? v : Array.isArray(v) ? v.map(sorted) : Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])]))",
  "const build = { versions: process.versions, config: process.config, platform: process.platform, arch: process.arch }",
  'process.stdout.write("\\n" + process.version + "\\n" + JSON.stringify(sorted(build)) + "\\n")',
].join(";\n");

/**
 * Runs the project's `node` (spec 003 D1: "an executable path or name,
 * default the `node` on the daemon's PATH") from its `cwd` with its `env`
 * merged, for the environment hash's "resolved executable's `node
 * --version`" and, by 018 D12, its build in place of its path. A failure
 * is D1's missing executable.
 */
export function probeNode(project: NodeTestProject, cwd: AbsolutePath): Promise<NodeProbe> {
  const node = project.node ?? "node";
  return new Promise((done) => {
    execFile(
      node,
      ["-e", PROBE],
      { cwd, env: projectEnv(project, process.env), timeout: PROBE_TIMEOUT_MS, encoding: "utf8" },
      (error, stdout) => {
        // The probe's lines are last.
        const [version, build] = stdout.trimEnd().split("\n").slice(-2);
        if (error === null && version?.startsWith("v") && build?.startsWith("{")) {
          done({ ok: true, version, build: createHash("sha256").update(build).digest("hex") });
        } else {
          const reason =
            error?.message.split("\n")[0] ?? `unexpected output ${JSON.stringify(stdout)}`;
          done({ ok: false, error: `cannot run ${JSON.stringify(node)}: ${reason}` });
        }
      },
    );
  });
}

/** `runnerVersion` while the project's Node cannot run: no stored result was produced under it. */
export const NODE_UNAVAILABLE = "unavailable";

/**
 * Spec 003 D1: the runner-side environment inputs of one node:test project.
 * `resolvedConfig` is the canonical JSON of the project entry plus the
 * hash of the resolved executable's build (018 D12: never its path); `files` is
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
    nodeBuild: probe.ok ? probe.build : null,
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
