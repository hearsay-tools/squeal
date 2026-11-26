const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
jest.mock('../src/mocked');
const a = require('../src/a');
const { util } = require('@lib/util');
require('../src/style.css');
const conf = require('../data/conf.json');
const mocked = require('../src/mocked');

test('static, mapped, mocked, css, json', () => {
  expect(a.fromC).toBe('c');
  expect(util).toBe('lib');
  expect(mocked.real).toBe(false);
  expect(conf.k).toBe(1);
});
test('computed require', () => {
  const name = ['d', 'y', 'n'].join('');
  expect(require(path.join(__dirname, '..', 'src', name)).dyn).toBe('computed');
});
test('fs and child process', () => {
  expect(fs.readFileSync(path.join(__dirname, '..', 'data', 'fixture.txt'), 'utf8')).toMatch('fixture');
  expect(fs.readdirSync(path.join(__dirname, '..', 'data')).length).toBeGreaterThan(0);
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'data', 'child.js')]);
  expect(r.status).toBe(0);
});
test('snapshot', () => {
  expect({ a: a.fromA }).toMatchSnapshot();
});
