// Throwaway: trim a hook.sh log for the repository: no environment values except PLUGIN_*/CODEX_HOME,
// presence flags for CLAUDE_PROJECT_DIR / CODEX_SESSION_ID / CODEX_THREAD_ID, shortened ids.
import { readFileSync } from 'node:fs';
for (const l of readFileSync(process.argv[2], 'utf8').trim().split('\n')) {
  const j = JSON.parse(l);
  const env = Object.fromEntries(Object.entries(j.env).filter(([k]) => /^(PLUGIN_|CODEX_HOME$)/.test(k)));
  const has = (k) => j.env_names.includes(k);
  console.log(JSON.stringify({ label: j.label, event: j.event, agent: j.agent_id ? j.agent_id.slice(0, 8) : 'main',
    pwd_P: j.pwd_P, PWD: j.PWD, stdin_cwd: j.stdin_cwd, CLAUDE_PROJECT_DIR: has('CLAUDE_PROJECT_DIR'),
    CODEX_SESSION_ID: has('CODEX_SESSION_ID'), CODEX_THREAD_ID: has('CODEX_THREAD_ID'), env }));
}
