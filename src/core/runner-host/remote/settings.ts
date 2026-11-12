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

/** One repository's remote lane. */
export interface RemoteLane {
  /** The SSH destination: a `Host` of the user's ssh config, or `user@host`. */
  readonly target: string;
  /** The runner whose tiers go remote: Vitest first (D12). */
  readonly runner: "vitest";
  /** The tiers it serves: `background`, the start and restart baselines and the backlog (D12). */
  readonly lanes: readonly "background"[];
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
export const LANE_DEFAULTS: Omit<RemoteLane, "target"> = {
  runner: "vitest",
  lanes: ["background"],
  whenLost: "local",
  node: "node",
  cache: ".squeal-remote",
};

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

/** An SSH destination ssh takes as one: no leading `-` (an option), no space or control character. */
export function validTarget(target: unknown): target is string {
  return typeof target === "string" && /^[^-\s][^\s]*$/.test(target) && !/\p{Cc}/u.test(target);
}

const ENTRY_KEYS = ["target", "runner", "lanes", "whenLost", "node", "cache"] as const;

/** Why `entry` is not a lane, or `null` with the lane it makes. */
function laneOf(entry: unknown): { lane: RemoteLane } | { problem: string } {
  if (!isRecord(entry)) return { problem: `must be an object, got ${JSON.stringify(entry)}` };
  const unknown = Object.keys(entry).find(
    (key) => !(ENTRY_KEYS as readonly string[]).includes(key),
  );
  if (unknown !== undefined) return { problem: `has unknown key "${unknown}"` };
  const lane = { ...LANE_DEFAULTS, ...entry } as RemoteLane;
  if (!validTarget(lane.target)) {
    return { problem: '"target" must be an SSH destination such as "build-box" or "me@host"' };
  }
  if (lane.runner !== "vitest") return { problem: '"runner" must be "vitest"' };
  if (
    !Array.isArray(lane.lanes) ||
    lane.lanes.length === 0 ||
    lane.lanes.some((l) => l !== "background")
  ) {
    return { problem: '"lanes" must be ["background"]' };
  }
  if (lane.whenLost !== "local" && lane.whenLost !== "not-run") {
    return { problem: '"whenLost" must be "local" or "not-run"' };
  }
  for (const key of ["node", "cache"] as const) {
    if (typeof lane[key] !== "string" || lane[key] === "" || /\p{Cc}/u.test(lane[key])) {
      return { problem: `"${key}" must be a non-empty string` };
    }
  }
  return { lane };
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
