import { expect, test } from 'vitest'
declare const __DATA__: string
test('json data', () => expect(__DATA__).toBe('d1'))
