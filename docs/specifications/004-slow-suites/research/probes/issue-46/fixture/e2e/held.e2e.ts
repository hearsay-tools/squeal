import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { it } from 'vitest'

const qa = resolve(import.meta.dirname, '../.qa')

it('uses the shared env for 8 s', async () => {
  const { url } = JSON.parse(readFileSync(resolve(qa, 'env.json'), 'utf8')) as { url: string }
  writeFileSync(resolve(qa, `started-${process.pid}`), url)
  const end = Date.now() + 8_000
  while (Date.now() < end) {
    await fetch(url)
    await new Promise((r) => setTimeout(r, 250))
  }
}, 30_000)
