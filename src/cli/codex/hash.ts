import { createHash } from "node:crypto";

/*
 * Spec 002 D1: Codex runs a plugin or config hook only once the user trusted
 * it, and trust is a hash of the handler's declaration. This is a port of
 * Codex 0.160.1's `hook_hash` (codex-rs/hooks/src/engine/discovery.rs) and
 * `version_for_toml` (codex-rs/config/src/fingerprint.rs), found in
 * `research/wave-0-checks.md` 3. The format is internal to Codex, so a test
 * pins it against a `hooks/list` recorded from that version.
 */

/** The Codex version the port was checked against. */
export const CODEX_HASH_VERSION = "0.160.1";

/** Key source of this plugin's hooks: `<plugin>@<marketplace>:hooks/hooks.json`. */
export const PLUGIN_KEY_SOURCE = "squeal@squeal:hooks/hooks.json";

/** Key source of hooks declared through `-c` or `thread/start` `config`. */
export const LAUNCHER_KEY_SOURCE = "/<session-flags>/config.toml";

/** One handler of a Codex `hooks.json` group; only `command` handlers are hashed. */
export interface CodexHookHandler {
  readonly type: string;
  readonly command: string;
  readonly timeout?: number;
  readonly async?: boolean;
  readonly statusMessage?: string;
  readonly additionalContextLimit?: number;
}

export interface CodexHookGroup {
  readonly matcher?: string;
  readonly hooks: readonly CodexHookHandler[];
}

/** A Codex `hooks.json`: event name to groups. */
export interface HooksFile {
  readonly hooks: Readonly<Record<string, readonly CodexHookGroup[]>>;
}

/** One trust entry: the `hooks.state` key and the `trusted_hash` Codex expects. */
export interface HookTrust {
  readonly key: string;
  readonly hash: string;
}

const LABELS: Readonly<Record<string, string>> = {
  PreToolUse: "pre_tool_use",
  PermissionRequest: "permission_request",
  PostToolUse: "post_tool_use",
  PreCompact: "pre_compact",
  PostCompact: "post_compact",
  SessionStart: "session_start",
  SessionEnd: "session_end",
  UserPromptSubmit: "user_prompt_submit",
  SubagentStart: "subagent_start",
  SubagentStop: "subagent_stop",
  Stop: "stop",
  Interrupt: "interrupt",
};
const NO_MATCHER = new Set(["UserPromptSubmit", "Stop", "Interrupt"]);
const CONTEXT_EVENTS = new Set([
  "PreToolUse",
  "PostToolUse",
  "SessionStart",
  "UserPromptSubmit",
  "SubagentStart",
]);
/** Codex's default `additionalContextLimit`, omitted from the identity. */
const DEFAULT_CONTEXT_LIMIT = 2_500;

/** The snake-case label Codex uses for an event in keys and identities. */
export function eventLabel(event: string): string {
  const label = LABELS[event];
  if (label === undefined) throw new Error(`unknown Codex hook event "${event}"`);
  return label;
}

/** `sha256:<hex>` of the handler's normalized identity, as Codex computes `currentHash`. */
export function hookHash(
  event: string,
  matcher: string | undefined,
  handler: CodexHookHandler,
): string {
  const short = event === "SessionEnd" || event === "Interrupt";
  const timeout = short
    ? Math.min(Math.max(handler.timeout ?? 1, 1), 3)
    : Math.max(handler.timeout ?? 600, 1);
  const normalized: Record<string, unknown> = {
    type: "command",
    command: handler.command,
    timeout,
    async: handler.async ?? false,
  };
  if (handler.statusMessage !== undefined) normalized.statusMessage = handler.statusMessage;
  const limit = CONTEXT_EVENTS.has(event) ? handler.additionalContextLimit : undefined;
  if (limit !== undefined && limit !== DEFAULT_CONTEXT_LIMIT) {
    normalized.additionalContextLimit = limit;
  }
  const identity: Record<string, unknown> = { event_name: eventLabel(event), hooks: [normalized] };
  if (matcher !== undefined && !NO_MATCHER.has(event)) identity.matcher = matcher;
  const digest = createHash("sha256")
    .update(JSON.stringify(canonical(identity)))
    .digest("hex");
  return `sha256:${digest}`;
}

/** Every command handler's trust entry, keyed `<keySource>:<event>:<group>:<handler>`. */
export function hookHashes(file: HooksFile, keySource: string): HookTrust[] {
  const trust: HookTrust[] = [];
  for (const [event, groups] of Object.entries(file.hooks)) {
    groups.forEach((group, g) => {
      group.hooks.forEach((handler, h) => {
        if (handler.type !== "command") return;
        trust.push({
          key: `${keySource}:${eventLabel(event)}:${g}:${h}`,
          hash: hookHash(event, group.matcher, handler),
        });
      });
    });
  }
  return trust;
}

/** Object keys sorted at every level, as serde's canonical form. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .map((key) => [key, canonical(object[key])]),
  );
}
