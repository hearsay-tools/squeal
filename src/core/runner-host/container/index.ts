import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { AbsolutePath } from "../../types/common.js";
import type { ContainerKeyMode, ContainerTarget } from "../../types/policy-containers.js";
import type { HostChannel } from "../channel.js";
import type { RootStat } from "../protocol.js";
import type { HostDeadlines } from "../proxy.js";
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
import type { ContainerTargetState } from "./runner.js";

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

/**
 * Spec 027 D5 (row 027-06): what the daemon gives a container project's
 * runner beside the project itself. Absent, a consented project stays
 * unknown (review 0.1.643 B1): there is no container route to run it on.
 */
export interface ContainerWiring {
  /** Policy `containers`, read at each start. */
  readonly containers: () => Readonly<Record<string, ContainerTarget>>;
  readonly worktreeId: string;
  /** Squeal's bundle, mounted read-only; `squealCliPath` is inside it. */
  readonly bundleDir: string;
  readonly squealCliPath: string;
  /** Squeal's state directory: the worktree's container cache goes under it. */
  readonly stateDir: AbsolutePath;
  /** Where runs write their logs, mounted at its own path. */
  readonly logRoot: AbsolutePath;
  /** Where `containers.json` consent is matched by remote URL. */
  readonly commonDir: AbsolutePath;
  /** This Squeal's version. */
  readonly version: string;
  /** Told each project's target state, for `squeal status`. */
  readonly status?: (summary: ContainerSummaryEntry) => void;
  readonly idleMs?: () => number;
  readonly manager?: ManagerOptions;
  readonly deadlines?: Partial<HostDeadlines>;
  readonly openChannel?: (container: ManagedContainer) => HostChannel;
}

/** One project's container target state, as the daemon keeps it for `squeal status`. */
export interface ContainerSummaryEntry {
  readonly target: string;
  readonly runner: string;
  readonly project: string;
  readonly state: ContainerTargetState;
  readonly keyMode: ContainerKeyMode;
}

/** The runtime files each in-container runner host reads beside its CLI (review 0.1.644 B1). */
const RUNTIME_ASSETS = [
  join("observe", "recorder.cjs"),
  join("jest", "squeal-reporter.cjs"),
  join("pytest", "squeal_pytest.py"),
] as const;

/**
 * Spec 027 D5.1 (review 0.1.644 B1): the Squeal bundle root to mount for
 * the CLI at `cliPath`. An installed bundle has its CLI at
 * `<root>/cli/squeal.mjs` beside `jest/`, `pytest/`, `observe/`,
 * `node-test/` and `code/`; a flat bundle has those beside the CLI. The
 * root holds the CLI and every runtime file; `null` for a source layout
 * or an incomplete directory, which is never mounted.
 */
export function bundleRootFor(cliPath: string): string | null {
  const cli = resolve(cliPath);
  const dir = dirname(cli);
  const candidates = basename(dir) === "cli" ? [dirname(dir), dir] : [dir];
  for (const root of candidates) {
    const inside = relative(root, cli);
    if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) continue;
    if (!existsSync(cli)) continue;
    if (RUNTIME_ASSETS.every((asset) => existsSync(join(root, asset)))) return root;
  }
  return null;
}

/**
 * The same-path mounts of `root`'s containers: the bundle, the logs and a
 * cache directory of the worktree under the state directory, made here so
 * a mount never names a missing path.
 */
export function containerPaths(wiring: ContainerWiring, root: AbsolutePath): ContainerPaths {
  const id = createHash("sha256").update(root).digest("hex").slice(0, 16);
  const worktreeCacheDir = join(wiring.stateDir, "containers", id);
  for (const dir of [worktreeCacheDir, join(worktreeCacheDir, "tmp"), wiring.logRoot]) {
    mkdirSync(dir, { recursive: true });
  }
  return {
    worktreeRoot: root,
    squealBundleDir: wiring.bundleDir,
    worktreeCacheDir,
    worktreeLogRoot: wiring.logRoot,
  };
}

/** A project's temp and pytest cache directories inside the mounted cache (D5.1). */
export function containerWorkDirs(
  paths: ContainerPaths,
  project: string,
): { readonly tempDir: string; readonly cacheDir: string } {
  const id = createHash("sha256").update(project).digest("hex").slice(0, 16);
  const cacheDir = join(paths.worktreeCacheDir, "pytest", id);
  mkdirSync(cacheDir, { recursive: true });
  return { tempDir: join(paths.worktreeCacheDir, "tmp"), cacheDir };
}
