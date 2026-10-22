// Summarize probe JSONL without copying the repeated registration primer.
import { readFileSync } from 'node:fs';
for (const file of process.argv.slice(2)) {
  const rows = readFileSync(file,'utf8').trim().split('\n').map(JSON.parse);
  const hooks = rows.filter(r=>r.event==='hook');
  const boundaries = hooks.filter(r=>r.name==='post-tool-use');
  const snapshots = rows.filter(r=>r.event==='snapshot');
  const claims = [...new Set(snapshots.flatMap(r=>r.meta.filter(m=>m.key.startsWith('daemon-handoff:')).map(m=>m.value)))].map(JSON.parse);
  const notices = boundaries.filter(r=>r.stdout).map(r=>({at:r.at,iteration:r.iteration,version:r.version,text:JSON.parse(r.stdout).hookSpecificOutput.additionalContext}));
  console.log(JSON.stringify({file,host:rows[0],releases:rows.filter(r=>r.event==='release'&&r.version),boundaries:boundaries.length,silent:boundaries.filter(r=>!r.stdout).length,hookExitCodes:[...new Set(hooks.map(r=>r.code))],hookSignals:[...new Set(hooks.map(r=>r.signal))],maxHookMs:Math.max(...hooks.map(r=>r.ms)),notices,claims,versions:[...new Set(snapshots.map(r=>r.worktree?.daemon_version))],revisions:[...new Set(snapshots.map(r=>r.revision.revision))],finalDaemon:snapshots.at(-1)?.worktree,finalClaims:snapshots.at(-1)?.meta.filter(m=>m.key.startsWith('daemon-handoff:')),hold:rows.find(r=>r.event==='hold')??null,release:rows.find(r=>r.event==='release'&&!r.version)??null,cleanTree:rows.find(r=>r.event==='clean-tree'),cleanup:rows.find(r=>r.event==='cleanup')},null,2));
}
