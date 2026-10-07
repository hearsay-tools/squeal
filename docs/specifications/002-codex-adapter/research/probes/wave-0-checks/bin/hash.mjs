// Throwaway: recompute Codex 0.160.1 hook trust keys and hashes outside Codex.
// Port of codex-rs/hooks/src/engine/discovery.rs hook_hash() + config/src/fingerprint.rs
// version_for_toml(): sha256 over canonical (sorted-key, compact) JSON of
// { event_name, matcher?, hooks: [normalized handler] }.
// Usage: node hash.mjs <hooks.json> <keySource>
//   keySource: "<plugin>@<marketplace>:hooks/hooks.json" for a plugin, the file path otherwise.
// Prints one line per handler: <key> <sha256:...>. Command handlers only.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const LABEL = { PreToolUse: 'pre_tool_use', PermissionRequest: 'permission_request', PostToolUse: 'post_tool_use',
  PreCompact: 'pre_compact', PostCompact: 'post_compact', SessionStart: 'session_start', SessionEnd: 'session_end',
  UserPromptSubmit: 'user_prompt_submit', SubagentStart: 'subagent_start', SubagentStop: 'subagent_stop',
  Stop: 'stop', Interrupt: 'interrupt' };
const NO_MATCHER = new Set(['UserPromptSubmit', 'Stop', 'Interrupt']);
const CONTEXT_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'SessionStart', 'UserPromptSubmit', 'SubagentStart']);
const canon = (v) => Array.isArray(v) ? v.map(canon)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
export function hookHash(event, matcher, h) {
  const short = event === 'SessionEnd' || event === 'Interrupt';
  const timeout = short ? Math.min(Math.max(h.timeout ?? 1, 1), 3) : Math.max(h.timeout ?? 600, 1);
  const handler = { type: 'command', command: h.command, timeout, async: h.async ?? false };
  if (h.statusMessage != null) handler.statusMessage = h.statusMessage;
  const limit = CONTEXT_EVENTS.has(event) ? h.additionalContextLimit : undefined;
  if (limit != null && limit !== 2500) handler.additionalContextLimit = limit;
  const group = { event_name: LABEL[event], hooks: [handler] };
  const m = NO_MATCHER.has(event) ? undefined : matcher;
  if (m != null) group.matcher = m;
  return 'sha256:' + createHash('sha256').update(JSON.stringify(canon(group))).digest('hex');
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, keySource] = process.argv.slice(2);
  const { hooks } = JSON.parse(readFileSync(file, 'utf8'));
  for (const [event, groups] of Object.entries(hooks))
    groups.forEach((g, gi) => (g.hooks ?? []).forEach((h, hi) => {
      if (h.type !== 'command') return;
      console.log(`${keySource}:${LABEL[event]}:${gi}:${hi} ${hookHash(event, g.matcher, h)}`);
    }));
}
