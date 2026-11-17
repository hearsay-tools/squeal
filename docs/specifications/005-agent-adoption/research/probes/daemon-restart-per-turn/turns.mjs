// Throwaway probe for row 005-99 (see README.md). Read-only: it reads Squawk run logs and
// Squeal daemon logs, and writes one JSON line per process start to stdout.
// Usage: node turns.mjs <repo-dir>... > turns.jsonl
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { daemons, loadAt } from "./lib.mjs";

const SINCE = Date.parse(process.env.SINCE ?? "2026-11-14T00:00:00Z");
/** Process starts of Claude Code steps: SessionStart hook items, with the previous session end. */
function starts(runsDir) {
  const out = [];
  for (const name of readdirSync(runsDir)) {
    if (!name.endsWith(".ndjson")) continue;
    const path = join(runsDir, name);
    if (statSync(path).mtimeMs < SINCE) continue;
    const text = readFileSync(path, "utf8");
    const runner = /runner: (\w+)/.exec(text.slice(0, 400))?.[1] ?? "unknown";
    let cwd = null;
    let sessionId = null;
    let lastEnd = null;
    let lastTurnEnd = null;
    const events = [];
    for (const line of text.split("\n")) {
      if (line === "") continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      const at = Date.parse(e.ts);
      if (e.type === "session.started" && cwd === null) cwd = e.cwd ?? null;
      if (e.type === "session.started") sessionId = e.sessionId ?? sessionId;
      if (e.type === "session.ended") lastEnd = at;
      if (e.type === "turn.completed" || e.type === "turn-end") lastTurnEnd = at;
      if (e.type === "item.completed" && e.item?.kind === "hook" && /^SessionStart:/.test(e.item.name ?? "")) {
        const reg = e.item.entries?.[0]?.text ?? "";
        events.push({
          at,
          source: e.item.name.slice("SessionStart:".length),
          status: e.item.status,
          prevEnd: lastEnd,
          prevTurnEnd: lastTurnEnd,
          unlisted: /has not listed|no results yet|still starting/.test(reg),
          regStarting: /daemon is starting|is still starting/.test(reg),
        });
      }
    }
    for (const ev of events) if (ev.at >= SINCE) out.push({ run: name.slice(0, 8), runner, cwd, sessionId, ...ev });
  }
  return out;
}

const SLACK = 2_000;
for (const repo of process.argv.slice(2)) {
  const { byRoot, loads } = daemons(join(repo, ".git/squeal/logs"));
  for (const s of starts(join(repo, ".ai/squawk/runs"))) {
    const list = s.cwd === null ? [] : byRoot.get(s.cwd) ?? [];
    const end = (p) => p.stop ?? p.last;
    // A daemon that serves at the hook: started before it and not stopped before it.
    const alive = list.find((p) => p.serving !== null && p.serving <= s.at && end(p) >= s.at - SLACK && !p.gaveUp);
    const startingAlready = list.find((p) => p.serving !== null && p.first < s.at - SLACK && p.serving > s.at);
    const next = list.find((p) => p.serving !== null && p.serving > s.at && p.first >= s.at - SLACK);
    const prev = [...list].reverse().find((p) => end(p) < s.at);
    out({
      repo: repo.split("/").pop(),
      ...s,
      logged: list.length > 0,
      alive: alive !== undefined,
      startingAlready: startingAlready !== undefined,
      toFirstLine: next === undefined ? null : next.first - s.at,
      toServing: next === undefined ? null : next.serving - s.at,
      nextReason: next?.reason ?? null,
      prevStop: prev?.stop ?? null,
      prevReason: prev?.reason ?? null,
      gapFromEnd: s.prevEnd === null ? null : s.at - s.prevEnd,
      prevStopAfterEnd: prev?.stop != null && s.prevEnd !== null ? prev.stop - s.prevEnd : null,
      load: loadAt(loads, s.at),
    });
  }
}

function out(row) {
  process.stdout.write(`${JSON.stringify(row)}\n`);
}
