import { spawn } from 'node:child_process'
import { appendFileSync, openSync, closeSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Like cezarion's test-env-up.sh + test-env-lease.mjs detach-app: start a server in its
// own process group, cwd the worktree root, output to a log under .ai/qa, then unref it.
const root = import.meta.dirname
const qa = resolve(root, '.ai/qa')
const log = (line) => appendFileSync(resolve(qa, 'events.log'), `${new Date().toISOString()} ${line}\n`)

export async function setup() {
  log(`setup pid=${process.pid} ppid=${process.ppid}`)
  const fd = openSync(resolve(qa, 'test-env-app.log'), 'a')
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, detached: true, stdio: ['ignore', fd, fd] })
  closeSync(fd)
  child.unref()
  log(`server pid=${child.pid}`)
  // Wait until the server wrote its port.
  for (let i = 0; i < 100; i++) {
    try { process.env.PROBE_PORT = readFileSync(resolve(qa, 'port'), 'utf8'); break } catch {}
    await new Promise((r) => setTimeout(r, 50))
  }
  // cezarion's teardown releases the lease only; the server is left to a watcher.
  return () => log(`teardown pid=${process.pid}`)
}
