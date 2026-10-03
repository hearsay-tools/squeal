import { it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { loadByName } from '../src/dyn'
it('reads data file at runtime', () => {
  expect(readFileSync(new URL('../data/greeting.txt', import.meta.url), 'utf8').trim()).toBe('hello')
})
it('dynamic import with variable', async () => { expect(await loadByName('p1')).toBe('p1') })
