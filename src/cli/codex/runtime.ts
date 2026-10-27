import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { isNewer, VERSION } from "../../harness/codex/adapter/layout.js";
import {
  type RuntimeReadiness,
  runtimeReadiness,
  selectRuntime,
} from "../../harness/codex/adapter/store.js";
import { type ReleaseTransport, versionOfTag } from "../../harness/codex/runtime-release/index.js";
import {
  isAdapterRoot,
  type RuntimeUpdateResult,
  readUpdateState,
  selectedRuntime,
  type UpdateState,
  updateRuntime,
} from "../../harness/codex/runtime-update/index.js";
import type { CliIo } from "../main.js";
import { MARKETPLACE_NAME, PLUGIN_ID, PLUGIN_NAME } from "../plugin-id.js";

/*
 * Row 002-34 (spec 002 D7 and D8, `wave-5-contract.md`): `squeal
 * codex-runtime`, the shell-facing contract of the fixed Codex plugin's
 * runtime. `ensure` selects a complete local runtime with no network and no
 * session pin; `update` runs the bounded updater; `status` reads readiness.
 * The installer, `squeal update` and setup reach the same operations here.
 */

export const CODEX_RUNTIME_USAGE = `usage: squeal codex-runtime ensure --plugin-root <absolute> [--data <absolute>]
       squeal codex-runtime update --plugin-root <absolute> [--data <absolute>] [--tag squeal--v<version>] [--background]
       squeal codex-runtime status --plugin-root <absolute> [--data <absolute>] [--json]
`;

/** How long an explicit update waits for a background one before it answers busy. */
export const FOREGROUND_LOCK_WAIT_MS = 30_000;

type Env = Readonly<Record<string, string | undefined>>;

export interface CodexRuntimeDeps {
  /** Tests inject one; the default reaches only the official release. */
  readonly transport?: ReleaseTransport;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

const codexHome = (env: Env): string =>
  resolve(env.CODEX_HOME || join(env.HOME || homedir(), ".codex"));

/**
 * The plugin data directory: `PLUGIN_DATA` when Codex or the adapter set it,
 * else Codex's data directory for squeal@hearsay under `CODEX_HOME`.
 */
export function codexRuntimeData(env: Env): string {
  const data = env.PLUGIN_DATA ?? "";
  if (data !== "" && isAbsolute(data)) return data;
  return join(codexHome(env), "plugins", "data", `${PLUGIN_NAME}-${MARKETPLACE_NAME}`);
}

/**
 * The installed fixed plugin: `SQUEAL_ADAPTER_ROOT` when it is one, else the
 * newest version in Codex's plugin cache that is an adapter (`hooks/hooks.json`
 * and `seed/`). `null` without one, as with a plugin from before the adapter.
 */
export function codexAdapterRoot(env: Env): string | null {
  const named = env.SQUEAL_ADAPTER_ROOT ?? "";
  if (named !== "" && isAdapterRoot(named)) return named;
  const cache = join(codexHome(env), "plugins", "cache", MARKETPLACE_NAME, PLUGIN_NAME);
  let names: string[];
  try {
    names = readdirSync(cache);
  } catch {
    return null;
  }
  let newest: string | null = null;
  for (const name of names) {
    if (!VERSION.test(name) || !isAdapterRoot(join(cache, name))) continue;
    if (newest === null || isNewer(name, newest)) newest = name;
  }
  return newest === null ? null : join(cache, newest);
}

interface Parsed {
  readonly action: "ensure" | "update" | "status";
  readonly pluginRoot: string;
  readonly data: string | null;
  readonly tag: string | null;
  readonly background: boolean;
  readonly json: boolean;
}

const FLAGS: Readonly<Record<Parsed["action"], readonly string[]>> = {
  ensure: ["--plugin-root", "--data"],
  update: ["--plugin-root", "--data", "--tag", "--background"],
  status: ["--plugin-root", "--data", "--json"],
};
const VALUED = new Set(["--plugin-root", "--data", "--tag"]);

function parse(args: readonly string[]): Parsed | string {
  const [action, ...rest] = args;
  if (action !== "ensure" && action !== "update" && action !== "status")
    return action === undefined
      ? "expected ensure, update or status"
      : `unknown action "${action}"`;
  const read = readFlags(action, rest);
  if (typeof read === "string") return read;
  const { values, switches } = read;
  const pluginRoot = values.get("--plugin-root");
  if (pluginRoot === undefined) return `${action} needs --plugin-root <absolute>`;
  for (const flag of ["--plugin-root", "--data"]) {
    const value = values.get(flag);
    if (value !== undefined && !isAbsolute(value))
      return `${flag} takes an absolute path, not "${value}"`;
  }
  const tag = values.get("--tag") ?? null;
  if (tag !== null && versionOfTag(tag) === null)
    return `--tag takes squeal--v<version>, not "${tag}"`;
  return {
    action,
    pluginRoot,
    data: values.get("--data") ?? null,
    tag,
    background: switches.has("--background"),
    json: switches.has("--json"),
  };
}

/** Each flag of `action` in `--flag value` or `--flag=value` form, or what is wrong. */
function readFlags(
  action: Parsed["action"],
  rest: readonly string[],
): { values: Map<string, string>; switches: Set<string> } | string {
  const values = new Map<string, string>();
  const switches = new Set<string>();
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] ?? "";
    const [flag = "", inline] = arg.startsWith("--") ? arg.split(/=(.*)/s, 2) : [arg];
    if (!FLAGS[action].includes(flag)) return `${action} takes no "${arg}"`;
    if (!VALUED.has(flag)) switches.add(flag);
    else if (inline !== undefined) values.set(flag, inline);
    else if (i + 1 < rest.length) values.set(flag, rest[++i] ?? "");
    else return `${flag} needs a value`;
  }
  return { values, switches };
}

/** `squeal codex-runtime ensure|update|status`; exit 2 on a usage error. */
export async function codexRuntimeCommand(
  args: readonly string[],
  io: CliIo,
  deps: CodexRuntimeDeps = {},
): Promise<number> {
  const parsed = parse(args);
  if (typeof parsed === "string") {
    io.stderr(`squeal codex-runtime: ${parsed}\n${CODEX_RUNTIME_USAGE}`);
    return 2;
  }
  const { action, pluginRoot } = parsed;
  const data = parsed.data ?? codexRuntimeData(io.env ?? process.env);
  if (action === "status") return status(pluginRoot, data, parsed.json, io);
  if (!isAdapterRoot(pluginRoot)) {
    io.stderr(`squeal codex-runtime ${action}: ${notAdapter(pluginRoot)}\n`);
    return 1;
  }
  if (action === "ensure") return ensureRuntime(pluginRoot, data, io);
  const result = await updateRuntime({
    pluginRoot,
    data,
    explicit: !parsed.background,
    lockWaitMs: parsed.background ? 0 : FOREGROUND_LOCK_WAIT_MS,
    ...(parsed.tag === null ? {} : { tag: parsed.tag }),
    ...(deps.transport === undefined ? {} : { transport: deps.transport }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
    ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
  });
  if (parsed.background) return 0;
  const text = updateText(result);
  if (result.outcome === "failed" || result.outcome === "busy") {
    io.stderr(`squeal codex-runtime update: ${text}\n`);
    return 1;
  }
  io.stdout(`${text}\n`);
  return 0;
}

const notAdapter = (root: string) =>
  `${root} is not the fixed Squeal plugin for Codex: it has no hooks/hooks.json and seed/`;

/** Selects a complete runtime for new sessions, the current one or the seed; 0 when ready. */
export function ensureRuntime(pluginRoot: string, data: string, io: CliIo): number {
  try {
    const runtime = selectRuntime({ pluginRoot, data, sessionId: null });
    io.stdout(`Codex runtime ${runtime.version} ready (${runtime.source}) in ${runtime.root}\n`);
    return 0;
  } catch (error) {
    io.stderr(`squeal codex-runtime ensure: ${(error as Error).message}\n`);
    return 1;
  }
}

/** One update's result, for a human: the version new sessions use comes first. */
export function updateText(result: RuntimeUpdateResult): string {
  const selected = `Codex runtime ${result.version ?? "none"}`;
  switch (result.outcome) {
    case "updated":
      return `${selected}, was ${result.previous ?? "none"} (release ${result.release}); new Codex sessions use it, running ones keep theirs`;
    case "current":
      return `${selected}, up to date: release ${result.release} is not newer`;
    case "not-due":
      return `${selected}; the next update check is due at ${result.nextCheckAt}`;
    case "busy":
      return `another runtime update is running (pid ${result.owner}); ${selected} stays selected. Retry in a minute.`;
    case "failed": {
      const { code, transient, message } = result.failure;
      return `${message} (${code}${transient ? ", transient" : ""}); ${selected} stays selected`;
    }
  }
}

/** Readiness as `status --json` prints it: the store's, the selection and the last check. */
export interface CodexRuntimeStatus extends RuntimeReadiness {
  readonly data: string;
  /** The plugin root has `hooks/hooks.json` and `seed/`. */
  readonly adapterValid: boolean;
  /** The runtime a new session selects; `null` when none can be. */
  readonly selected: string | null;
  readonly update: UpdateState | null;
}

export function codexRuntimeStatus(pluginRoot: string, data: string): CodexRuntimeStatus {
  const readiness = runtimeReadiness({ pluginRoot, data });
  const adapterValid = isAdapterRoot(pluginRoot);
  return {
    ...readiness,
    ready: adapterValid && readiness.ready,
    data,
    adapterValid,
    selected: selectedRuntime(pluginRoot, data),
    update: readUpdateState(data),
  };
}

function status(pluginRoot: string, data: string, json: boolean, io: CliIo): number {
  const s = codexRuntimeStatus(pluginRoot, data);
  io.stdout(json ? `${JSON.stringify(s, null, 2)}\n` : statusText(s));
  return s.ready ? 0 : 1;
}

/** `status` for a human: adapter, runtime, pins and the last update check. */
export function statusText(s: CodexRuntimeStatus): string {
  const lines = [`Codex adapter ${s.adapter.version ?? "unknown"} at ${s.adapter.root}`];
  if (!s.adapterValid) lines.push(`  not ready: ${notAdapter(s.adapter.root)}`);
  const state = (name: string, r: CodexRuntimeStatus["current"]) =>
    `  ${name}: ${r.version ?? "none"}${r.ready ? ", ready" : `, not ready: ${r.problem}`}`;
  lines.push(
    s.ready
      ? `Codex runtime ${s.selected}: ready; new Codex sessions use it`
      : `Codex runtime: not ready; new Codex sessions report validation unavailable. Run squeal codex-runtime update --plugin-root ${s.adapter.root}, or reinstall the plugin (codex plugin add ${PLUGIN_ID})`,
    state("current", s.current),
    state("seed", s.seed),
  );
  const missing = s.pinned.filter((p) => !p.ready).map((p) => p.version);
  lines.push(
    s.pinned.length === 0
      ? "  sessions: none pinned"
      : `  sessions pinned to: ${s.pinned.map((p) => p.version).join(", ")}${missing.length === 0 ? "" : `; missing: ${missing.join(", ")} (those sessions report validation unavailable until restarted)`}`,
  );
  lines.push(checkText(s.update));
  return `${lines.join("\n")}\n`;
}

function checkText(u: UpdateState | null): string {
  if (u === null) return "Update check: none yet";
  const after = `; next scheduled check after ${u.nextCheckAt}`;
  if (u.failure === null) {
    const found = u.outcome === "updated" ? `selected ${u.selected}` : "nothing newer";
    return `Update check: ${found} at ${u.checkedAt} (release ${u.release})${after}`;
  }
  const { code, transient, message } = u.failure;
  return `Update check: failed at ${u.checkedAt}: ${message} (${code}${transient ? ", transient" : ""}); last success ${u.lastSuccessAt ?? "never"}${after}`;
}
