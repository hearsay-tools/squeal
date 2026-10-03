// Throwaway: generates fixture50/ with 50 test files x 6 tests and 25 source modules.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
const d = new URL('./fixture50/', import.meta.url).pathname
rmSync(d, { recursive: true, force: true }); mkdirSync(d + 'src', { recursive: true }); mkdirSync(d + 'test')
writeFileSync(d + 'package.json', '{"type":"module","private":true}')
writeFileSync(d + 'vitest.config.ts', "import { defineConfig } from 'vitest/config'\nexport default defineConfig({ test: { include: ['test/**/*.test.ts'] } })\n")
for (let i = 0; i < 25; i++) writeFileSync(d + `src/m${i}.ts`, (i > 0 ? `import { f${i - 1} } from './m${i - 1}'\n` : '') + `export const f${i} = (x: number): number => x + 1${i > 0 ? ` + f${i - 1}(0) * 0` : ''}\n`)
for (let t = 0; t < 50; t++) {
  const m = t % 25
  let body = `import { describe, it, expect } from 'vitest'\nimport { f${m} } from '../src/m${m}'\ndescribe('suite ${t}', () => {\n`
  for (let k = 0; k < 6; k++) body += `  it('case ${k}', () => { expect(f${m}(${k})).toBe(${k + 1}) })\n`
  writeFileSync(d + `test/t${t}.test.ts`, body + '})\n')
}
