// Throwaway probe (Q6): timings on fixture50 (50 files x 6 tests). Usage: node probe5-cost.mjs [pool] [isolate]
import { createVitest } from 'vitest/node'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, 'fixture50')
const pool = process.argv[2] ?? 'forks'
const isolate = process.argv[3] !== 'false'
const ms = (t) => Math.round(performance.now() - t)
const time = async (label, fn) => { const t = performance.now(); const r = await fn(); console.log(label.padEnd(44), ms(t), 'ms'); return r }
console.log(`pool=${pool} isolate=${isolate}`)
const vitest = await time('createVitest', () => createVitest('test', { root, watch: false, reporters: [], pool, isolate }))
await time('standalone()', () => vitest.standalone())
const specs = await time('globTestSpecifications', () => vitest.globTestSpecifications())
await time('related walk, cold (transform all, no exec)', async () => { vitest.config.related = [resolve(root, 'src/m0.ts')]; const s = await vitest.getRelevantTestSpecifications(); vitest.config.related = undefined; return s })
await time('related walk, warm', async () => { vitest.config.related = [resolve(root, 'src/m0.ts')]; const s = await vitest.getRelevantTestSpecifications(); vitest.config.related = undefined; console.log('   affected by m0:', s.length); return s })
await time('parseSpecifications (static AST)', () => vitest.parseSpecifications(specs))
await time('collectTests (executes module top level)', () => vitest.collectTests(specs))
await time('collectTests again', () => vitest.collectTests(specs))
await time('run all 50, first', () => vitest.runTestSpecifications(specs))
await time('run all 50, second', () => vitest.runTestSpecifications(specs))
await time('run 1 file, warm', () => vitest.runTestSpecifications(specs.slice(0, 1)))
await time('run 5 files, warm', () => vitest.runTestSpecifications(specs.slice(0, 5)))
await time('close', () => vitest.close())
