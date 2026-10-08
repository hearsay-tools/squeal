// Throwaway: cost of the liveness and identity checks, and of the hook-side rule.
import { readFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
const N = 20000;
const time = (label, f, n = N) => { for (let i = 0; i < 200; i++) f(); const t = process.hrtime.bigint(); for (let i = 0; i < n; i++) f(); console.log(label.padEnd(52), (Number(process.hrtime.bigint() - t) / n / 1000).toFixed(2), 'us/call'); };
const startOf = (pid) => { const s = readFileSync(`/proc/${pid}/stat`, 'latin1'); const r = s.slice(s.lastIndexOf(')') + 2).split(' '); return { comm: s.slice(s.indexOf('(') + 1, s.lastIndexOf(')')), ppid: +r[1], start: r[19] }; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const same = (rec) => { try { return startOf(rec.pid).start === rec.start; } catch { return false; } };
const SHELLS = new Set(['sh', 'dash', 'bash', 'zsh', 'ksh', 'mksh', 'fish', 'env', 'timeout', 'nohup']);
const harness = () => { let pid = process.ppid; for (let i = 0; i < 4 && pid > 1; i++) { const s = startOf(pid); if (!SHELLS.has(s.comm)) return { pid, start: s.start, comm: s.comm }; pid = s.ppid; } return null; };
const dead = spawn('true'); await new Promise((r) => dead.on('exit', r)); const deadPid = dead.pid;
const live = spawn('sleep', ['60']); const liveRec = { pid: live.pid, ...startOf(live.pid) };
time('kill(pid, 0), live', () => alive(live.pid));
time('kill(pid, 0), dead (ESRCH)', () => alive(deadPid));
time('/proc/<pid>/stat read + field 22, live', () => same(liveRec));
time('/proc/<pid>/stat read, dead (ENOENT)', () => same({ pid: deadPid, start: '1' }));
time('hook rule: ppid, skip shells, read start', harness);
console.log('rule from this process:', JSON.stringify(harness()));
// PID reuse, emulated: a record whose pid is now a live, different process.
console.log('identity, live original:', same(liveRec), ' kill0:', alive(live.pid));
console.log('identity, pid reused (same pid, other start):', same({ pid: live.pid, start: String(+liveRec.start - 1) }), ' kill0 alone would say:', alive(live.pid));
live.kill('SIGKILL'); await new Promise((r) => live.on('exit', r));
console.log('identity after SIGKILL:', same(liveRec), ' kill0:', alive(liveRec.pid));
time('spawn ps -o lstart= -p <pid> (Linux procps)', () => execFileSync('ps', ['-o', 'lstart=', '-p', String(process.pid)]), 200);
console.log('ps lstart sample:', execFileSync('ps', ['-o', 'lstart=', '-p', String(process.pid)]).toString().trim());
