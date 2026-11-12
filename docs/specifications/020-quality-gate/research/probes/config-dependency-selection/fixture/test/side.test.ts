import { expect, test } from 'vitest'
test('config-load side effect', () => expect(process.env.CDS_SIDE).toBe('a'))
