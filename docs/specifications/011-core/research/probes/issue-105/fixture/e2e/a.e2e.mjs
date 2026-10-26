import { readFileSync } from 'node:fs'
import { test, expect } from 'vitest'

// Like packages/web/e2e/agent-browser.ts: a spec reads the descriptor in its worker.
test('the descriptor names a running app', () => {
  const d = JSON.parse(readFileSync('.ai/qa/test-env.json', 'utf8'))
  expect(d.status).toBe('running')
})
