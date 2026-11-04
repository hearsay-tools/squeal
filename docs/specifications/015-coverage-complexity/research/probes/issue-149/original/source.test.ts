import { expect, test } from 'vitest'
import { single, multi, f } from './source'
test('expression arrows', () => {
  expect(single()).toEqual({ id: 'r1' })
  expect(single({ id: 'r2' })).toEqual({ id: 'r2' })
  expect(multi()).toEqual({ id: 'r1' })
})
test('type-asserted receiver', () => {
  expect(f({ id: 'r1' })).toBe(true)
})
