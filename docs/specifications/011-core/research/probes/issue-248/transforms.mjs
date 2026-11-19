// Throwaway transform comparison; no test suite and no source mutations.
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const viteEntry = require.resolve('vite', { paths: [require.resolve('vitest')] });
const { transformWithOxc } = await import(pathToFileURL(viteEntry).href);
const base = '// original note\nexport type Shape = { x: number };\nexport const value = 1;\n';
for (const [name, before, after] of [
 ['type', base, base.replace('x: number', 'x: string')],
 ['type-length', base, base.replace('x: number', 'x: unknown')],
 ['comment', base, base.replace('original note', 'changed note')],
 ['behavior', base, base.replace('value = 1', 'value = 2')],
 ['function-comment', 'export function f() { /* original */ return 1; }', 'export function f() { /* changed */ return 1; }'],
]) {
 const a = await transformWithOxc(before, 'lib.ts');
 const b = await transformWithOxc(after, 'lib.ts');
 console.log(JSON.stringify({ name, node: process.version, vite: '8.3.2', oxcCodeEqual: a.code === b.code,
   mappingsEqual: a.map.mappings === b.map.mappings,
   nodeStripEqual: stripTypeScriptTypes(before) === stripTypeScriptTypes(after), beforeCode: a.code, afterCode: b.code }));
}
