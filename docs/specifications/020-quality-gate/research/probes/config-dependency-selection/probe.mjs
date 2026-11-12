// Throwaway (row 020-42). Runs every test file of <repo> once in-process the way
// Squeal's adapter starts Vitest (createVitest('test', { watch: false, reporters:
// [own], update: 'none', fsModuleCache: false, cache: false }), no --shard), and prints:
// the root config's configFileDependencies, the hash of Squeal's canonicalConfig
// (src/runners/vitest/environment.ts, imported through tsx), each file's state, the
// file order, and the V8 call counts of named functions in the Vitest main process.
// Usage: node --import <worktree>/node_modules/tsx/dist/esm/index.mjs probe.mjs <repo> <worktree>
import { createHash } from 'node:crypto'
import { rmSync } from 'node:fs'
import { Session } from 'node:inspector/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

const [root, worktree] = process.argv.slice(2)
const { createVitest } = await import(pathToFileURL(join(root, 'node_modules/vitest/dist/node.js')).href)
const { canonicalConfig } = await import(pathToFileURL(join(worktree, 'src/runners/vitest/environment.ts')).href)

const session = new Session()
session.connect()
await session.post('Profiler.enable')
await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: false })

rmSync(join(tmpdir(), 'cds-order'), { force: true })
const states = {}
const order = []
const errors = []
const reporter = {
  onTestModuleStart(m) { order.push(relative(root, m.moduleId)) },
  onTestModuleEnd(m) { states[relative(root, m.moduleId)] = m.state() },
}
let vitest
try {
  vitest = await createVitest('test', {
    root, watch: false, reporters: [reporter], update: 'none', fsModuleCache: false, cache: false,
  })
  const specs = await vitest.globTestSpecifications()
  await vitest.runTestSpecifications(specs)
} catch (error) {
  errors.push(String(error?.message ?? error).split('\n')[0])
}
const config = vitest?.vite.config
const deps = config ? config.configFileDependencies.map((f) => relative(root, f)).sort() : null
const paths = { relativizeText: (s) => s.split(root).join('<root>') }
const canonical = vitest ? canonicalConfig(vitest.projects[0], paths) : null
const configHash = canonical ? createHash('sha256').update(canonical).digest('hex').slice(0, 12) : null

const { result } = await session.post('Profiler.takePreciseCoverage')
const wanted = new Set(['pickShard', 'shard', 'sort', 'order', 'marker', 'transform', 'onTestRunEnd'])
const calls = {}
for (const script of result) {
  if (!/vitest\.config|\/config\//.test(script.url)) continue
  for (const fn of script.functions) {
    if (!wanted.has(fn.functionName)) continue
    const key = `${fn.functionName}@${script.url.replace(root, '<root>').replace(/\?.*$/, '').slice(-60)}`
    calls[key] = (calls[key] ?? 0) + fn.ranges[0].count
  }
}
const scripts = result.map((s) => s.url).filter((u) => /vitest\.config|\/config\//.test(u)).map((u) => u.replace(root, '<root>').slice(-80))
await vitest?.close()
console.log(JSON.stringify({ deps, configHash, states, order, errors, calls, scripts }))
process.exit(0)
