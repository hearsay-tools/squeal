// Throwaway probe (016-35). An OMP extension that appends one JSON line per
// event to $HT_EVENT_LOG and returns nothing, so it changes no behaviour.
// It also records process.execPath and the parent pid once at load.
import { appendFileSync } from "node:fs";

const EVENTS = [
  "session_start", "session_shutdown", "input", "before_agent_start", "agent_start", "agent_end",
  "session_stop", "turn_start", "turn_end", "tool_call", "tool_result", "tool_execution_start",
  "tool_execution_end", "context", "message_end",
  // Pi 0.x names Squeal's Pi package uses; OMP's types do not declare them.
  "agent_before_settle", "agent_settled",
];

export default function (pi) {
  const log = (line) => {
    const path = process.env.HT_EVENT_LOG;
    if (path) appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), ...line })}\n`);
  };
  log({ load: true, execPath: process.execPath, pid: process.pid, ppid: process.ppid, bun: process.versions.bun ?? null });
  for (const name of EVENTS) {
    pi.on(name, (event, ctx) => {
      let mode = null;
      try { mode = ctx?.mode ?? null; } catch {}
      const keys = event && typeof event === "object" ? Object.keys(event) : [];
      const extra = {};
      if (name === "tool_call" || name === "tool_result") extra.toolName = event.toolName;
      if (name === "turn_end") extra.toolResults = (event.toolResults ?? []).map((r) => r.toolName);
      if (name === "before_agent_start") extra.systemPromptOptions = "systemPromptOptions" in event;
      log({ event: name, mode, keys, ...extra });
      return undefined;
    });
  }
}
