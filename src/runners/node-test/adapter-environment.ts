import { execFile } from "node:child_process";
import { relative, sep } from "node:path";
import { compare, toRelative } from "../../core/fs/index.js";
import type {
  AbsolutePath,
  NodeTestProject,
  RelativePath,
  RunnerEnvironment,
  RunnerPackages,
} from "../../core/types/index.js";
import { projectCwd } from "./adapter-files.js";

/** What the project's Node said about itself, or why it could not run. */
export type NodeProbe =
  | { readonly ok: true; readonly version: string; readonly execPath: AbsolutePath }
  | { readonly ok: false; readonly error: string };

const PROBE_TIMEOUT_MS = 30_000;
const PROBE = 'process.stdout.write(process.version + "\\n" + process.execPath + "\\n")';

/**
 * Runs the project's `node` (spec 003 D1: "an executable path or name,
 * default the `node` on the daemon's PATH") from its `cwd` with its `env`
 * merged, for the environment hash's "resolved executable's `node --version`
 * and its path". A failure is D1's missing executable.
 */
export function probeNode(project: NodeTestProject, cwd: AbsolutePath): Promise<NodeProbe> {
  const node = project.node ?? "node";
  const { NODE_TEST_CONTEXT: _, ...base } = process.env;
  return new Promise((done) => {
    execFile(
      node,
      ["-e", PROBE],
      { cwd, env: { ...base, ...project.env }, timeout: PROBE_TIMEOUT_MS, encoding: "utf8" },
      (error, stdout) => {
        // A preload in the project's NODE_OPTIONS may print first: the probe's lines are last.
        const [version, execPath] = stdout.trimEnd().split("\n").slice(-2);
        if (error === null && version?.startsWith("v") && execPath) {
          done({ ok: true, version, execPath });
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
 * resolved executable (relative when it sits in the worktree); `files` is
 * the preloads' closure from the graph; `root` is the project's `cwd`;
 * `packages` the graph's environment packages (task 003-22), absent for a
 * project whose graph did not build, which keys by the whole fingerprint.
 */
export function projectEnvironment(
  root: AbsolutePath,
  project: NodeTestProject,
  probe: NodeProbe,
  preloads: readonly RelativePath[],
  adapterVersion: string,
  packages?: RunnerPackages,
): RunnerEnvironment {
  const execPath = probe.ok ? (toRelative(root, probe.execPath) ?? probe.execPath) : null;
  const cwd = slashes(relative(root, projectCwd(root, project)));
  const config = {
    node: project.node ?? "node",
    execPath,
    argv: project.argv,
    env: Object.entries(project.env).sort(([a], [b]) => compare(a, b)),
    cwd,
    include: project.include,
    exclude: project.exclude ?? [],
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
  };
}

function slashes(path: string): string {
  return path.split(sep).join("/");
}
