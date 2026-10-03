// Throwaway probe (Q3, Q7): snapshots, projects, AgentReporter, process.exitCode.
import { createVitest } from 'vitest/node'
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { resolve, relative } from 'node:path'
const root = resolve(import.meta.dirname, 'fixture')
const f = (p) => resolve(root, p)
const snap = f('test/__snapshots__/strings.test.ts.snap')
const snapOrig = readFileSync(snap, 'utf8')
const states = (r) => r.testModules.flatMap(m => [...m.children.allTests()].map(t => `${t.project.name || '-'}:${t.id}:${t.name}:${t.result().state}`))
try {
  // A. snapshot file edited on disk, warm instance, no invalidate
  let v = await createVitest('test', { root, watch: false, reporters: [] })
  let specs = (await v.globTestSpecifications()).filter(s => s.moduleId.endsWith('strings.test.ts'))
  console.log('A1 baseline', states(await v.runTestSpecifications(specs)).filter(s => s.includes('snapshot')))
  writeFileSync(snap, snapOrig.replace('"SNAP"', '"CHANGED"'))
  console.log('A2 .snap edited, no invalidate', states(await v.runTestSpecifications(specs)).filter(s => s.includes('snapshot')))
  v.config.related = [snap]; console.log('A3 related(.snap) ->', (await v.getRelevantTestSpecifications()).length, 'specs'); v.config.related = undefined
  console.log('A4 snapshot summary', JSON.stringify(v.snapshot.summary).slice(0, 200))
  console.log('A5 process.exitCode after failing run:', process.exitCode); process.exitCode = 0
  await v.close()
  // B. missing snapshot with update:'none' vs default
  rmSync(snap)
  v = await createVitest('test', { root, watch: false, reporters: [], update: 'none' })
  specs = (await v.globTestSpecifications()).filter(s => s.moduleId.endsWith('strings.test.ts'))
  const r = await v.runTestSpecifications(specs)
  console.log("B1 update:'none', missing snap:", states(r).filter(s => s.includes('snapshot')), 'file written:', existsSync(snap))
  console.log('   error:', [...r.testModules[0].children.allTests()].find(t => t.name === 'snapshot').result().errors?.[0]?.message)
  await v.close()
  // C. projects: same file in two projects
  const cfg = f('vitest.projects.config.ts')
  writeFileSync(cfg, `import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { projects: [
  { test: { name: 'unit', include: ['test/math.test.ts'], setupFiles: ['test/setup.ts'] } },
  { test: { name: 'other', include: ['test/math.test.ts'], setupFiles: ['test/setup.ts'], environment: 'node' } },
] } })\n`)
  v = await createVitest('test', { root, config: cfg, watch: false, reporters: [], update: 'none' })
  specs = await v.globTestSpecifications()
  console.log('C1 specs:', specs.map(s => `${s.project.name}:${relative(root, s.moduleId)}`))
  console.log('C2 results:', states(await v.runTestSpecifications(specs)).filter(s => s.includes('adds')))
  v.config.related = [f('src/deep.ts')]; console.log('C3 related(deep):', (await v.getRelevantTestSpecifications()).map(s => s.project.name)); v.config.related = undefined
  console.log('C4 vite servers distinct per project:', v.projects[0].vite !== v.projects[1].vite)
  await v.close(); rmSync(cfg)
} finally {
  writeFileSync(snap, snapOrig)
  process.exitCode = 0
}
