import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { name: 'server', include: ['source.test.ts'] } })
