import { defineConfig } from 'vitest/config'
import Sequencer from './config/sequencer.mjs'
import Reporter from './config/reporter.mjs'
import { flag } from './config/define-value.mjs'
import marker from './config/plugin.mjs'
import './config/side-effect.mjs'
import data from './config/imported.json' with { type: 'json' }

export default defineConfig({
  plugins: [marker()],
  define: { __FLAG__: JSON.stringify(flag), __DATA__: JSON.stringify(data.value) },
  test: {
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    sequence: { sequencer: Sequencer },
    reporters: ['default', new Reporter(), './config/string-reporter.mjs'],
  },
})
