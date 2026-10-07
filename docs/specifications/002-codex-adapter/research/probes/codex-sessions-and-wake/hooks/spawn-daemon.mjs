// Throwaway SessionStart hook: spawn the fake daemon detached, as spec 001 D10 does, and return at once.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
try { readFileSync(0); } catch {}
const child = spawn('sh', [new URL('../bin/fake-daemon.sh', import.meta.url).pathname, process.argv[2]], { detached: true, stdio: 'ignore', cwd: '/tmp' });
child.unref();
