import { realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  describeProblems,
  type Kept,
  loadConfigFile,
  type Shape,
} from "../../daemon/config-file.js";
import { dockerToken } from "../../daemon/policy-containers.js";
import { commandName } from "../../daemon/policy-remote.js";
import { userConfigPath } from "../../daemon/user-config.js";
import { isRecord } from "../../fs/json.js";
import type { AbsolutePath } from "../../types/common.js";
import type { ContainerTarget } from "../../types/policy-containers.js";
import { remoteUrls } from "../remote/settings.js";

/*
 * Spec 027 D4 (row 027-04): a repository's `containers` declare targets;
 * only the user allows Squeal to run them, in their own
 * `$XDG_CONFIG_HOME/squeal/containers.json` (default
 * `~/.config/squeal/containers.json`), never committed, as `remote.json`
 * names a remote lane (spec 021 D9). Per repository, by its root path or
 * one of its remote URLs. Under 001 D11's loader rules: a bad entry is one
 * problem and is left out; the others are kept. Reading consent never
 * starts `docker`.
 *
 *     { "allow": { "/home/me/app": { "enabled": true, "targets": ["backend"] } } }
 */

export const CONTAINERS_FILE = "containers.json";

/** One repository's consent. */
export interface ContainerConsent {
  /** Only `true` allows any target. */
  readonly enabled: boolean;
  /** The targets allowed: `"all"`, or their names. */
  readonly targets: "all" | readonly string[];
  /** Fills `{composeProject}` in a target's network. */
  readonly composeProject?: string;
  /** The network every target joins in place of its declared one. */
  readonly networkOverride?: string;
}

export interface ContainerConsentSettings {
  readonly path: AbsolutePath;
  /** By repository root path (as `realpath` gives it) or remote URL. */
  readonly allow: Readonly<Record<string, ContainerConsent>>;
  readonly problems: readonly string[];
}

/** `containers.json` beside the user-level `config.json` (`userConfigPath`). */
export function containerConsentPath(env: NodeJS.ProcessEnv = process.env): AbsolutePath {
  return join(dirname(userConfigPath(env)), CONTAINERS_FILE);
}

/** Reads `containers.json`; never throws; a missing file allows nothing. */
export function loadContainerConsent(
  env: NodeJS.ProcessEnv = process.env,
): ContainerConsentSettings {
  const path = containerConsentPath(env);
  const { value, problems } = loadConfigFile(path, SHAPE, { allow: {} });
  return { path, allow: value.allow as Record<string, ContainerConsent>, problems };
}

/** The settings' problems as one note's text, or `null`. */
export function consentSettingsNote(settings: ContainerConsentSettings): string | null {
  return settings.problems.length === 0
    ? null
    : `${settings.path}: ${describeProblems(settings.problems)}`;
}

/**
 * The consent `settings` hold for the repository at `repositoryRoot` whose
 * Git common directory is `commonDir`: by its root first, then by any of
 * its remotes' URLs (`remoteLaneFor`'s order). `null`: none, so no target runs.
 */
export function containerConsentFor(
  settings: ContainerConsentSettings,
  repositoryRoot: AbsolutePath,
  commonDir: AbsolutePath,
): { readonly key: string; readonly consent: ContainerConsent } | null {
  const root = normalize(repositoryRoot);
  const byRoot = settings.allow[root];
  if (byRoot !== undefined) return { key: root, consent: byRoot };
  for (const url of remoteUrls(commonDir)) {
    const consent = settings.allow[url];
    if (consent !== undefined) return { key: url, consent };
  }
  return null;
}

/** True when `consent` is enabled and allows `targetName`. */
export function isTargetConsented(
  consent: ContainerConsent | null | undefined,
  targetName: string,
): boolean {
  if (consent?.enabled !== true) return false;
  return consent.targets === "all" || consent.targets.includes(targetName);
}

/**
 * The network `target` joins under `consent`: `networkOverride` over the
 * declared `network`, with `{composeProject}` filled in. A problem when it
 * holds `{composeProject}` and the consent sets none. `network` absent:
 * Docker's default.
 */
export function resolveContainerNetwork(
  target: Pick<ContainerTarget, "network">,
  consent: Pick<ContainerConsent, "composeProject" | "networkOverride"> | null,
): { readonly network?: string } | { readonly problem: string } {
  const named = consent?.networkOverride ?? target.network;
  if (named === undefined) return {};
  if (!named.includes(COMPOSE_PROJECT)) return { network: named };
  const project = consent?.composeProject;
  if (project === undefined) {
    return {
      problem: `network ${JSON.stringify(named)} needs "composeProject" in ${CONTAINERS_FILE}, which this repository's entry does not set`,
    };
  }
  return { network: named.replaceAll(COMPOSE_PROJECT, project) };
}

const COMPOSE_PROJECT = "{composeProject}";

/** Why the files of `project`, which runs in `targetName`, stay unknown without consent. */
export function unconsentedNote(project: string, targetName: string, settingsPath: string): string {
  return (
    `project ${JSON.stringify(project)} runs in container target ${JSON.stringify(targetName)}, which this machine has not allowed: its files stay unknown. ` +
    `Run \`squeal setup\` to allow it in ${settingsPath}. ` +
    "Allowing it lets Squeal run docker, and access to the Docker socket is root-equivalent on this host."
  );
}

const ENTRY_KEYS: readonly string[] = ["enabled", "targets", "composeProject", "networkOverride"];

/** Why `entry` is not a consent, or the consent it makes. */
function consentOf(entry: unknown): { consent: ContainerConsent } | { problem: string } {
  if (!isRecord(entry)) return { problem: `must be an object, got ${JSON.stringify(entry)}` };
  const unknown = Object.keys(entry).find((key) => !ENTRY_KEYS.includes(key));
  if (unknown !== undefined) return { problem: `has unknown key "${unknown}"` };
  const { enabled, targets, composeProject, networkOverride } = entry;
  if (typeof enabled !== "boolean") return { problem: '"enabled" must be true or false' };
  const named =
    Array.isArray(targets) &&
    targets.length > 0 &&
    targets.every((t) => typeof t === "string" && commandName(t));
  if (targets !== "all" && !named) {
    return { problem: '"targets" must be "all" or a non-empty array of target names' };
  }
  for (const [key, value] of Object.entries({ composeProject, networkOverride })) {
    if (value !== undefined && !dockerToken(value)) {
      return { problem: `"${key}" must be a name with no space, control character or leading "-"` };
    }
  }
  return {
    consent: {
      enabled,
      targets: targets as ContainerConsent["targets"],
      ...(composeProject === undefined ? {} : { composeProject: composeProject as string }),
      ...(networkOverride === undefined ? {} : { networkOverride: networkOverride as string }),
    },
  };
}

/** `allow`: from a root path or a remote URL to a consent; a bad entry is left out. */
const allow = (value: unknown): string | Kept => {
  if (!isRecord(value)) return "an object from repository root path or remote URL to a consent";
  const kept: Record<string, ContainerConsent> = {};
  const problems: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    const made = consentOf(entry);
    if ("problem" in made) problems.push(`"allow[${key}]" ${made.problem}; it is left out`);
    else kept[isAbsolute(key) ? normalize(key) : key] = made.consent;
  }
  return { kept, problems };
};

const SHAPE: Shape = { allow };

function normalize(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}
