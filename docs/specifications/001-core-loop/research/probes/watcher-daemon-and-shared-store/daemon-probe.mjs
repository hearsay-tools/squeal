// THROWAWAY PROBE. Not product code. See README.md.
// Daemon lifecycle experiments: singleton lock that self-releases on crash, detached spawn from a hook,
// unix socket path limits, and hook->daemon round-trip latency.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const cmd = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Number(process.hrtime.bigint()) / 1e6;
const SOCK = path.join(process.env.XDG_RUNTIME_DIR ?? '/tmp', `squeal-probe-${process.getuid()}.sock`);

// A tiny fake daemon: holds an exclusive SQLite lock on a lock DB for its lifetime, serves a unix socket.
if (cmd === 'daemon') {
  const lock = new DatabaseSync('tmp/daemon.lock.db', { timeout: 0 });
  try { lock.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE'); } catch (e) {
    fs.appendFileSync('tmp/daemon.log', `${process.pid} lost lock: ${e.message}\n`); process.exit(3);
  }
  fs.rmSync(SOCK, { force: true }); // safe: we hold the lock, so no live daemon owns this socket
  const srv = net.createServer((c) => c.on('data', () => c.end(JSON.stringify({ pid: process.pid, failures: [] }) + '\n')));
  srv.listen(SOCK, () => fs.appendFileSync('tmp/daemon.log', `${process.pid} serving\n`));
  setTimeout(() => process.exit(0), Number(process.argv[3] ?? 5000));
}

// Hook-like client: ask the daemon, never wait longer than 100 ms.
if (cmd === 'client') {
  const t0 = now();
  const s = net.connect(SOCK);
  const done = (r) => { process.stdout.write(JSON.stringify({ ...r, ms: +(now() - t0).toFixed(2) }) + '\n'); process.exit(0); };
  s.setTimeout(100, () => done({ err: 'timeout' }));
  s.on('error', (e) => done({ err: e.code }));
  s.on('connect', () => s.write('status\n'));
  s.on('data', (d) => done({ reply: JSON.parse(d) }));
}

if (cmd === 'race') {
  // Start 5 daemons at once: exactly one must win.
  fs.rmSync('tmp/daemon.log', { force: true });
  const ps = Array.from({ length: 5 }, () => spawn(process.execPath, ['daemon-probe.mjs', 'daemon', '1500'], { stdio: 'ignore' }));
  const codes = await Promise.all(ps.map((p) => new Promise((r) => p.on('close', r))));
  console.log(JSON.stringify({ test: 'race 5 daemons', exitCodes: codes, log: fs.readFileSync('tmp/daemon.log', 'utf8').trim().split('\n') }));
}

if (cmd === 'crash') {
  // SIGKILL the daemon: lock must be released by the OS, socket file stays behind (stale).
  const d = spawn(process.execPath, ['daemon-probe.mjs', 'daemon', '60000'], { stdio: 'ignore' });
  await sleep(400);
  const before = spawnSync(process.execPath, ['daemon-probe.mjs', 'client'], { encoding: 'utf8' }).stdout.trim();
  d.kill('SIGKILL'); await new Promise((r) => d.on('close', r));
  const staleSocketFile = fs.existsSync(SOCK);
  const afterKill = spawnSync(process.execPath, ['daemon-probe.mjs', 'client'], { encoding: 'utf8' }).stdout.trim();
  const t0 = now();
  const d2 = spawn(process.execPath, ['daemon-probe.mjs', 'daemon', '1500'], { stdio: 'ignore' });
  let replacement;
  for (let i = 0; i < 50 && !replacement; i++) {
    await sleep(20);
    const r = JSON.parse(spawnSync(process.execPath, ['daemon-probe.mjs', 'client'], { encoding: 'utf8' }).stdout);
    if (r.reply) replacement = { ...r, sinceSpawnMs: +(now() - t0).toFixed(0) };
  }
  await new Promise((r) => d2.on('close', r));
  console.log(JSON.stringify({ test: 'crash recovery', before: JSON.parse(before), staleSocketFile, afterKill: JSON.parse(afterKill), replacement }));
}

if (cmd === 'hook-spawn') {
  // A hook script that starts a detached daemon and exits. Measures hook wall time; checks the daemon outlives
  // the hook's whole process group being killed (harness timeout behaviour).
  const t0 = now();
  const r = spawnSync('bash', ['-c', `set -m; ${process.execPath} -e "
    const {spawn}=require('node:child_process');
    spawn(process.execPath,['daemon-probe.mjs','daemon','3000'],{detached:true,stdio:'ignore'}).unref();
  " & wait; kill -9 -$! 2>/dev/null; true`], { encoding: 'utf8' });
  const hookMs = +(now() - t0).toFixed(1);
  await sleep(500);
  const c = JSON.parse(spawnSync(process.execPath, ['daemon-probe.mjs', 'client'], { encoding: 'utf8' }).stdout);
  console.log(JSON.stringify({ test: 'hook spawns detached daemon', hookMs, daemonAliveAfterHookGroupKilled: !!c.reply, client: c, stderr: r.stderr.slice(0, 100) }));
  await sleep(3000);
}

if (cmd === 'pathlen') {
  const out = {};
  for (const len of [100, 107, 108, 120]) {
    const p = '/tmp/' + 'x'.repeat(len - 5 - 5) + '.sock';
    out[len] = await new Promise((r) => {
      const s = net.createServer();
      s.on('error', (e) => r(e.code));
      s.listen(p, () => { const a = s.address(); s.close(); fs.rmSync(p, { force: true }); r(`ok, bound as ${a.length} chars`); });
    });
  }
  console.log(JSON.stringify({ test: 'unix socket path length (Linux sun_path is 108 incl NUL; macOS 104)', out }));
}

if (cmd === 'rtt') {
  // Round trip cost inside one warm process, unix socket vs HTTP on 127.0.0.1, 200 requests each.
  const http = await import('node:http');
  const us = net.createServer((c) => c.on('data', () => c.end('{"ok":true}\n'))).listen(SOCK + '.rtt');
  const hs = http.createServer((q, s) => s.end('{"ok":true}')).listen(0, '127.0.0.1');
  await sleep(100);
  const t = { unix: [], http: [] };
  for (let i = 0; i < 200; i++) {
    let t0 = now();
    await new Promise((r) => { const s = net.connect(SOCK + '.rtt'); s.on('connect', () => s.write('x')); s.on('data', () => { s.destroy(); r(); }); });
    t.unix.push(now() - t0);
    t0 = now();
    await (await fetch(`http://127.0.0.1:${hs.address().port}/`)).text();
    t.http.push(now() - t0);
  }
  const med = (a) => +a.sort((x, y) => x - y)[a.length >> 1].toFixed(3);
  console.log(JSON.stringify({ test: 'warm round trip median ms', unix: med(t.unix), httpFetch: med(t.http) }));
  us.close(); hs.close(); fs.rmSync(SOCK + '.rtt', { force: true });
}
