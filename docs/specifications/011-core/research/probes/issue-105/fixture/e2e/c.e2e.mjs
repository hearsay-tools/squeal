import { readFileSync } from 'node:fs'
import { test, expect } from 'vitest'

// A spec that reads the build mirror itself (cezarion's specs reach it only through the server).
test('the build mirror holds the app', () => {
  expect(readFileSync('.ai/qa/build/out.txt', 'utf8')).toMatch(/^app/)
})
