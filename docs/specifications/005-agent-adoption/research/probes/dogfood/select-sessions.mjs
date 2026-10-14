#!/usr/bin/env node
// Throwaway probe for 005-18 part 3. Not product code; read-only over session records.
//
// Lists this repository's agent sessions started at or after a time, as 005-01 selected them:
// every Claude Code transcript under ~/.claude/projects/-home-agent-projects-squeal--ai-cezar-
// worktrees-* and every Codex rollout under ~/.codex/sessions whose cwd lies in this repository,
// holding `SQUEAL · registered`. Prints one path per line; symlinks them into --link <dir> when
// given, so metric.mjs reads them without a copy.
//
// Usage: node select-sessions.mjs --since 2026-10-09T15:32:14Z [--until <iso>]
//          [--exclude <session id>]... [--link <dir>]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const opt = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
const since = Date.parse(opt("--since"));
const until = opt("--until") ? Date.parse(opt("--until")) : Number.POSITIVE_INFINITY;
const exclude = argv.flatMap((a, i) => (argv[i - 1] === "--exclude" ? [a] : []));
const link = opt("--link");
if (Number.isNaN(since)) throw new Error("--since <iso> is required");

const home = os.homedir();
const REPO = "/home/agent/projects/squeal";
const MARK = "SQUEAL · registered";

/** The first record's timestamp and the whole text, or null for an unreadable file. */
function read(file) {
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const r = JSON.parse(line);
      const ts = r.timestamp ?? r.payload?.timestamp;
      if (ts) return { start: Date.parse(ts), text, first: r };
    } catch {
      // A partial line of a live session.
    }
  }
  return null;
}

const picked = [];
const projects = path.join(home, ".claude/projects");
for (const dir of fs.readdirSync(projects)) {
  if (!dir.startsWith("-home-agent-projects-squeal--ai-cezar-worktrees-")) continue;
  for (const f of fs.readdirSync(path.join(projects, dir))) {
    const file = path.join(projects, dir, f);
    if (!f.endsWith(".jsonl") || exclude.some((x) => file.includes(x))) continue;
    const r = read(file);
    if (r && r.start >= since && r.start < until && r.text.includes(MARK))
      picked.push({ file, harness: "claude", start: r.start });
  }
}
const sessions = path.join(home, ".codex/sessions");
const days = [];
for (let d = since; d <= Math.min(until, Date.now()) + 864e5; d += 864e5)
  days.push(new Date(d).toISOString().slice(0, 10).replaceAll("-", "/"));
for (const day of new Set(days)) {
  const dir = path.join(sessions, day);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    const file = path.join(dir, f);
    if (!f.endsWith(".jsonl") || exclude.some((x) => file.includes(x))) continue;
    const r = read(file);
    const cwd = r?.first?.payload?.cwd ?? "";
    if (r && (cwd === REPO || cwd.startsWith(`${REPO}/`)) && r.start >= since && r.start < until)
      if (r.text.includes(MARK)) picked.push({ file, harness: "codex", start: r.start });
  }
}
picked.sort((a, b) => a.start - b.start);
if (link) fs.mkdirSync(link, { recursive: true });
for (const p of picked) {
  console.log(`${new Date(p.start).toISOString()}\t${p.harness}\t${p.file}`);
  if (link) {
    const name = `${p.harness}-${path.basename(path.dirname(p.file)).slice(-40)}-${path.basename(p.file)}`;
    fs.symlinkSync(p.file, path.join(link, name));
  }
}
console.error(`${picked.length} sessions`);
