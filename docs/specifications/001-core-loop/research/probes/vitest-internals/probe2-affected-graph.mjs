// Throwaway probe (Q2, Q3): affected tests and dependency closure, before and after a run.
import { createVitest } from 'vitest/node'
import { resolve, relative } from 'node:path'

const root = resolve(import.meta.dirname, 'fixture')
const f = (p) => resolve(root, p)
const rel = (p) => relative(root, p)
const vitest = await createVitest('test', { root, watch: false, reporters: [] })
await vitest.standalone()
const project = vitest.getRootProject()
console.log('vite environments:', Object.keys(project.vite.environments))

function graphState(label) {
  for (const [name, env] of Object.entries(project.vite.environments)) {
    const mods = env.moduleGraph.getModulesByFile(f('src/deep.ts'))
    console.log(`  [${label}] env=${name} modules for deep.ts:`, mods ? [...mods].map(m => [...m.importers].map(i => rel(i.file))) : 'none',
      'idToModuleMap size', env.moduleGraph.idToModuleMap.size)
  }
}
graphState('before any run')

// Approach A: static "related" walk (transformRequest, no execution)
async function related(files) {
  vitest.config.related = files
  const t = performance.now()
  const specs = await vitest.getRelevantTestSpecifications()
  vitest.config.related = undefined
  return { ms: Math.round(performance.now() - t), files: specs.map(s => rel(s.moduleId)) }
}
for (const changed of ['src/deep.ts', 'src/config.json', 'src/setup-helper.ts', 'src/plugins/p1.ts', 'data/greeting.txt', 'test/strings.test.ts']) {
  console.log('related', changed, '->', JSON.stringify(await related([f(changed)])))
}
graphState('after related walk')

// Approach B: static AST parse, no execution
const specs = await vitest.globTestSpecifications()
let t = performance.now()
const parsed = await vitest.parseSpecifications(specs)
console.log('parseSpecifications', Math.round(performance.now() - t), 'ms')
for (const m of parsed) for (const tc of m.children.allTests()) console.log('   parsed:', tc.id, '|', tc.fullName, '|', JSON.stringify(tc.location))

// Approach C: collectTests (executes module top level in a worker, not test bodies)
t = performance.now()
const collected = await vitest.collectTests(specs)
console.log('collectTests', Math.round(performance.now() - t), 'ms, modules', collected.testModules.length)
for (const m of collected.testModules) for (const tc of m.children.allTests()) console.log('   collected:', tc.id, '|', tc.fullName, '| state', tc.result().state)
graphState('after collectTests')

// Closure after execution: walk importedModules in the runner environment
function closure(envName, file) {
  const env = project.vite.environments[envName]
  const seen = new Set()
  const walk = (m) => { if (!m || seen.has(m)) return; seen.add(m); m.importedModules.forEach(walk) }
  for (const m of env.moduleGraph.getModulesByFile(file) ?? []) walk(m)
  return [...seen].map(m => m.file ? rel(m.file) : m.id)
}
for (const name of Object.keys(project.vite.environments)) {
  console.log(`closure(${name}) fsread.test.ts`, closure(name, f('test/fsread.test.ts')))
  console.log(`closure(${name}) setup.ts`, closure(name, f('test/setup.ts')))
}
console.log('config file deps:', vitest.vite.config.configFile && rel(vitest.vite.config.configFile), project.vite.config.configFileDependencies?.map(rel))
console.log('snapshot path:', rel(await project.config.snapshotOptions.resolveSnapshotPath?.(f('test/strings.test.ts'), '.snap') ?? '?'))
console.log('snapshot update mode:', project.config.snapshotOptions.updateSnapshot, 'CI env:', !!process.env.CI)
await vitest.close()
