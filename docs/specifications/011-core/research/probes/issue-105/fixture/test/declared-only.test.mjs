import { test, expect } from 'vitest'

// squeal.config.json declares the ignored .ai/qa/declared-only.json; this file never reads it.
test('declared only', () => expect(true).toBe(true))
