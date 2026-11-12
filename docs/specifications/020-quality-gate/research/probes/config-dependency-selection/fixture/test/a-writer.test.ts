import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'
test('writes the order marker', () => writeFileSync(join(tmpdir(), 'cds-order'), 'x'))
