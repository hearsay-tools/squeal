import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

/*
 * Spec 027 D4 and D5 (row 027-05): the only Docker commands Squeal runs.
 * Every argument list passes `guarded`, which allows six commands and
 * refuses, among Docker's own options, every flag D4 forbids: Squeal never
 * builds, pulls, composes, runs privileged or mounts with `-v`. A bind
 * mount is `--mount`, whose missing source fails instead of creating a
 * root-owned directory, and `docker run` always carries `--init`,
 * `--pull never` and `--user <uid>:<gid>`. The command a container runs,
 * after its image or its ID, is not Docker's and is not scanned.
 */

/** The label every container Squeal manages carries; Squeal removes no other. */
export const MANAGED_LABEL = "org.squeal.managed";

/** What `docker image inspect` tells of a local image. */
export interface ImageInfo {
  /** The image ID, `sha256:...`. */
  readonly id: string;
  readonly repoDigests: readonly string[];
  /** The image's `ENV`, as `NAME=value`. */
  readonly env: readonly string[];
  readonly architecture: string;
  readonly os: string;
}

/** One `--mount type=bind`: the host's `source` at `target` inside. */
export interface BindMount {
  readonly source: string;
  readonly target: string;
  readonly readonly?: boolean;
}

/** One idle container's `docker run`. */
export interface RunIdleSpec {
  readonly name: string;
  readonly imageId: string;
  readonly user: { readonly uid: number; readonly gid: number };
  readonly labels: Readonly<Record<string, string>>;
  readonly network?: string;
  readonly mounts: readonly BindMount[];
  readonly env: Readonly<Record<string, string>>;
}

/** A managed container as `docker ps` lists it, with Squeal's labels. */
export interface ManagedListing {
  readonly id: string;
  readonly name: string;
  /** `running`, `exited`, `created` and others of Docker's. */
  readonly state: string;
  readonly worktree: string;
  readonly target: string;
  readonly image: string;
  readonly pid: string;
}

/** What a command run in a container gave. */
export interface ExecText {
  /** `null` when it ended on a signal or its bound. */
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Which managed containers `psManaged` lists: every given label, and the ID when given. */
export interface ManagedFilter {
  readonly labels?: Readonly<Record<string, string>>;
  readonly id?: string;
}

/** The Docker CLI as Squeal uses it; tests give a fake. */
export interface DockerCli {
  /** `null`: no local image by that reference. Never pulls. */
  imageInspect(image: string): Promise<ImageInfo | null>;
  /** Starts an idle container; resolves with its ID. */
  runIdle(spec: RunIdleSpec): Promise<string>;
  execSyncText(containerId: string, argv: readonly string[], timeoutMs?: number): Promise<ExecText>;
  spawnExec(containerId: string, argv: readonly string[]): ChildProcessWithoutNullStreams;
  psManaged(filter: ManagedFilter): Promise<readonly ManagedListing[]>;
  /** Removes a container only when it carries `MANAGED_LABEL`; `false` when it did not. */
  removeManaged(containerId: string): Promise<boolean>;
}

/** The Docker commands Squeal runs: `image inspect`, `run`, `exec`, `ps` and `rm`. */
type Command = "image inspect" | "run" | "exec" | "ps" | "rm";

/** Docker options D4 forbids, wherever they stand among Docker's own. */
const FORBIDDEN = new Set(["--privileged", "-v", "--volume", "--volumes-from"]);
/** Commands D4 forbids, refused even as the first word of an allowed one's options. */
const FORBIDDEN_COMMANDS = new Set(["build", "buildx", "builder", "pull", "push", "compose"]);

/**
 * The argument list of `command` with Docker's own `options` and the
 * `operands` after them. Throws when the command is not one of Squeal's, an
 * option is forbidden, or `run` lacks one of its invariants.
 */
export function guarded(
  command: Command,
  options: readonly string[],
  operands: readonly string[],
): string[] {
  const words = command.split(" ");
  for (const option of options) {
    const flag = option.split("=")[0] ?? option;
    if (FORBIDDEN.has(flag) || FORBIDDEN_COMMANDS.has(option) || /^-v./.test(option)) {
      throw new Error(`squeal never runs docker ${command} with ${option}`);
    }
    if (flag === "--mount" && !option.includes("type=bind,")) {
      throw new Error(`squeal mounts only with --mount type=bind, not ${option}`);
    }
  }
  if (command === "run") {
    for (const needed of ["--init", "--pull=never", "--user"]) {
      if (!options.some((option) => option === needed || option.startsWith(`${needed}=`))) {
        throw new Error(`squeal never runs docker run without ${needed}`);
      }
    }
  }
  return [...words, ...options, ...operands];
}

/** A mount source that is no absolute path, or one that does not exist. */
export function missingMountSources(mounts: readonly BindMount[]): string[] {
  return mounts.map((m) => m.source).filter((source) => !isAbsolute(source) || !existsSync(source));
}

/** `docker image inspect` of `image`, one JSON object per line. */
export function imageInspectArgs(image: string): string[] {
  return guarded("image inspect", ["--format={{json .}}"], ["--", image]);
}

/**
 * `docker run` of an idle container over `spec.imageId`. Its entrypoint is
 * `sleep`, so an image's own entrypoint script never runs. Throws when a
 * mount source is missing: Docker never sees it.
 */
export function runIdleArgs(spec: RunIdleSpec): string[] {
  const missing = missingMountSources(spec.mounts);
  if (missing.length > 0) {
    throw new Error(`squeal mounts no missing path into a container: ${missing.join(", ")}`);
  }
  const options = [
    "--detach",
    "--init",
    "--pull=never",
    `--name=${spec.name}`,
    `--user=${spec.user.uid}:${spec.user.gid}`,
    ...Object.entries(spec.labels).map(([key, value]) => `--label=${key}=${value}`),
    ...(spec.network === undefined ? [] : [`--network=${spec.network}`]),
    ...spec.mounts.map(mountOption),
    ...Object.entries(spec.env).map(([key, value]) => `--env=${key}=${value}`),
    "--entrypoint=sleep",
  ];
  return guarded("run", options, [spec.imageId, "infinity"]);
}

/** One bind mount's option; a comma or quote in a path would split it, so it is refused. */
function mountOption(mount: BindMount): string {
  for (const path of [mount.source, mount.target]) {
    if (/[,"\n]/.test(path)) throw new Error(`squeal mounts no path holding , or ": ${path}`);
  }
  const ro = mount.readonly === true ? ",readonly" : "";
  return `--mount=type=bind,source=${mount.source},target=${mount.target}${ro}`;
}

/** `docker exec -i` of `argv` in `containerId`. */
export function execArgs(containerId: string, argv: readonly string[]): string[] {
  return guarded("exec", ["--interactive"], [containerId, ...argv]);
}

/** The `docker ps` format: tab-separated fields of `ManagedListing`. */
const PS_FORMAT = [
  "{{.ID}}",
  "{{.Names}}",
  "{{.State}}",
  '{{.Label "org.squeal.worktree"}}',
  '{{.Label "org.squeal.target"}}',
  '{{.Label "org.squeal.image"}}',
  '{{.Label "org.squeal.pid"}}',
].join("\t");

/** `docker ps -a` of managed containers matching `filter`. */
export function psArgs(filter: ManagedFilter): string[] {
  const labels = { [MANAGED_LABEL]: "true", ...filter.labels };
  return guarded(
    "ps",
    [
      "--all",
      "--no-trunc",
      ...Object.entries(labels).map(([key, value]) => `--filter=label=${key}=${value}`),
      ...(filter.id === undefined ? [] : [`--filter=id=${filter.id}`]),
      `--format=${PS_FORMAT}`,
    ],
    [],
  );
}

/** `docker rm -f` of one container by ID. */
export function rmArgs(containerId: string): string[] {
  return guarded("rm", ["--force"], ["--", containerId]);
}

/** Parses `docker ps` output in `PS_FORMAT`. */
export function parsePs(text: string): ManagedListing[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [id = "", name = "", state = "", worktree = "", target = "", image = "", pid = ""] =
        line.split("\t");
      return { id, name, state, worktree, target, image, pid };
    });
}

/** Parses one `docker image inspect --format={{json .}}` line. */
export function parseImage(text: string): ImageInfo {
  const raw = JSON.parse(text) as {
    Id?: string;
    RepoDigests?: string[] | null;
    Config?: { Env?: string[] | null } | null;
    Architecture?: string;
    Os?: string;
  };
  if (typeof raw.Id !== "string") throw new Error("docker image inspect gave no Id");
  return {
    id: raw.Id,
    repoDigests: raw.RepoDigests ?? [],
    env: raw.Config?.Env ?? [],
    architecture: raw.Architecture ?? "",
    os: raw.Os ?? "",
  };
}

/** How long a Docker command other than an exec may take. */
const COMMAND_MS = 30_000;

/** The Docker CLI on the `PATH`, as `docker`. */
export function dockerCli(docker = "docker"): DockerCli {
  const run = (args: readonly string[], timeoutMs = COMMAND_MS) =>
    new Promise<ExecText>((resolve) => {
      execFile(
        docker,
        args,
        { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" },
        (error, stdout, stderr) => {
          const code = error === null ? 0 : typeof error.code === "number" ? error.code : null;
          resolve({ code, stdout, stderr: stderr || (error?.message ?? "") });
        },
      );
    });
  const ok = async (args: readonly string[]): Promise<string> => {
    const result = await run(args);
    if (result.code !== 0) {
      throw new Error(`docker ${args[0]} failed: ${result.stderr.trim().slice(-500)}`);
    }
    return result.stdout;
  };
  const cli: DockerCli = {
    imageInspect: async (image) => {
      const result = await run(imageInspectArgs(image));
      if (result.code === 0) return parseImage(result.stdout.trim());
      if (/no such image/i.test(result.stderr)) return null;
      throw new Error(`docker image inspect failed: ${result.stderr.trim().slice(-500)}`);
    },
    runIdle: async (spec) => (await ok(runIdleArgs(spec))).trim(),
    execSyncText: (containerId, argv, timeoutMs) => run(execArgs(containerId, argv), timeoutMs),
    spawnExec: (containerId, argv) =>
      spawn(docker, execArgs(containerId, argv), { stdio: ["pipe", "pipe", "pipe"] }),
    psManaged: async (filter) => parsePs(await ok(psArgs(filter))),
    removeManaged: async (containerId) => {
      const managed = await cli.psManaged({ id: containerId });
      if (!managed.some((listing) => listing.id.startsWith(containerId))) return false;
      await ok(rmArgs(containerId));
      return true;
    },
  };
  return cli;
}
