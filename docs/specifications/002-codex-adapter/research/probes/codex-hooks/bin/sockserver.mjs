// Throwaway Q7 probe: a unix-socket echo server standing in for the Squeal
// daemon. Usage: node sockserver.mjs <path> <seconds>; exits on its own.
import { createServer } from 'node:net';
import { rmSync } from 'node:fs';
const [path, secs] = process.argv.slice(2);
rmSync(path, { force: true });
const srv = createServer((c) => c.on('data', (d) => c.end(`pong ${String(d).trim()}\n`)));
srv.listen(path);
setTimeout(() => { srv.close(); rmSync(path, { force: true }); process.exit(0); }, Number(secs) * 1000);
