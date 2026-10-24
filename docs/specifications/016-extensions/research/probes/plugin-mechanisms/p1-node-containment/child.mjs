// Host runs the plugin in a child process; a timeout kills it.
import { fork } from 'node:child_process';
if (process.argv[2] === '--child') {
  const { check } = await import('./plugin.mjs');
  process.send(String(await check(process.argv[3])));
  process.disconnect();
} else {
  const c = fork(new URL(import.meta.url).pathname, ['--child', process.argv[2]], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let err = ''; c.stderr.on('data', (d) => (err += d));
  const t = setTimeout(() => { console.log('[host] timeout: SIGKILL child'); c.kill('SIGKILL'); }, 500);
  c.on('message', (m) => console.log(`[host] plugin returned ${m}`));
  c.on('exit', (code, sig) => { clearTimeout(t); console.log(`[host] child exit code=${code} signal=${sig} stderr-first-line=${JSON.stringify(err.split('\n').find((l) => l.includes('Error')) ?? '')}`); });
}
