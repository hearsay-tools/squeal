import { expect, test } from 'vitest'
import { mark } from '../src/marked'
test('plugin', () => expect(mark).toBe('one'))
