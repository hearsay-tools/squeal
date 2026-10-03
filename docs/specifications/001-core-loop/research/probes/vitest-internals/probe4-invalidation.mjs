// Throwaway probe (Q5): invalidateFile for changed imports, deleted file, new test file, changed config.
import { createVitest } from 'vitest/node'
import { writeFileSync, readFileSync, rmSync, renameSync } from 'node:fs'
import { resolve, relative } from 'node:path'

const root = resolve(import.meta.dirname, 'fixture')
const f = (p) => resolve(root, p)
const rel = (p) => relative(root, p)
const backup = new Map()
const save = (p) => backup.has(p) || backup.set(p, readFileSync(f(p), 'utf8'))
const vitest = await createVitest('test', { root, watch: false, reporters: [] })
await vitest.standalone()
const run = async (label, files) => {
  const specs = (await vitest.globTestSpecifications()).filter((s) => files.map(f).includes(s.moduleId))
  const r = await vitest.runTestSpecifications(specs)
  const lines = r.testModules.map(m => `${rel(m.moduleId)}:${m.state()} errors=${JSON.stringify(m.errors().map(e => e.message.slice(0, 80)))} tests=${[...m.children.allTests()].map(t => t.name + ':' + t.result().state).join(',')}`)
  console.log(`[${label}] specs=${specs.length}`, lines, 'unhandled', r.unhandledErrors.length)
}
const related = async (file) => { vitest.config.related = [f(file)]; const s = await vitest.getRelevantTestSpecifications(); return s.map(x => rel(x.moduleId)) }
try {
  await run('baseline', ['test/math.test.ts'])
  // 1. imports of math.ts change: drop ./deep, import ./strings
  save('src/math.ts')
  writeFileSync(f('src/math.ts'), "import { upper } from './strings'\nexport const add = (a: number, b: number) => a + b\nexport const addBase = (a: number) => a + 10 + upper('').length\n")
  console.log('related(strings) before invalidate:', await related('src/strings.ts'), 'related(deep):', await related('src/deep.ts'))
  vitest.invalidateFile(f('src/math.ts'))
  console.log('related(strings) after invalidate:', await related('src/strings.ts'), 'related(deep):', await related('src/deep.ts'))
  await run('after math.ts import change', ['test/math.test.ts'])
  writeFileSync(f('src/math.ts'), backup.get('src/math.ts')); vitest.invalidateFile(f('src/math.ts'))
  // 2. deleted source file
  renameSync(f('src/deep.ts'), f('src/deep.ts.bak'))
  await run('deep.ts deleted, no invalidate', ['test/math.test.ts'])
  vitest.invalidateFile(f('src/deep.ts'))
  await run('deep.ts deleted, invalidated', ['test/math.test.ts'])
  renameSync(f('src/deep.ts.bak'), f('src/deep.ts')); vitest.invalidateFile(f('src/deep.ts'))
  // 3. deleted test file
  renameSync(f('test/strings.test.ts'), f('test/strings.test.ts.bak'))
  console.log('glob after deleting strings.test.ts:', (await vitest.globTestSpecifications()).map(s => rel(s.moduleId)))
  vitest.clearSpecificationsCache()
  console.log('glob after clearSpecificationsCache:', (await vitest.globTestSpecifications()).map(s => rel(s.moduleId)))
  renameSync(f('test/strings.test.ts.bak'), f('test/strings.test.ts'))
  // 4. new test file
  writeFileSync(f('test/new.test.ts'), "import { it, expect } from 'vitest'\nit('new', () => expect(1).toBe(1))\n")
  console.log('glob after creating new.test.ts:', (await vitest.globTestSpecifications()).map(s => rel(s.moduleId)))
  console.log('project.matchesTestGlob(new):', vitest.getRootProject().matchesTestGlob(f('test/new.test.ts')))
  vitest.clearSpecificationsCache()
  console.log('glob after clearSpecificationsCache:', (await vitest.globTestSpecifications()).map(s => rel(s.moduleId)))
  await run('new test file', ['test/new.test.ts'])
  rmSync(f('test/new.test.ts'))
  // 5. changed config: add a define + testTimeout
  save('vitest.config.ts')
  writeFileSync(f('vitest.config.ts'), backup.get('vitest.config.ts').replace("setupFiles", "include: ['test/math.test.ts'], setupFiles"))
  vitest.invalidateFile(f('vitest.config.ts'))
  vitest.clearSpecificationsCache()
  console.log('config include after editing config + invalidate:', vitest.config.include, 'glob:', (await vitest.globTestSpecifications()).map(s => rel(s.moduleId)))
} finally {
  for (const [p, c] of backup) writeFileSync(f(p), c)
  await vitest.close()
}
