import type { HostChannel } from "../channel.js";
import type { RootStat } from "../protocol.js";
import { dockerCli } from "./docker.js";
import {
  type ChannelOptions,
  type ContainerPaths,
  ensureContainer,
  type ManagedContainer,
  type ManagedTarget,
  type ManagerOptions,
  openRunnerHostChannel,
  verifyMount,
} from "./manager.js";
import type { ContainerRefusal } from "./preflight.js";

/*
 * Spec 027 D5 and D6 (row 027-05): the one call the daemon makes to run a
 * runner host in a container. The managed container is started or reused
 * and its Node checked, the host is started over `docker exec -i`, and
 * `verify` checks the host's `start` reply for a live bind mount before
 * any request reaches it.
 */

/** A runner host in a container, its mount not yet proven. */
export interface ContainerHost {
  readonly ok: true;
  readonly container: ManagedContainer;
  readonly channel: HostChannel;
  /** D6: `rootStat` of the host's `start` reply against the worktree; refused, both end. */
  verify(rootStat: RootStat | undefined): Promise<{ readonly ok: true } | ContainerRefusal>;
}

/** Starts `squeal runner-host` for `channel.runner` in the managed container of `target`. */
export async function startContainerHost(
  worktreeId: string,
  target: ManagedTarget,
  paths: ContainerPaths,
  channel: Omit<ChannelOptions, "cli" | "worktreeRoot">,
  options: ManagerOptions = {},
): Promise<ContainerHost | ContainerRefusal> {
  const cli = options.cli ?? dockerCli();
  const ensured = await ensureContainer(worktreeId, target, paths, { ...options, cli });
  if (!ensured.ok) return ensured;
  const { container } = ensured;
  const opened = openRunnerHostChannel(container, {
    ...channel,
    worktreeRoot: paths.worktreeRoot,
    cli,
  });
  return {
    ok: true,
    container,
    channel: opened,
    verify: (rootStat) => verifyMount(paths.worktreeRoot, rootStat, { channel: opened, container }),
  };
}
