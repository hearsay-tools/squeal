// Throwaway probe (011-385). Reads Claude Code transcripts (read-only) and prints, per hook
// attachment: time, event, kind (success / cancelled / additional_context), durationMs, timedOut,
// and the first line of any Squeal text. Usage: node transcript-hooks.cjs <transcript.jsonl>...
const fs = require("fs");
for (const file of process.argv.slice(2)) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.includes('"attachment"')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const a = o.attachment; if (!a || !String(a.type).startsWith("hook_")) continue;
    let text = "";
    if (a.stdout) { try { text = JSON.parse(a.stdout).hookSpecificOutput?.additionalContext ?? ""; } catch { text = ""; } }
    if (!text && Array.isArray(a.content)) text = a.content.join(" ");
    if (!text && typeof a.content === "string") text = a.content;
    const listed = /has not listed this worktree/.test(text) ? "UNLISTED" : /SQUEAL/.test(text) ? "squeal" : "";
    console.log([o.timestamp, a.hookEvent, a.type, a.durationMs ?? "", a.timedOut ? "TIMEOUT" : "", listed, text.split("\n")[0].slice(0, 100)].join("\t"));
  }
}
