import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compare } from "../../fs/compare.js";
import type { CoreEnvironmentInputs } from "../../types/keys.js";
import type { ContainerKeyMode } from "../../types/policy-containers.js";
import type { RunnerEnvironment } from "../../types/runner.js";
import { type DockerCli, guarded, type ImageInfo } from "./docker.js";

/*
 * Spec 027 D7 (row 027-06): the key space of a container target. Each
 * `RunnerEnvironment` the runner host answers inside the container takes a
 * `container` field in its resolved config, the descriptor below, and the
 * container's Node, platform and arch as its `core` (as `remote-key.ts`
 * does for a remote). The environment hash then differs from every host
 * hash of the same worktree, and no non-container key changes, so
 * `KEY_FORMAT_VERSION` stays. The slot variables (D1.4) and the variables
 * Squeal sets per worktree (`HOME`, `PYTHONPYCACHEPREFIX`) key nothing.
 *
 * `"build-content"`, the default, keys what a separate `docker build` of
 * the same inputs reproduces: the OS packages, the `dockerfileInputs`, the
 * image's and the target's env and the dependency services' image tags. So
 * a CI run of `squeal ci export` inside its own build matches a developer's.
 * `"image-id"` keys the exact local image ID and its single registry digest.
 */

/** D1.4: runtime isolation only, never a key input. */
export const SLOT_VARIABLES: readonly string[] = [
  "SQUEAL_SLOT",
  "SQUEAL_WORKTREE_SLOT",
  "TOX_PARALLEL_ENV",
];
/** Set by Squeal per worktree path (`containerEnv`); keying them would split worktrees and CI. */
const LAUNCH_VARIABLES: readonly string[] = ["HOME", "PYTHONPYCACHEPREFIX"];

/** What a container shows of itself from inside. */
export interface ContainerProbe {
  /** `process.version` of the container's Node, `v22.19.0`. */
  readonly nodeVersion: string;
  /** `process.platform` and `process.arch` inside. */
  readonly platform: string;
  readonly arch: string;
  /** The OS package manager whose inventory was read; `none` when neither answered. */
  readonly packageManager: "dpkg" | "apk" | "none";
  /** One `name=version` line per package, sorted. */
  readonly packages: readonly string[];
}

/** A dependency service's image, as found running; absent fields were not found. */
export interface ServiceImage {
  readonly service: string;
  /** The image reference the service's container runs, `postgres:16`. */
  readonly image?: string;
  readonly id?: string;
  readonly repoDigests?: readonly string[];
}

/** Everything a container target's key is made from. */
export interface ContainerKeyInputs {
  readonly keyMode: ContainerKeyMode;
  readonly image: ImageInfo;
  readonly probe: ContainerProbe;
  /** Each `dockerfileInputs` path with its content's SHA-256, or `missing`. */
  readonly dockerfileInputs: readonly (readonly [string, string])[];
  /** The target's own `env`, passed into the container. */
  readonly targetEnv: Readonly<Record<string, string>>;
  readonly services: readonly ServiceImage[];
}

/** The `container` field of a container environment's resolved config. */
export type ContainerKeyDescriptor =
  | {
      readonly keyMode: "build-content";
      readonly packages: { readonly manager: string; readonly hash: string };
      readonly dockerfileInputs: readonly (readonly [string, string])[];
      readonly env: readonly (readonly [string, string])[];
      readonly services: readonly (readonly [string, string, readonly string[]])[];
    }
  | {
      readonly keyMode: "image-id";
      readonly imageId: string;
      readonly repoDigest: string | null;
      readonly env: readonly (readonly [string, string])[];
      readonly services: readonly (readonly [string, string])[];
    };

/** The image's `ENV` under the target's `env`, sorted, without slot or launch variables. */
export function keyedEnv(
  imageEnv: readonly string[],
  targetEnv: Readonly<Record<string, string>>,
): [string, string][] {
  const merged = new Map<string, string>();
  for (const entry of imageEnv) {
    const at = entry.indexOf("=");
    if (at > 0) merged.set(entry.slice(0, at), entry.slice(at + 1));
  }
  for (const [name, value] of Object.entries(targetEnv)) merged.set(name, value);
  const skipped = new Set([...SLOT_VARIABLES, ...LAUNCH_VARIABLES]);
  return [...merged].filter(([name]) => !skipped.has(name)).sort(([a], [b]) => compare(a, b));
}

/** The descriptor of `inputs` under its key mode. */
export function containerKeyDescriptor(inputs: ContainerKeyInputs): ContainerKeyDescriptor {
  const env = keyedEnv(inputs.image.env, inputs.targetEnv);
  const services = [...inputs.services].sort((a, b) => compare(a.service, b.service));
  if (inputs.keyMode === "image-id") {
    const digests = inputs.image.repoDigests;
    return {
      keyMode: "image-id",
      imageId: inputs.image.id,
      repoDigest: digests.length === 1 ? (digests[0] ?? null) : null,
      env,
      services: services.map((s) => [s.service, s.id ?? "not-running"]),
    };
  }
  return {
    keyMode: "build-content",
    packages: {
      manager: inputs.probe.packageManager,
      hash: sha256(inputs.probe.packages.join("\n")),
    },
    dockerfileInputs: [...inputs.dockerfileInputs].sort(([a], [b]) => compare(a, b)),
    env,
    services: services.map((s) => [
      s.service,
      s.image ?? "not-running",
      [...(s.repoDigests ?? [])].sort(compare),
    ]),
  };
}

/** The core a container environment keys under: the container's Node, platform and arch. */
export function containerCore(
  probe: Pick<ContainerProbe, "nodeVersion" | "platform" | "arch">,
  squealVersion: string,
): CoreEnvironmentInputs {
  return {
    squealVersion,
    nodeVersion: probe.nodeVersion,
    platform: probe.platform,
    arch: probe.arch,
    installedDependencies: "container",
    env: {},
  };
}

/**
 * Each environment from the runner host in the container, keyed in the
 * container's space: its resolved config takes `container` (the
 * descriptor), and its `core` the container's machine.
 */
export function applyContainerEnvironment(
  environments: readonly RunnerEnvironment[],
  descriptor: ContainerKeyDescriptor,
  core: CoreEnvironmentInputs,
): RunnerEnvironment[] {
  return environments.map((environment) => ({
    ...environment,
    resolvedConfig: withContainer(environment.resolvedConfig, descriptor),
    core,
  }));
}

/** `resolvedConfig` with a top-level `container` field; one not a JSON object is kept as `config`. */
function withContainer(resolvedConfig: string, descriptor: ContainerKeyDescriptor): string {
  let config: Record<string, unknown> = { config: resolvedConfig };
  try {
    const parsed: unknown = JSON.parse(resolvedConfig);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      config = { ...(parsed as Record<string, unknown>) };
    }
  } catch {
    // Not JSON: kept whole under `config`.
  }
  return JSON.stringify({ ...config, container: descriptor });
}

/** Each of `paths`, relative to `root`, with its content's SHA-256 or `missing`. */
export function hashInputs(root: string, paths: readonly string[]): [string, string][] {
  return paths.map((path) => {
    try {
      return [path, sha256(readFileSync(join(root, path)))];
    } catch {
      return [path, "missing"];
    }
  });
}

const PROBE_MS = 15_000;
const NODE_PROBE =
  "process.stdout.write([process.version,process.platform,process.arch].join(' '))";
/** dpkg's format, `${Package}=${Version}`, built so no JS placeholder is read in it. */
const DPKG_FORMAT = ["$", "{Package}=", "$", "{Version}\\n"].join("");
const PACKAGES =
  `if command -v dpkg-query >/dev/null 2>&1; then echo dpkg; dpkg-query -W -f='${DPKG_FORMAT}'; ` +
  "elif command -v apk >/dev/null 2>&1; then echo apk; apk info -vv 2>/dev/null; else echo none; fi";

/** Reads the container's Node and its OS package inventory; throws when Node does not answer. */
export async function probeContainer(cli: DockerCli, containerId: string): Promise<ContainerProbe> {
  const node = await cli.execSyncText(containerId, ["node", "-e", NODE_PROBE], PROBE_MS);
  const [nodeVersion, platform, arch] = node.stdout.trim().split(" ");
  if (node.code !== 0 || nodeVersion === undefined || platform === undefined || !arch) {
    throw new Error(`the container's node did not answer: ${node.stderr.trim().slice(-300)}`);
  }
  const listed = await cli.execSyncText(containerId, ["sh", "-c", PACKAGES], PROBE_MS);
  if (listed.code !== 0) throw new Error(`the container's packages could not be listed`);
  return { nodeVersion, platform, arch, ...parsePackages(listed.stdout) };
}

/** The probe's package output: the manager's name on the first line, then its lines. */
export function parsePackages(text: string): Pick<ContainerProbe, "packageManager" | "packages"> {
  const [first = "none", ...rest] = text.split("\n");
  const manager = first.trim();
  const packageManager = manager === "dpkg" || manager === "apk" ? manager : "none";
  const packages = rest
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .sort(compare);
  return { packageManager, packages: packageManager === "none" ? [] : packages };
}

/**
 * The running container of each Compose `service`, by the label Compose
 * sets, with its image: never starts one. A service not found, or a Docker
 * that does not answer, keys as not running.
 */
export async function inspectServices(
  cli: Pick<DockerCli, "imageInspect">,
  services: readonly string[],
  composeProject: string | undefined,
  listImage: (args: readonly string[]) => Promise<string> = dockerText,
): Promise<ServiceImage[]> {
  const found: ServiceImage[] = [];
  for (const service of services) {
    const labels = [
      `--filter=label=com.docker.compose.service=${service}`,
      ...(composeProject === undefined
        ? []
        : [`--filter=label=com.docker.compose.project=${composeProject}`]),
    ];
    const args = guarded("ps", [...labels, "--filter=status=running", "--format={{.Image}}"], []);
    const image = (await listImage(args).catch(() => "")).split("\n")[0]?.trim() ?? "";
    if (image === "") {
      found.push({ service });
      continue;
    }
    const info = await cli.imageInspect(image).catch(() => null);
    found.push({
      service,
      image,
      ...(info === null ? {} : { id: info.id, repoDigests: info.repoDigests }),
    });
  }
  return found;
}

function dockerText(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("docker", args, { timeout: PROBE_MS, encoding: "utf8" }, (error, stdout) =>
      error === null ? resolve(stdout) : reject(error),
    );
  });
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
