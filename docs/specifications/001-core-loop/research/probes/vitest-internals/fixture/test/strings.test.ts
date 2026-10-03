import { it, expect } from 'vitest'
import { upper } from '../src/strings'
import cfg from '../src/config.json'
it('upper', () => { expect(upper('a')).toBe('A') })
it('json', () => { expect(cfg.answer).toBe(42) })
it('snapshot', () => { expect({ v: upper('snap') }).toMatchSnapshot() })
