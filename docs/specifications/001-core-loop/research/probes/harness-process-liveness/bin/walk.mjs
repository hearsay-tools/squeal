#!/usr/bin/env node
// Throwaway probe: log this hook's ppid chain with /proc start times.
import { readFileSync, appendFileSync, readlinkSync } from 'node:fs';
const t0 = process.hrtime.bigint();
const label = process.argv[2] ?? 'hook';
let stdin = '';
try { stdin = readFileSync(0, 'utf8'); } catch {}
let ev = {};
try { ev = JSON.parse(stdin); } catch {}
const stat = (pid) => {
  const s = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const r = s.slice(s.lastIndexOf(')') + 2).split(' '); // fields from 3 on
  return { comm: s.slice(s.indexOf('(') + 1, s.lastIndexOf(')')), ppid: +r[1], pgid: +r[2], sid: +r[3], start: r[19] };
};
const tw = process.hrtime.bigint();
const chain = [];
for (let pid = process.pid; pid > 1 && chain.length < 12;) {
  let st; try { st = stat(pid); } catch { break; }
  let exe = ''; try { exe = readlinkSync(`/proc/${pid}/exe`); } catch {}
  let cmd = ''; try { cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').slice(0, 140); } catch {}
  chain.push({ pid, ...st, exe, cmd });
  pid = st.ppid;
}
const walkUs = Number(process.hrtime.bigint() - tw) / 1000;
const envNames = Object.keys(process.env).filter((k) => /^(CLAUDE|CODEX|CEZ_)/.test(k)).sort();
const envVals = Object.fromEntries(envNames.filter((k) => /PID|SESSION_ID|CHILD_SESSION|ENTRYPOINT|THREAD|ATTENDED/.test(k) && !/TOKEN|KEY|SECRET/.test(k)).map((k) => [k, process.env[k]]));
const rec = {
  t: Date.now(), label, event: ev.hook_event_name, session: ev.session_id, agent_id: ev.agent_id, agent_type: ev.agent_type,
  pid: process.pid, ppid: process.ppid, walkUs, totalUs: Number(process.hrtime.bigint() - t0) / 1000, envNames, envVals, chain,
};
appendFileSync(process.env.PROBE_LOG ?? '/tmp/hpl/probe.jsonl', JSON.stringify(rec) + '\n');
