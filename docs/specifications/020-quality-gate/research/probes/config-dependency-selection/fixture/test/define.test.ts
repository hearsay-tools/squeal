import { expect, test } from 'vitest'
declare const __FLAG__: string
test('define', () => expect(__FLAG__).toBe('on'))
