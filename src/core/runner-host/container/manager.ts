import { createHash, randomBytes } from "node:crypto";
import { PassThrough } from "node:stream";
import { channelOf, type HostChannel } from "../channel.js";
import { frameOf, type HostRunner, type RootStat } from "../protocol.js";
import {
  type BindMount,
  type DockerCli,
  dockerCli,
  MANAGED_LABEL,
  type ManagedListing,
  missingMountSources,
} from "./docker.js";
import { type ContainerRefusal, checkNode, proveMount } from "./preflight.js";

/*
 * Spec 027 D5 (row 027-05): one idle, labelled container per worktree and
 * target, its runner host started over `docker exec -i`. The worktree,
 * Squeal's bundle, the worktree's cache and its logs are mounted at their
 * own paths, so no path is mapped; the container runs as the host's user
 * with `HOME=/tmp` and its bytecode in the cache, so no root-owned file and
 * no `.pyc` lands in the worktree. A missing image is refused, never pulled
 * or built; a Node older than 22.19 removes the container at once.
 */

/** The labels of a managed container. */
export const LABELS = {
  managed: MANAGED_LABEL,
  worktree: "org.squeal.worktree",
  target: "org.squeal.target",
  image: "org.squeal.image",
  pid: "org.squeal.pid",
  /** Review 0.1.643 N3: the launch stamp (`launchStamp`) a reused container must carry. */
  config: "org.squeal.config",
} as const;

/** What the manager reads of a container target: the image, its network and its env. */
export interface ManagedTarget {
  readonly name: string;
  readonly image: string;
  /** Resolved already (consent's `networkOverride` and `{composeProject}`); absent, Docker's default. */
  readonly network?: string;
  /** Spec 027 D4: the working directory inside; part of the launch stamp only. */
  readonly workdir?: string;
  readonly env?: Readonly<Record<string, string>>;
}

/** The host paths a container mounts at the same path. */
export interface ContainerPaths {
  readonly worktreeRoot: string;
  /** Squeal's bundle, read-only. */
  readonly squealBundleDir: string;
  readonly worktreeCacheDir: string;
  readonly worktreeLogRoot: string;
}

export interface ManagerOptions {
  readonly cli?: DockerCli;
  /** The owning daemon's process; default this one. */
  readonly pid?: number;
  /** Default the process's own uid and gid. */
  readonly user?: { readonly uid: number; readonly gid: number };
  /** The name's last part; default 6 random hex digits. */
  readonly nonce?: () => string;
  /** Whether a container's owning daemon lives; default `pidAlive`. */
  readonly isPidAlive?: (pid: number) => boolean;
}

/** A started container that passed its Node check. */
export interface ManagedContainer {
  readonly id: string;
  readonly name: string;
  readonly imageId: string;
  readonly target: string;
  /** `docker rm -f` of this container. */
  close(): Promise<void>;
}

export type Ensured =
  | { readonly ok: true; readonly container: ManagedContainer }
  | ContainerRefusal;

/** `squeal-ct-<wt8>-<target>-<nonce>`, with what Docker refuses in a name replaced. */
export function containerName(worktreeId: string, target: string, nonce: string): string {
  const safe = (text: string) => text.replace(/[^a-zA-Z0-9_.-]/g, "-");
  return `squeal-ct-${safe(worktreeId.slice(0, 8))}-${safe(target)}-${safe(nonce)}`;
}

/** The four same-path mounts, the bundle read-only. */
export function containerMounts(paths: ContainerPaths): BindMount[] {
  return [
    { source: paths.worktreeRoot, target: paths.worktreeRoot },
    { source: paths.squealBundleDir, target: paths.squealBundleDir, readonly: true },
    { source: paths.worktreeCacheDir, target: paths.worktreeCacheDir },
    { source: paths.worktreeLogRoot, target: paths.worktreeLogRoot },
  ];
}

/** `HOME=/tmp`, the bytecode prefix in the cache, then the target's own. */
export function containerEnv(paths: ContainerPaths, target: ManagedTarget): Record<string, string> {
  return {
    HOME: "/tmp",
    PYTHONPYCACHEPREFIX: `${paths.worktreeCacheDir}/pycache`,
    ...target.env,
  };
}

/**
 * Review 0.1.643 N3: a short stamp of what a container was launched with,
 * its mounts, network, working directory and env. A running container is
 * reused only when its `org.squeal.config` label is this stamp, so a
 * changed bundle, cache or log path, network or env starts a new one.
 */
export function launchStamp(paths: ContainerPaths, target: ManagedTarget): string {
  const env = containerEnv(paths, target);
  const stamp = JSON.stringify({
    mounts: containerMounts(paths),
    network: target.network ?? null,
    workdir: target.workdir ?? null,
    env: Object.keys(env)
      .sort()
      .map((name) => [name, env[name]]),
  });
  return createHash("sha256").update(stamp).digest("hex").slice(0, 16);
}

/**
 * The running managed container of `worktreeId` and `target` on the image
 * `target.image` names now, started when there is none, and checked for
 * Node. One of another image, or stopped, is removed first; one another
 * live daemon owns is left alone.
 */
export async function ensureContainer(
  worktreeId: string,
  target: ManagedTarget,
  paths: ContainerPaths,
  options: ManagerOptions = {},
): Promise<Ensured> {
  const cli = options.cli ?? dockerCli();
  const pid = options.pid ?? process.pid;
  const image = await cli.imageInspect(target.image).catch((error: unknown) => error as Error);
  if (image instanceof Error) return unreachable(target.name, image);
  if (image === null) {
    return {
      ok: false,
      state: "image-missing",
      note: `container ${target.name}: no local image ${target.image}; Squeal never builds or pulls one, so build it and its tests run`,
    };
  }
  const listed = await cli
    .psManaged({ labels: { [LABELS.worktree]: worktreeId, [LABELS.target]: target.name } })
    .catch((error: unknown) => error as Error);
  if (listed instanceof Error) return unreachable(target.name, listed);
  const alive = options.isPidAlive ?? pidAlive;
  const managed = (id: string, name: string) => managedHandle(cli, id, name, image.id, target.name);
  const own = listed.filter((c) => c.pid === String(pid) || !ownerAlive(c.pid, alive));
  const stamp = launchStamp(paths, target);
  const candidate = own.find(
    (c) => c.pid === String(pid) && c.state === "running" && c.image === image.id,
  );
  // N3: the listing names no stamp, so the candidate is listed again by its stamp's label.
  const stamped =
    candidate === undefined
      ? []
      : await cli
          .psManaged({ labels: { [LABELS.config]: stamp }, id: candidate.id })
          .catch(() => []);
  const reused = stamped.some((c) => c.id === candidate?.id) ? candidate : undefined;
  for (const stale of own) if (stale !== reused) await cli.removeManaged(stale.id).catch(() => {});
  if (reused !== undefined) return { ok: true, container: managed(reused.id, reused.name) };

  const mounts = containerMounts(paths);
  const missing = missingMountSources(mounts);
  if (missing.length > 0) {
    return {
      ok: false,
      state: "mount-source-missing",
      note: `container ${target.name}: ${missing.join(", ")} does not exist on the host; Squeal mounts no missing path`,
    };
  }
  const name = containerName(worktreeId, target.name, (options.nonce ?? nonce)());
  let id: string;
  try {
    id = await cli.runIdle({
      name,
      imageId: image.id,
      user: options.user ?? hostUser(),
      labels: {
        [LABELS.managed]: "true",
        [LABELS.worktree]: worktreeId,
        [LABELS.target]: target.name,
        [LABELS.image]: image.id,
        [LABELS.pid]: String(pid),
        [LABELS.config]: stamp,
      },
      ...(target.network === undefined ? {} : { network: target.network }),
      mounts,
      env: containerEnv(paths, target),
    });
  } catch (error) {
    return {
      ok: false,
      state: "start-failed",
      note: `container ${target.name}: docker run failed: ${(error as Error).message}`,
    };
  }
  const node = await checkNode(cli, id, target.name);
  if (!node.ok) {
    await cli.removeManaged(id).catch(() => {});
    return node;
  }
  return { ok: true, container: managed(id, name) };
}

function managedHandle(
  cli: DockerCli,
  id: string,
  name: string,
  imageId: string,
  target: string,
): ManagedContainer {
  return {
    id,
    name,
    imageId,
    target,
    close: async () => {
      await cli.removeManaged(id);
    },
  };
}

/** What `openRunnerHostChannel` starts. */
export interface ChannelOptions {
  /** Squeal's CLI script, inside `squealBundleDir`. */
  readonly squealCliPath: string;
  readonly worktreeRoot: string;
  readonly runner: HostRunner;
  readonly cli?: DockerCli;
}

/** `squeal runner-host` in `container` over `docker exec -i`. */
export function openRunnerHostChannel(
  container: ManagedContainer,
  options: ChannelOptions,
): HostChannel {
  const cli = options.cli ?? dockerCli();
  const argv = [
    "node",
    "--disable-warning=ExperimentalWarning",
    options.squealCliPath,
    "runner-host",
    options.worktreeRoot,
    "--runner",
    options.runner,
  ];
  return channelOf(cli.spawnExec(container.id, argv));
}

/**
 * D6: `channel` with its output read on the way through, so the `rootStat`
 * of the host's `start` reply is known once the proxy's start resolved;
 * the proxy itself keeps no field it does not read.
 */
export function rootStatTap(channel: HostChannel): {
  readonly channel: HostChannel;
  rootStat(): RootStat | undefined;
} {
  const output = new PassThrough();
  output.setEncoding("utf8");
  let found: RootStat | undefined;
  let seen = false;
  let partial = "";
  channel.output.on("data", (chunk: string | Buffer) => {
    const text = String(chunk);
    if (!seen) {
      const lines = (partial + text).split("\n");
      partial = lines.pop() ?? "";
      for (const line of lines) {
        const frame = frameOf(line);
        if (frame === null) continue;
        let reply: { r?: { protocol?: unknown; rootStat?: RootStat } | null } = {};
        try {
          reply = JSON.parse(frame) as typeof reply;
        } catch {
          continue;
        }
        if (reply.r === undefined || reply.r === null || reply.r.protocol === undefined) continue;
        seen = true;
        found = reply.r.rootStat;
        break;
      }
    }
    output.write(text);
  });
  channel.output.on("end", () => output.end());
  return { channel: { ...channel, output }, rootStat: () => found };
}

/**
 * D6: the started host's `rootStat` is the worktree's own; else the channel
 * is ended, the container removed and the refusal returned.
 */
export async function verifyMount(
  hostRoot: string,
  rootStat: RootStat | undefined,
  opened: { readonly channel: HostChannel; readonly container: ManagedContainer },
): Promise<{ readonly ok: true } | ContainerRefusal> {
  const proof = proveMount(hostRoot, rootStat, opened.container.target);
  if (proof.ok) return proof;
  opened.channel.kill();
  await opened.container.close().catch(() => {});
  return proof;
}

/**
 * D5.4: removes the managed containers of `worktreeId` whose owning
 * daemon is dead, or that name no owner. Resolves with their IDs.
 */
export async function reapOrphanedContainers(
  worktreeId: string,
  options: { readonly cli?: DockerCli; readonly isPidAlive?: (pid: number) => boolean } = {},
): Promise<string[]> {
  const cli = options.cli ?? dockerCli();
  const alive = options.isPidAlive ?? pidAlive;
  const listed = await cli.psManaged({ labels: { [LABELS.worktree]: worktreeId } });
  const orphans = listed.filter((c: ManagedListing) => !ownerAlive(c.pid, alive));
  const removed: string[] = [];
  for (const orphan of orphans) {
    if (await cli.removeManaged(orphan.id).catch(() => false)) removed.push(orphan.id);
  }
  return removed;
}

function ownerAlive(label: string, alive: (pid: number) => boolean): boolean {
  const pid = Number(label);
  return /^\d+$/.test(label) && pid > 0 && alive(pid);
}

/** Whether process `pid` exists: `kill 0` fails with `ESRCH` only for one that does not. */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function hostUser(): { uid: number; gid: number } {
  if (process.getuid === undefined || process.getgid === undefined) {
    throw new Error("squeal runs containers only where the host user has a uid and a gid");
  }
  return { uid: process.getuid(), gid: process.getgid() };
}

function nonce(): string {
  return randomBytes(3).toString("hex");
}

function unreachable(target: string, error: Error): ContainerRefusal {
  return {
    ok: false,
    state: "docker-unreachable",
    note: `container ${target}: Docker did not answer: ${error.message}`,
  };
}
