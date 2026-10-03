// Throwaway probe (Q4): per-test result shape, id stability across runs, edits and worktree copies.
import { createVitest } from 'vitest/node'
import { writeFileSync, rmSync, cpSync, mkdtempSync, symlinkSync } from 'node:fs'
import { resolve, relative, join } from 'node:path'
import { tmpdir } from 'node:os'

const failFile = `import { describe, it, expect } from 'vitest'
import { add } from '../src/math'
describe('failing', () => {
  it('assertion', () => {
    expect(add(1, 1)).toBe(3)
  })
  it('throws', () => { throw new TypeError('boom') })
  it.skip('skipped', () => {})
  it('slow pass', async () => { await new Promise(r => setTimeout(r, 30)) })
})
`
async function runOnce(root, extra = '') {
  writeFileSync(resolve(root, 'test/fail.test.ts'), extra + failFile)
  const out = []
  const vitest = await createVitest('test', { root, watch: false, includeTaskLocation: true, reporters: [{
    onTestCaseResult(tc) { out.push(tc) },
  }] })
  const specs = (await vitest.globTestSpecifications()).filter(s => s.moduleId.endsWith('fail.test.ts'))
  const res = await vitest.runTestSpecifications(specs)
  const summary = out.map(tc => ({ id: tc.id, fullName: tc.fullName, name: tc.name, location: tc.location,
    moduleId: relative(root, tc.module.moduleId), project: tc.project.name, state: tc.result().state,
    duration: Math.round(tc.diagnostic()?.duration ?? -1), flaky: tc.diagnostic()?.flaky, retryCount: tc.diagnostic()?.retryCount,
    errors: tc.result().errors?.map(e => ({ name: e.name, message: e.message, stacks: e.stacks?.slice(0, 1), diff: e.diff?.slice(0, 60), expected: e.expected, actual: e.actual, stackFirstLine: e.stack?.split('\n')[1]?.trim() })) }))
  const mod = res.testModules[0]
  await vitest.close()
  rmSync(resolve(root, 'test/fail.test.ts'))
  return { summary, moduleState: mod.state(), moduleDiag: Object.keys(mod.diagnostic()) }
}
const root = resolve(import.meta.dirname, 'fixture')
const a = await runOnce(root)
console.log(JSON.stringify(a.summary.slice(0, 2), null, 1))
console.log('module state', a.moduleState, 'module diagnostic keys', a.moduleDiag)
console.log('ids run A:', a.summary.map(s => `${s.id}=${s.fullName}`).join(', '))
const b = await runOnce(root)
console.log('same ids across two cold instances:', JSON.stringify(a.summary.map(s => s.id)) === JSON.stringify(b.summary.map(s => s.id)))
const c = await runOnce(root, "import { it as it0 } from 'vitest'\nit0('inserted first', () => {})\n")
console.log('ids after inserting a test at top:', c.summary.map(s => `${s.id}=${s.fullName}`).join(', '))
// worktree copy at another absolute path
const copy = mkdtempSync(join(tmpdir(), 'squeal-wt-'))
cpSync(root, copy, { recursive: true, filter: (s) => !s.includes('node_modules') })
symlinkSync(resolve(import.meta.dirname, 'node_modules'), join(copy, 'node_modules'))
const d = await runOnce(copy)
console.log('copy at', copy, 'same ids as original:', JSON.stringify(a.summary.map(s => s.id)) === JSON.stringify(d.summary.map(s => s.id)))
rmSync(copy, { recursive: true })
