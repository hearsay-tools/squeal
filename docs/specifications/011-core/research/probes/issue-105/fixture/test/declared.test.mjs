import { existsSync, readFileSync } from 'node:fs'
import { test, expect } from 'vitest'

// squeal.config.json declares the ignored .ai/qa/declared.json as this file's input.
test('the declared input, when present, is JSON', () => {
  const p = '.ai/qa/declared.json'
  if (existsSync(p)) expect(() => JSON.parse(readFileSync(p, 'utf8'))).not.toThrow()
})
