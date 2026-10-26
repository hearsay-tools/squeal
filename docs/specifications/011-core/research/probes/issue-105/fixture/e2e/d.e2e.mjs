import { test, expect } from 'vitest'

// A spec that reads no ignored file: the control.
test('arithmetic', () => expect(1 + 1).toBe(2))
