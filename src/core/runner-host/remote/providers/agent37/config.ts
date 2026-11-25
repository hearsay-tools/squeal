import { placesProblem, plainString, unknownKey } from "../config.js";
import { TUNNEL_HOST_TEMPLATE } from "./tunnel.js";

/*
 * Spec 026 D7.3.1 (row 026-15): an `agent37` entry's `providerConfig`.
 * Every key has a default; `region` and `type` follow Agent37's own rule
 * that only `us` runs the gVisor `default` type (`instances/create.md`:
 * "eu and ap-south run VM and Performance instances").
 */

export const REGIONS = ["eu", "us", "ap-south"] as const;
export const TYPES = ["vm", "performance", "default"] as const;
export const BOOTSTRAPS = ["git-bundle", "tree-sync"] as const;

export interface Agent37Settings {
  readonly region: (typeof REGIONS)[number];
  readonly type: (typeof TYPES)[number];
  readonly vcpu: number;
  readonly memoryGb: number;
  readonly diskGb: number;
  /** Agent37's own idle sleep (`auto_sleep`, `idle_timeout_seconds`), behind the lane's. */
  readonly autoSleepMinutes: number;
  readonly apiKeyEnv: string;
  readonly sshKeyPath?: string;
  readonly bootstrap: (typeof BOOTSTRAPS)[number];
  readonly apiBaseUrl: string;
  readonly tunnelHostTemplate: string;
  readonly node: string;
  readonly cache: string;
  /** Row 026-29: the system or workspace template, optionally pinned (`name@tag`). */
  readonly template: string;
  /** Row 026-29: the SSH login; unset, `defaultSshUser` picks it. */
  readonly sshUser?: string;
}

export const AGENT37_DEFAULTS = {
  region: "eu",
  type: "vm",
  vcpu: 4,
  memoryGb: 8,
  diskGb: 10,
  autoSleepMinutes: 10,
  apiKeyEnv: "AGENT37_API_KEY",
  bootstrap: "git-bundle",
  apiBaseUrl: "https://api.agent37.com",
  tunnelHostTemplate: TUNNEL_HOST_TEMPLATE,
  template: "agent37-base",
} as const;

const KEYS = [
  "region",
  "type",
  "vcpu",
  "memoryGb",
  "diskGb",
  "autoSleepMinutes",
  "apiKeyEnv",
  "sshKeyPath",
  "bootstrap",
  "apiBaseUrl",
  "tunnelHostTemplate",
  "node",
  "cache",
  "template",
  "sshUser",
] as const;

/** Agent37's `idle_timeout_seconds` range, as minutes. */
const AUTO_SLEEP_MINUTES = { min: 5, max: 1440 } as const;

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** A template name, optionally pinned to a tag or a revision. */
const TEMPLATE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}(?:@[A-Za-z0-9._-]{1,64})?$/;
const SSH_USER = /^[A-Za-z_][A-Za-z0-9._-]{0,63}$/;
const UBUNTU = "agent37-ubuntu";

/**
 * The SSH login when `sshUser` is unset: `root` where the instance's disk
 * is `/root` or the template is `agent37-ubuntu` (it has no `node` user),
 * else `node`, the base image's user.
 */
export function defaultSshUser(template: string, mountPath?: string | null): string {
  if (mountPath === "/root" || template === UBUNTU || template.startsWith(`${UBUNTU}@`)) {
    return "root";
  }
  return "node";
}

function oneOf(key: string, value: unknown, allowed: readonly string[]): string | null {
  if (value === undefined || allowed.includes(value as string)) return null;
  return `"${key}" must be one of ${allowed.map((a) => `"${a}"`).join(", ")}`;
}

function positiveInteger(key: string, value: unknown): string | null {
  if (value === undefined || (Number.isInteger(value) && (value as number) > 0)) return null;
  return `"${key}" must be a positive integer`;
}

function httpUrl(value: unknown): boolean {
  if (!plainString(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.username === "";
  } catch {
    return false;
  }
}

type Config = Readonly<Record<string, unknown>>;

/** EU and ap-south run VM and Performance instances only. */
function regionProblem(config: Config): string | null {
  const region = config.region ?? AGENT37_DEFAULTS.region;
  if (config.type !== "default" || region === "us") return null;
  return `Agent37 ${String(region)} does not support "default" (gVisor); use "vm" or "performance"`;
}

function autoSleepProblem(config: Config): string | null {
  const minutes = config.autoSleepMinutes;
  if (minutes === undefined) return null;
  const { min, max } = AUTO_SLEEP_MINUTES;
  if (Number.isInteger(minutes) && (minutes as number) >= min && (minutes as number) <= max) {
    return null;
  }
  return `"autoSleepMinutes" must be a whole number of minutes from ${min} to ${max}`;
}

function apiKeyEnvProblem(config: Config): string | null {
  const name = config.apiKeyEnv;
  // A name, never the key itself: Agent37 keys start with `sk_`.
  if (name === undefined || (plainString(name) && ENV_NAME.test(name) && !/^sk_/i.test(name))) {
    return null;
  }
  return '"apiKeyEnv" must name an environment variable, such as "AGENT37_API_KEY" (never the key itself)';
}

function sshKeyPathProblem(config: Config): string | null {
  const path = config.sshKeyPath;
  if (path === undefined || (plainString(path) && path !== "")) return null;
  return '"sshKeyPath" must be a non-empty path';
}

function templateProblem(config: Config): string | null {
  const template = config.template;
  if (template === undefined || (plainString(template) && TEMPLATE.test(template))) return null;
  return '"template" must be a template name, optionally pinned, such as "agent37-ubuntu" or "my-vm@2"';
}

function sshUserProblem(config: Config): string | null {
  const user = config.sshUser;
  if (user === undefined || (plainString(user) && SSH_USER.test(user))) return null;
  return '"sshUser" must be a login name, such as "root" or "node"';
}

function apiBaseUrlProblem(config: Config): string | null {
  if (config.apiBaseUrl === undefined || httpUrl(config.apiBaseUrl)) return null;
  return '"apiBaseUrl" must be an http: or https: URL with no credential';
}

function tunnelHostProblem(config: Config): string | null {
  const template = config.tunnelHostTemplate;
  if (template === undefined) return null;
  if (plainString(template) && template.includes("{id}") && /^[A-Za-z0-9.{}-]+$/.test(template)) {
    return null;
  }
  return '"tunnelHostTemplate" must be a host name with "{id}", such as "{id}-22022.agent37.app"';
}

/** Each check of an `agent37` config, in the order its problem is reported. */
const CHECKS: readonly ((config: Config) => string | null)[] = [
  (config) => unknownKey(config, KEYS),
  (config) => oneOf("region", config.region, REGIONS),
  (config) => oneOf("type", config.type, TYPES),
  (config) => oneOf("bootstrap", config.bootstrap, BOOTSTRAPS),
  (config) => positiveInteger("vcpu", config.vcpu),
  (config) => positiveInteger("memoryGb", config.memoryGb),
  (config) => positiveInteger("diskGb", config.diskGb),
  regionProblem,
  autoSleepProblem,
  apiKeyEnvProblem,
  sshKeyPathProblem,
  templateProblem,
  sshUserProblem,
  apiBaseUrlProblem,
  tunnelHostProblem,
  placesProblem,
];

/** The first problem of `config` as an `agent37` entry, or `null`. */
export function validateAgent37(config: Config): string | null {
  for (const check of CHECKS) {
    const problem = check(config);
    if (problem !== null) return problem;
  }
  return null;
}

/** `config`, validated, with every default filled in. */
export function agent37Settings(config: Config): Agent37Settings {
  const merged = { ...AGENT37_DEFAULTS, ...config } as Record<string, unknown>;
  return {
    ...(merged as unknown as Agent37Settings),
    apiBaseUrl: (merged.apiBaseUrl as string).replace(/\/+$/, ""),
  };
}
