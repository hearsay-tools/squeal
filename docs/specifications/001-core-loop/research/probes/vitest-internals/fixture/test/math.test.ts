import { describe, it, expect } from 'vitest'
import { add, addBase } from '../src/math'
describe('math', () => {
  describe('add', () => {
    it('adds', () => { expect(add(1, 2)).toBe(3) })
    it.each([[1, 1, 2], [2, 2, 4]])('add(%i, %i) = %i', (a, b, r) => { expect(add(a, b)).toBe(r) })
  })
  it('addBase', () => { expect(addBase(1)).toBe(11) })
  it('setup ran', () => { expect((globalThis as any).SETUP_VALUE).toBe(42) })
})
