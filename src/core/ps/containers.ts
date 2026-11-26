import { execFile } from "node:child_process";
import { type ManagedListing, parsePs, psArgs } from "../runner-host/container/docker.js";
import { pidAlive } from "../runner-host/container/manager.js";

/*
 * Spec 027 D7.3 (row 027-06): `squeal ps` lists the containers Squeal
 * manages (`org.squeal.managed=true`) beside its daemons, with whether the
 * daemon that owns each still runs. One `docker ps -a` with a short bound:
 * without Docker, or with a daemon that does not answer, the list is empty
 * and `squeal ps` goes on. It never starts, stops or removes a container.
 */

/** A managed container as `squeal ps` shows it. */
export interface PsContainer {
  readonly id: string;
  readonly name: string;
  /** Docker's state: `running`, `exited`, ... */
  readonly state: string;
  readonly worktree: string;
  readonly target: string;
  readonly image: string;
  /** The owning daemon's pid; `null` when the label names none. */
  readonly pid: number | null;
  /** Whether that daemon still runs; a dead one's container is removed at the next start. */
  readonly ownerAlive: boolean;
}

/** How long `docker ps` may take before `squeal ps` goes on without it. */
const PS_MS = 3_000;

/** The managed containers on this host; empty without a Docker that answers in time. */
export function listManagedContainers(
  run: (args: readonly string[]) => Promise<string> = dockerPs,
  alive: (pid: number) => boolean = pidAlive,
): Promise<PsContainer[]> {
  return run(psArgs({}))
    .then((text) => parsePs(text).map((listing) => psContainer(listing, alive)))
    .catch(() => []);
}

/** One listing with its owner read. */
export function psContainer(listing: ManagedListing, alive: (pid: number) => boolean): PsContainer {
  const pid = /^\d+$/.test(listing.pid) ? Number(listing.pid) : null;
  return {
    id: listing.id.slice(0, 12),
    name: listing.name,
    state: listing.state,
    worktree: listing.worktree,
    target: listing.target,
    image: listing.image,
    pid,
    ownerAlive: pid !== null && pid > 0 && alive(pid),
  };
}

/** The `Squeal containers` block of `squeal ps`'s text; none when there are none. */
export function containerBlock(containers: readonly PsContainer[]): string[] {
  if (containers.length === 0) return [];
  const lines = ["", "Squeal containers"];
  for (const c of containers) {
    const owner =
      c.pid === null
        ? "no owning daemon"
        : c.ownerAlive
          ? `daemon ${c.pid}`
          : `daemon ${c.pid} gone, removed at the next start`;
    lines.push(`  ${c.id}  ${c.name}  ${c.state}  target ${c.target} · ${owner}`);
  }
  return lines;
}

function dockerPs(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("docker", args, { timeout: PS_MS, encoding: "utf8" }, (error, stdout) =>
      error === null ? resolve(stdout) : reject(error),
    );
  });
}
