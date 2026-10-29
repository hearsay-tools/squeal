// Throwaway probe, row 011-267. Reads the trial worker's named-wait outputs
// (cezar worktree 563b3d1c, .ai/qa/2141, read-only) and writes waits.json:
// for each wait, its end (file mtime), waited ms, selected files and pending files.
import { readdirSync, readFileSync, statSync } from 'node:fs';
const dir = process.argv[2] ?? '/home/agent/projects/cezar/.ai/cezar/worktrees/563b3d1c-f5b8-46ee-b702-a8feb6d1e143/.ai/qa/2141';
const out = [];
for (const name of readdirSync(dir).filter((n) => /^parity-\d+\.json$/.test(n))) {
  const path = `${dir}/${name}`;
  let x;
  try { x = JSON.parse(readFileSync(path, 'utf8')); } catch { continue; }
  const s = x.selection;
  if (!s) continue;
  const end = statSync(path).mtimeMs;
  out.push({
    name,
    start: new Date(end - (s.waitedMs ?? 0)).toISOString(),
    end: new Date(end).toISOString(),
    waitedMs: s.waitedMs,
    outcome: s.outcome,
    selected: s.testFiles.length,
    pending: s.testFiles.filter((f) => f.state === 'pending').map((f) => f.path),
  });
}
out.sort((a, b) => a.end.localeCompare(b.end));
console.log(JSON.stringify(out, null, 1));
