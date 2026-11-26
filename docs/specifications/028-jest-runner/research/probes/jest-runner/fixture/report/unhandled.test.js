test('unhandled rejection after test body', async () => {
  Promise.reject(new Error('unhandled'));
  await new Promise((r) => setTimeout(r, 20));
});
test('next test', () => {});
