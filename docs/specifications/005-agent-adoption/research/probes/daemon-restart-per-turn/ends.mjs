// Throwaway probe for row 005-99 (see README.md). Read-only. For each Squawk session end of a
// run (Claude Code or Codex), in the run's own worktree: did a daemon serve there, did it stop
// after the end and why, and how long until the run's next session start (null: none yet).
// Usage: node ends.mjs <repo-dir>... > ends.jsonl
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { daemons } from "./lib.mjs";

const SINCE = Date.parse(process.env.SINCE ?? "2026-11-14T00:00:00Z");
const UNTIL = Date.parse(process.env.UNTIL ?? "2026-11-17T08:00:00Z");

for (const repo of process.argv.slice(2)) {
  const { byRoot } = daemons(join(repo, ".git/squeal/logs"));
  const dir = join(repo, ".ai/squawk/runs");
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".ndjson")) continue;
    const path = join(dir, name);
    if (statSync(path).mtimeMs < SINCE) continue;
    const text = readFileSync(path, "utf8");
    const runner = /runner: (\w+)/.exec(text.slice(0, 400))?.[1] ?? "unknown";
    const root = join(repo, ".ai/squawk/worktrees", name.replace(/\.ndjson$/, ""));
    const list = byRoot.get(root) ?? [];
    const ends = [];
    let open = null;
    for (const line of text.split("\n")) {
      if (line === "") continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      const at = Date.parse(e.ts);
      if (e.type === "session.ended") {
        open = { at, reason: e.reason, next: null };
        ends.push(open);
      }
      const hookStart = e.type === "item.completed" && /^SessionStart:(startup|resume)/.test(e.item?.name ?? "");
      const start = hookStart || (runner !== "claude" && e.type === "session.started");
      if (start && open !== null && open.next === null) {
        open.next = at;
        open = null;
      }
    }
    for (const end of ends) {
      if (end.at < SINCE || end.at > UNTIL) continue;
      const stopOf = (p) => p.stop ?? p.last;
      const serving = list.find((p) => p.serving !== null && p.serving <= end.at && stopOf(p) >= end.at);
      const stopAfter = serving === undefined ? null : stopOf(serving) - end.at;
      process.stdout.write(
        `${JSON.stringify({
          repo: repo.split("/").pop(),
          run: name.slice(0, 8),
          at: end.at,
          runner,
          logged: list.length > 0,
          served: serving !== undefined,
          stopAfter,
          stopReason: serving?.reason ?? null,
          gap: end.next === null ? null : end.next - end.at,
          tail: end.next === null ? UNTIL - end.at : null,
        })}\n`,
      );
    }
  }
}
