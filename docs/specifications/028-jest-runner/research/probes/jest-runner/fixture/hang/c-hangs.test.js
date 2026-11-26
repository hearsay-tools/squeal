test('first case done', () => {});
test('hangs', () => new Promise(() => { require('fs').writeFileSync(process.env.HANG_MARK, 'x'); setInterval(() => {}, 1000); }), 600000);
