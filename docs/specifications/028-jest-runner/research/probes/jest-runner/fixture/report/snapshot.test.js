test('snap mismatch', () => expect({ v: 2 }).toMatchSnapshot());
test('snap new', () => expect({ v: 'new' }).toMatchSnapshot());
