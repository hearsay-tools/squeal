/**
 * @jest-environment jsdom
 */
const a = require('../src/a');
test('same imports as one.test, jsdom', () => {
  expect(a.fromA).toBe('a');
  expect(typeof document).toBe('object');
});
