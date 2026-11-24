import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  describeProblems,
  type Kept,
  loadConfigFile,
  type Shape,
} from "../../daemon/config-file.js";
import { userConfigPath } from "../../daemon/user-config.js";
import { isRecord } from "../../fs/json.js";
import type { AbsolutePath } from "../../types/common.js";
import { PROVIDER_KINDS, providerOf } from "./providers/index.js";

export { validTarget } from "./ssh.js";

/*
 * Spec 021 D9 (row 021-13): a remote lane is off until the user names one.
 * The SSH target is the user's, not the repository's, so it lives beside
 * the user-level config: `$XDG_CONFIG_HOME/squeal/remote.json` (default
 * `~/.config/squeal/remote.json`), never committed. Per repository, named
 * by its root path or one of its remote URLs: the target, the runner, the
 * lanes it serves, what happens when it is lost (D13), and where the
 * remote's Node and cache are. A repository's `squeal.config.json` may
 * forbid it (`remote.allowed: false`). Under 001 D11's loader rules: a bad
 * entry is one problem and is left out; the others are kept.
 *
 *     { "repositories": { "/home/me/app": { "target": "build-box" } } }
 */

export const REMOTE_FILE = "remote.json";

/** What the remote's lane does when its host is lost or hung (spec 021 D13). */
export type WhenLost = "local" | "not-run";

/** The runners a remote may serve (spec 026 D6.4). */
export const REMOTE_RUNNERS = ["vitest", "node-test", "pytest"] as const;
export type RemoteRunner = (typeof REMOTE_RUNNERS)[number];
/** The tiers a remote may serve (spec 026 D6.4). */
export const REMOTE_TIERS = ["background", "edit", "slow", "group"] as const;
export type RemoteTier = (typeof REMOTE_TIERS)[number];

/** Spec 026 D11: the connect-time disk check. */
export interface DiskCheck {
  readonly enabled: boolean;
  readonly maxWriteMs: number;
  readonly onSlowDisk: "warn" | "refuse";
}

/** One repository's remote lane. */
export interface RemoteLane {
  /** Spec 026 D6.4: the provider kind, `ssh` when the entry names none. */
  readonly provider: string;
  /**
   * The config the provider gets: the entry's `providerConfig` over its
   * `node` and `cache`, and for `ssh` its top-level `target`.
   */
  readonly providerConfig: Readonly<Record<string, unknown>>;
  /** The SSH destination of an `ssh` lane: a `Host` of the user's ssh config, or `user@host`. */
  readonly target?: string;
  /** The runners whose tiers go remote; `runner` names one (spec 021 D12). */
  readonly runners: readonly RemoteRunner[];
  /** The tiers it serves; 021 D12: `background`, the start and restart baselines and the backlog. */
  readonly lanes: readonly RemoteTier[];
  readonly planning: "local" | "remote";
  readonly coverage: "off" | "remote";
  readonly environmentMode: "match-local" | "remote-key";
  /** Absent: the machine's default (`idleSleepMinutesOf`). */
  readonly idleSleepMinutes?: number;
  readonly diskCheck: DiskCheck;
  readonly whenLost: WhenLost;
  /** The user's Node on the remote: `node` on the login's `PATH`, or a path. */
  readonly node: string;
  /** The remote cache directory, relative to the remote home or absolute; Squeal's part is `squeal/` in it. */
  readonly cache: string;
}

/**
 * Row 021-25: the cache's default is a directory of its own under the
 * remote home, not `.cache`, which hosts such as boat.dev drop when they
 * save a machine (`boat-trial.md` D4): its loss sent Squeal's copy and the
 * whole tree again, and installed again, at each restore.
 */
export const LANE_DEFAULTS = {
  provider: "ssh",
  runners: ["vitest"],
  lanes: ["background"],
  environmentMode: "match-local",
  diskCheck: { enabled: true, maxWriteMs: 10, onSlowDisk: "warn" },
  whenLost: "local",
  node: "node",
  cache: ".squeal-remote",
} as const satisfies Partial<RemoteLane>;

/** D6.4: `idleSleepMinutes`, else 10 for a machine that sleeps on idle, 0 for one that does not. */
export function idleSleepMinutesOf(lane: RemoteLane, sleepOnIdle: boolean): number {
  return lane.idleSleepMinutes ?? (sleepOnIdle ? 10 : 0);
}

/** A display name for the lane's notes before a machine is acquired: the target, else the provider. */
export function laneLabel(lane: RemoteLane): string {
  return lane.target ?? lane.provider;
}

export interface RemoteSettings {
  readonly path: AbsolutePath;
  /** By repository root path (as `realpath` gives it) or remote URL. */
  readonly repositories: Readonly<Record<string, RemoteLane>>;
  readonly problems: readonly string[];
}

/** `remote.json` beside the user-level `config.json` (`userConfigPath`). */
export function remoteSettingsPath(env: NodeJS.ProcessEnv = process.env): AbsolutePath {
  return join(dirname(userConfigPath(env)), REMOTE_FILE);
}

/** Reads `remote.json`; never throws; a missing file names no lane. */
export function loadRemoteSettings(env: NodeJS.ProcessEnv = process.env): RemoteSettings {
  const path = remoteSettingsPath(env);
  const { value, problems } = loadConfigFile(path, SHAPE, { repositories: {} });
  return { path, repositories: value.repositories as Record<string, RemoteLane>, problems };
}

/** The settings' problems as one note's text, or `null`. */
export function settingsNote(settings: RemoteSettings): string | null {
  return settings.problems.length === 0
    ? null
    : `${settings.path}: ${describeProblems(settings.problems)}`;
}

/**
 * The lane `settings` name for the repository at `repositoryRoot` whose Git
 * common directory is `commonDir`: by its root first, then by any of its
 * remotes' URLs. `null`: none, the default.
 */
export function remoteLaneFor(
  settings: RemoteSettings,
  repositoryRoot: AbsolutePath,
  commonDir: AbsolutePath,
): { readonly key: string; readonly lane: RemoteLane } | null {
  const byRoot = settings.repositories[normalize(repositoryRoot)];
  if (byRoot !== undefined) return { key: normalize(repositoryRoot), lane: byRoot };
  for (const url of remoteUrls(commonDir)) {
    const lane = settings.repositories[url];
    if (lane !== undefined) return { key: url, lane };
  }
  return null;
}

/** The `url` of each `[remote "<name>"]` in the common directory's `config`. */
export function remoteUrls(commonDir: AbsolutePath): string[] {
  let text: string;
  try {
    text = readFileSync(join(commonDir, "config"), "utf8");
  } catch {
    return [];
  }
  const urls: string[] = [];
  let remote = false;
  for (const line of text.split("\n")) {
    const section = /^\s*\[\s*([^\]\s"]+)(?:\s+"([^"]*)")?\s*\]/.exec(line);
    if (section !== null) {
      remote = section[1]?.toLowerCase() === "remote";
      continue;
    }
    const url = remote ? /^\s*url\s*=\s*(.*?)\s*$/i.exec(line) : null;
    if (url?.[1]) urls.push(url[1].replace(/^"(.*)"$/, "$1"));
  }
  return urls;
}

const ENTRY_KEYS = [
  "provider",
  "providerConfig",
  "target",
  "runner",
  "runners",
  "lanes",
  "planning",
  "coverage",
  "environmentMode",
  "idleSleepMinutes",
  "diskCheck",
  "whenLost",
  "node",
  "cache",
] as const;

/** `value` as `"all"` or a non-empty array of `known`; `null` when it is neither. */
function setOf<T extends string>(value: unknown, known: readonly T[]): readonly T[] | null {
  if (value === "all") return known;
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.every((v) => (known as readonly unknown[]).includes(v)) ? (value as T[]) : null;
}

/** `value` when it is one of `known`, `fallback` when absent, `null` when it is something else. */
function oneOf<T extends string>(value: unknown, known: readonly T[], fallback: T): T | null {
  if (value === undefined) return fallback;
  return (known as readonly unknown[]).includes(value) ? (value as T) : null;
}

const quoted = (known: readonly string[]) => known.map((k) => `"${k}"`).join(", ");

type Made<T> = T | { readonly problem: string };
type Entry = Record<string, unknown>;

/** Why `entry` is not a lane, or the lane it makes. */
function laneOf(entry: unknown): { lane: RemoteLane } | { problem: string } {
  if (!isRecord(entry)) return { problem: `must be an object, got ${JSON.stringify(entry)}` };
  const unknown = Object.keys(entry).find(
    (key) => !(ENTRY_KEYS as readonly string[]).includes(key),
  );
  if (unknown !== undefined) return { problem: `has unknown key "${unknown}"` };
  const machine = machineOf(entry);
  if ("problem" in machine) return machine;
  const tiers = tiersOf(entry);
  if ("problem" in tiers) return tiers;
  const lifecycle = lifecycleOf(entry);
  if ("problem" in lifecycle) return lifecycle;
  return { lane: { ...machine, ...tiers, ...lifecycle } };
}

/** D6.4: the provider and its config, with the entry's `node`, `cache` and `target`. */
function machineOf(
  entry: Entry,
): Made<Pick<RemoteLane, "provider" | "providerConfig" | "target" | "node" | "cache">> {
  const kind = entry.provider ?? LANE_DEFAULTS.provider;
  const provider = typeof kind === "string" ? providerOf(kind) : null;
  if (provider === null) return { problem: `"provider" must be one of ${quoted(PROVIDER_KINDS)}` };
  if (entry.target !== undefined && provider.kind !== "ssh") {
    return {
      problem: '"target" applies to provider "ssh" only; name the machine in "providerConfig"',
    };
  }
  if (entry.providerConfig !== undefined && !isRecord(entry.providerConfig)) {
    return { problem: '"providerConfig" must be an object' };
  }
  const providerConfig: Record<string, unknown> = {
    node: entry.node ?? LANE_DEFAULTS.node,
    cache: entry.cache ?? LANE_DEFAULTS.cache,
    ...(entry.target === undefined ? {} : { target: entry.target }),
    ...(entry.providerConfig as Entry | undefined),
  };
  const problem = provider.validate(providerConfig);
  if (problem !== null) return { problem };
  const { target } = providerConfig;
  return {
    provider: provider.kind,
    providerConfig,
    ...(provider.kind === "ssh" && typeof target === "string" ? { target } : {}),
    node: providerConfig.node as string,
    cache: providerConfig.cache as string,
  };
}

/** D6.4: the runners and tiers that go remote, and where they plan and map coverage. */
function tiersOf(
  entry: Entry,
): Made<Pick<RemoteLane, "runners" | "lanes" | "planning" | "coverage" | "environmentMode">> {
  if (entry.runner !== undefined && entry.runners !== undefined) {
    return { problem: 'names both "runner" and "runners"; keep "runners"' };
  }
  const named = entry.runner === undefined ? entry.runners : [entry.runner];
  const runners = setOf(named ?? LANE_DEFAULTS.runners, REMOTE_RUNNERS);
  if (runners === null) {
    return { problem: `"runners" must be "all" or some of ${quoted(REMOTE_RUNNERS)}` };
  }
  const lanes = setOf(entry.lanes ?? LANE_DEFAULTS.lanes, REMOTE_TIERS);
  if (lanes === null)
    return { problem: `"lanes" must be "all" or some of ${quoted(REMOTE_TIERS)}` };
  // D6.4: an edit tier plans and maps coverage on the remote unless told otherwise.
  const editing = lanes.includes("edit");
  const planning = oneOf(entry.planning, ["local", "remote"], editing ? "remote" : "local");
  if (planning === null) return { problem: '"planning" must be "local" or "remote"' };
  const coverage = oneOf(entry.coverage, ["off", "remote"], editing ? "remote" : "off");
  if (coverage === null) return { problem: '"coverage" must be "off" or "remote"' };
  const environmentMode = oneOf(
    entry.environmentMode,
    ["match-local", "remote-key"],
    LANE_DEFAULTS.environmentMode,
  );
  if (environmentMode === null) {
    return { problem: '"environmentMode" must be "match-local" or "remote-key"' };
  }
  return { runners, lanes, planning, coverage, environmentMode };
}

/** D6.4, 021 D13: idle sleep, the disk check, and what happens when the remote is lost. */
function lifecycleOf(
  entry: Entry,
): Made<Pick<RemoteLane, "idleSleepMinutes" | "diskCheck" | "whenLost">> {
  const idle = entry.idleSleepMinutes;
  if (idle !== undefined && !(typeof idle === "number" && Number.isFinite(idle) && idle >= 0)) {
    return { problem: '"idleSleepMinutes" must be a number of 0 or more' };
  }
  const diskCheck = diskCheckOf(entry.diskCheck);
  if (typeof diskCheck === "string") return { problem: diskCheck };
  const whenLost = oneOf(entry.whenLost, ["local", "not-run"], LANE_DEFAULTS.whenLost);
  if (whenLost === null) return { problem: '"whenLost" must be "local" or "not-run"' };
  return {
    ...(idle === undefined ? {} : { idleSleepMinutes: idle as number }),
    diskCheck,
    whenLost,
  };
}

/** `diskCheck` with its defaults filled in, or why it is not one. */
function diskCheckOf(value: unknown): DiskCheck | string {
  if (value === undefined) return LANE_DEFAULTS.diskCheck;
  if (!isRecord(value)) return '"diskCheck" must be an object';
  const unknown = Object.keys(value).find(
    (k) => !["enabled", "maxWriteMs", "onSlowDisk"].includes(k),
  );
  if (unknown !== undefined) return `"diskCheck" has unknown key "${unknown}"`;
  const check = { ...LANE_DEFAULTS.diskCheck, ...value };
  if (typeof check.enabled !== "boolean") return '"diskCheck.enabled" must be true or false';
  if (!(typeof check.maxWriteMs === "number" && check.maxWriteMs > 0)) {
    return '"diskCheck.maxWriteMs" must be a positive number';
  }
  if (check.onSlowDisk !== "warn" && check.onSlowDisk !== "refuse") {
    return '"diskCheck.onSlowDisk" must be "warn" or "refuse"';
  }
  return check as DiskCheck;
}

/** `repositories`: from a root path or a remote URL to a lane; a bad entry is left out. */
const repositories = (value: unknown): string | Kept => {
  if (!isRecord(value)) return "an object from repository root path or remote URL to a lane";
  const kept: Record<string, RemoteLane> = {};
  const problems: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    const made = laneOf(entry);
    if ("problem" in made) {
      problems.push(`"repositories[${key}]" ${made.problem}; it is left out`);
      continue;
    }
    kept[isAbsolute(key) ? normalize(key) : key] = made.lane;
  }
  return { kept, problems };
};

const SHAPE: Shape = { repositories };

function normalize(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}
