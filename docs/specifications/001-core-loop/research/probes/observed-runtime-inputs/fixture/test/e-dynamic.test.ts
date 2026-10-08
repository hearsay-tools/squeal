import { test, expect } from 'vitest';
test('computed import', async () => {
  const name = ['child', 'lib'].join('-');
  const m = await import(`../scripts/${name}.mjs`);
  expect(m.fromLib).toBe(1);
});
