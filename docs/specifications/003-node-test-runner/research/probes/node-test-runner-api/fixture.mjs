import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
export function fixture(root) {
  function put(file, source) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }
  put('package.json', JSON.stringify({ private: true, type: 'module', workspaces: ['packages/*'] }));
  put('scripts/preload.mjs', `globalThis.probePreload = 'loaded'; process.env.PROBE_PRELOAD = 'loaded';\n`);
  put('scripts/require.cjs', `globalThis.probeRequire = 'loaded';\n`);
  put('packages/demo/package.json', JSON.stringify({name:'demo',type:'module', scripts: {
    'test:unit': 'node --import ../../scripts/preload.mjs --import tsx --test test/unit/*.test.ts',
    'test:package': 'node --import ../../scripts/preload.mjs --import tsx --test test/e2e/*.test.ts',
  }}));
  put('packages/demo/src/value.ts', 'export const value: number = 1;\n');
  put('packages/demo/src/legacy.cjs', 'module.exports = { value: 7 };\n');
  put('packages/demo/test/unit/events.test.ts', `import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import legacy from '../../src/legacy.cjs';
console.log('module-evaluated');
console.log(JSON.stringify({ node: process.version, execPath: process.execPath, execArgv: process.execArgv, cwd: process.cwd(), preload: globalThis.probePreload, required: globalThis.probeRequire, marker: process.env.PROBE_ENV }));
console.error('fixture-stderr');
describe('outer', () => {
  it('pass', t => { assert.equal(legacy.value, 7); assert.equal(globalThis.probePreload, 'loaded'); t.diagnostic('hello'); });
  it('failure', () => { assert.equal(1, 2); });
  it.skip('skip', () => { throw Error('must not run'); });
  it.todo('todo');
  for (const name of ['a', 'b']) it('loop ' + name, () => {});
  it('duplicate', () => {});
  it('duplicate', () => {});
  it('duplicate', () => {});
});
test('parent', async t => { await t.test('child', () => {}); });
test('only target', { only: true }, () => {});
`);
  put('packages/demo/test/e2e/smoke.test.ts', `import { test } from 'node:test'; import assert from 'node:assert/strict'; test('e2e', () => assert.equal(globalThis.probePreload, 'loaded'));\n`);
  put('packages/demo/cases/import.test.ts', `import './missing.ts';\n`);
  put('packages/demo/cases/syntax.test.ts', `import { test } from 'node:test'; const broken: = ;\n`);
  put('packages/demo/cases/hang.test.ts', `import { test } from 'node:test'; test('hang', async () => { setInterval(() => {}, 1000); await new Promise(() => {}); });\n`);
  put('packages/demo/cases/block.test.ts', `import { test } from 'node:test'; test('block', () => { while (true) {} });\n`);
  put('packages/demo/cases/snapshot.test.ts', `import { test } from 'node:test'; test('snap', t => t.assert.snapshot({ value: 42 }));\n`);
  put('packages/demo/cases/enum.test.ts', `import { test } from 'node:test'; import assert from 'node:assert/strict'; enum Color { Red, Blue }; test('enum', () => assert.equal(Color.Blue, 1));\n`);
  put('packages/demo/cases/repeat.test.ts', `import { test } from 'node:test'; import { value } from '../src/value.ts'; test('value ' + value, () => {});\n`);
  put('packages/demo/cases/empty.test.ts', `console.log('empty module evaluated');\n`);
  for (let i = 0; i < 20; i++) put(`packages/demo/bench/${i}.test.ts`, `import { test } from 'node:test'; import assert from 'node:assert/strict'; import { value } from '../src/value.ts'; test('file ${i}', () => { assert.equal(value, 1); assert.equal(globalThis.probePreload, 'loaded'); });\n`);
}
