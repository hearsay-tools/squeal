#!/usr/bin/env node
// Throwaway: PreToolUse on Bash. Prefixes the command with the caller's agent id
// and tool_use_id as env assignments, via updatedInput, with no permissionDecision.
import { appendFileSync, readFileSync } from "node:fs";
const input = JSON.parse(readFileSync(0, "utf8"));
const agent = input.agent_id ?? "main";
const cmd = input.tool_input.command;
const shape = process.env.TAG_SHAPE ?? "prefix";
const command =
  shape === "flag" ? `${cmd} --squeal-agent ${agent}`
  : shape === "export" ? `export SQUEAL_AGENT_ID=${agent}; ${cmd}`
  : `SQUEAL_AGENT_ID=${agent} SQUEAL_TOOL_USE_ID=${input.tool_use_id} ${cmd}`;
const updated = { ...input.tool_input, command };
appendFileSync(process.env.PROBE_LOG, JSON.stringify({ t_ms: Date.now(), event: "tag", agent, tuid: input.tool_use_id, cmd }) + "\n");
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: updated } }));
