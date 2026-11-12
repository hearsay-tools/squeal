import { expect, test } from 'vitest'
import { pickShard } from '../config/sequencer.mjs'
test('pickShard', () => expect(pickShard(['a', 'b', 'c', 'd'], 1, 2)).toEqual(['a', 'c']))
