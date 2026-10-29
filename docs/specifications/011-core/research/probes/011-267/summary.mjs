// Throwaway probe, row 011-267. Prints each run of traces.json in one line:
// start (UTC), wall s, files, named files, longest named file, file-seconds.
import { readFileSync } from 'node:fs';
const traces = JSON.parse(readFileSync(new URL('./traces.json', import.meta.url), 'utf8'));
for (const t of traces) {
  console.log(`# ${t.name} worktree ${t.worktree}`);
  const seen = new Set();
  for (const r of t.runs) {
    const n = r.files.filter((f) => f.named);
    const sum = r.files.reduce((a, f) => a + (f.s ?? 0), 0);
    const nsum = n.reduce((a, f) => a + (f.s ?? 0), 0);
    n.forEach((f) => seen.add(f.path));
    const longest = Math.max(0, ...n.map((f) => f.s ?? 0));
    console.log([r.start.slice(11, 19), String(r.wall?.toFixed(1)).padStart(6), String(r.end).padEnd(9), 'rev' + r.revision, r.checkpoint ? 'cp' : '  ',
      `files=${r.files.length}`.padEnd(10), `named=${n.length}`.padEnd(9), `namedMax=${longest.toFixed(0)}`.padEnd(12), `namedSum=${nsum.toFixed(0)}`.padEnd(13), `sum=${sum.toFixed(0)}`, `seen=${seen.size}`].join(' '));
  }
}
