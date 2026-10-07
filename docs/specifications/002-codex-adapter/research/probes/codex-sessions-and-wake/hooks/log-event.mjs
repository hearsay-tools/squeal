// Throwaway probe hook: append one JSON line per hook event to the log named by argv[2].
// Records the stdin payload and only CODEX_/PLUGIN_ environment names that are not credentials.
import { appendFileSync, readFileSync } from 'node:fs';
const log = process.argv[2];
let input = '';
try { input = readFileSync(0, 'utf8'); } catch {}
let parsed; try { parsed = JSON.parse(input); } catch { parsed = { raw: input }; }
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
  /^(CODEX_|PLUGIN_|CLAUDE_PLUGIN_)/.test(k) && !/KEY|TOKEN|SECRET|AUTH|CERT/i.test(k)));
appendFileSync(log, JSON.stringify({ t: Date.now(), pid: process.pid, ppid: process.ppid, cwd: process.cwd(), input: parsed, env }) + '\n');
const extra = process.argv[3];
if (extra && parsed.hook_event_name === 'SessionStart') {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: readFileSync(extra, 'utf8') } }));
}
