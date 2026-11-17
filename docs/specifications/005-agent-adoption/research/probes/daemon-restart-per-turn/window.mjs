// Throwaway probe for row 005-99 (see README.md). Read-only. For each process start of
// turns.jsonl that had to start a daemon, reads the Claude Code transcript and counts, from
// the start to the new daemon's "serving" line: edits, waits and hand test runs, and the
// SQUEAL texts the hooks added (first line of each).
// Usage: node window.mjs turns.jsonl > window.jsonl
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const EDIT = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const rows = readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));
const cache = new Map();
function transcript(cwd, sessionId) {
  const path = join(homedir(), ".claude/projects", cwd.replace(/[/.]/g, "-"), `${sessionId}.jsonl`);
  if (!cache.has(path)) {
    cache.set(
      path,
      existsSync(path)
        ? readFileSync(path, "utf8")
            .split("\n")
            .filter(Boolean)
            .map((l) => {
              try {
                return JSON.parse(l);
              } catch {
                return null;
              }
            })
            .filter((e) => e !== null && typeof e.timestamp === "string")
        : null,
    );
  }
  return cache.get(path);
}

for (const r of rows) {
  if (r.alive || r.toServing === null || r.cwd === null || r.sessionId === null) continue;
  const entries = transcript(r.cwd, r.sessionId);
  if (entries === null) {
    process.stdout.write(`${JSON.stringify({ run: r.run, source: r.source, transcript: false })}\n`);
    continue;
  }
  // CONTROL=1: the window of the same length right after "serving", as a comparison.
  const control = process.env.CONTROL === "1";
  const lo = control ? r.at + r.toServing : r.at - 1_000;
  const hi = control ? r.at + 2 * r.toServing : r.at + r.toServing;
  let edits = 0;
  let waits = 0;
  let handRuns = 0;
  let tools = 0;
  let firstEdit = null;
  const texts = [];
  for (const e of entries) {
    const at = Date.parse(e.timestamp);
    if (at < lo || at > hi) continue;
    for (const c of Array.isArray(e.message?.content) ? e.message.content : []) {
      if (c.type !== "tool_use") continue;
      tools++;
      if (EDIT.has(c.name)) {
        edits++;
        firstEdit ??= at - r.at;
      }
      const cmd = typeof c.input?.command === "string" ? c.input.command : "";
      if (/squeal status --wait|squeal run /.test(cmd)) waits++;
      if (/vitest|pnpm (run )?test|npm test/.test(cmd) && !/squeal/.test(cmd)) handRuns++;
    }
    const content = e.attachment?.type === "hook_additional_context" ? e.attachment.content : null;
    for (const t of Array.isArray(content) ? content : []) {
      if (typeof t === "string" && t.startsWith("SQUEAL")) texts.push(t.split("\n")[0]);
    }
  }
  process.stdout.write(
    `${JSON.stringify({ run: r.run, repo: r.repo, source: r.source, status: r.status, toServing: r.toServing, tools, edits, firstEdit, waits, handRuns, texts })}\n`,
  );
}
