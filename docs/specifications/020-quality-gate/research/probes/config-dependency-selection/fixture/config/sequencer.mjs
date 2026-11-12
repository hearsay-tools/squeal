import { readFileSync } from 'node:fs'
import { BaseSequencer } from 'vitest/node'
import { order } from './order.mjs'

// Read with fs, not imported: like cezar's test-durations.json.
export const weights = JSON.parse(readFileSync(new URL('./weights.json', import.meta.url), 'utf8'))

export function pickShard(files, index, count) {
  return files.filter((_, i) => i % count === index - 1)
}

export default class Sequencer extends BaseSequencer {
  async shard(files) {
    const { index, count } = this.ctx.config.shard
    return pickShard(files, index, count)
  }
  async sort(files) {
    return [...files].sort((a, b) => order(a.moduleId, b.moduleId))
  }
}
