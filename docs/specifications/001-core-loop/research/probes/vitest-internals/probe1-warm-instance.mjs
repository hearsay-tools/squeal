// Throwaway probe (Q1, Q5): warm instance, own watcher off, explicit file lists, invalidation.
import { createVitest } from 'vitest/node'
import { writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, 'fixture')
const f = (p) => resolve(root, p)
const results = []
const reporter = {
  onTestCaseResult(tc) { results.push(`${tc.fullName} -> ${tc.result().state}`) },
}
const t0 = performance.now()
const vitest = await createVitest('test', { root, watch: false, reporters: [reporter] })
console.log('created in', Math.round(performance.now() - t0), 'ms; vite watcher closed?', vitest.vite.watcher.closed ?? '(no flag)')
await vitest.standalone()

async function run(label, files) {
  results.length = 0
  const t = performance.now()
  const specs = (await vitest.globTestSpecifications()).filter((s) => files.includes(s.moduleId))
  const r = await vitest.runTestSpecifications(specs)
  console.log(`[${label}] ${Math.round(performance.now() - t)} ms, modules=${r.testModules.length}`)
  for (const l of results) console.log('   ', l)
}

const deep = f('src/deep.ts')
const orig = readFileSync(deep, 'utf8')
try {
  await run('run1 math', [f('test/math.test.ts')])
  await run('run2 math again', [f('test/math.test.ts')])
  writeFileSync(deep, 'export const base = 20\n')
  await run('run3 after edit, NO invalidateFile', [f('test/math.test.ts')])
  vitest.invalidateFile(deep)
  await run('run4 after invalidateFile(deep)', [f('test/math.test.ts')])
  await run('run5 math + strings', [f('test/math.test.ts'), f('test/strings.test.ts')])
} finally {
  writeFileSync(deep, orig)
  await vitest.close()
}
