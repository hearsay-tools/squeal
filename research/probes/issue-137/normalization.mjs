// Throwaway: byte edits which a blanket normalizer must not call equivalent.
import assert from 'node:assert/strict';
import { transformSync, version } from 'esbuild';
import { runInNewContext } from 'node:vm';
const compile = (source) => transformSync(source, { loader: 'ts', format: 'cjs', treeShaking: true }).code;
console.log(JSON.stringify({ node: process.version, esbuild: version }));
for (const [name, a, b] of [
  ['literal whitespace', 'module.exports = "a b";', 'module.exports = "ab";'],
  ['comment-shaped literal', 'module.exports = "/* first */";', 'module.exports = "/* second */";'],
  ['return newline', 'function f() { return 1; } module.exports = f();', 'function f() { return\n1; } module.exports = f();'],
]) {
  const execute = (source) => { const context = { module: { exports: {} } }; runInNewContext(compile(source), context); return context.module.exports; };
  const left = execute(a), right = execute(b);
  assert.notEqual(left, right);
  console.log(JSON.stringify({ name, a, b, left: String(left), right: String(right), emittedEqual: compile(a) === compile(b) }));
}
const a = 'const unused = /* @__PURE__ */ effect(); export {};';
const b = 'const unused = /* ordinary */ effect(); export {};';
assert.notEqual(compile(a), compile(b));
assert.equal(compile(a).includes('effect()'), false);
assert.equal(compile(b).includes('effect()'), true);
console.log(JSON.stringify({ name: 'pure directive', a, b, pureCallsEffect: false, ordinaryCallsEffect: true }));
