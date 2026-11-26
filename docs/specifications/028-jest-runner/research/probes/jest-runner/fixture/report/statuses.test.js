describe('outer', () => {
  describe('inner', () => {
    test('passes', () => expect(1).toBe(1));
    test('fails', () => expect(1).toBe(2));
  });
  test.skip('skipped', () => {});
  test.todo('todo');
  test.each([[1, 2], [2, 3]])('each %i -> %i', (a, b) => expect(a + 1).toBe(b));
  test('dup', () => {});
  test('dup', () => {});
  test.failing('failing that fails', () => expect(1).toBe(2));
});
describe.skip('skipped block', () => {
  test('in skipped block', () => {});
});
test('top level', () => {
  console.error('console from test');
});
