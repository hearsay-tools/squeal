import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
test('runs after the writer', () => {
  const marker = join(tmpdir(), 'cds-order')
  const seen = existsSync(marker)
  rmSync(marker, { force: true })
  expect(seen).toBe(true)
})
