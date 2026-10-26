import { test, expect } from 'vitest'

test('the fixture server answers', async () => {
  const res = await fetch(`http://127.0.0.1:${process.env.PROBE_PORT}/`)
  expect(await res.text()).toBe('ok')
})
