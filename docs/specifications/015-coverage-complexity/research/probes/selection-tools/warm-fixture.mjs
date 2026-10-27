// Ordinary shared utility module plus isolated hazards. No artificial busy loop.
export const source = `export const TAX = 2;
export function shipping(weight) {
  if (weight > 20) return 100;
  return weight * 3;
}
export function tax(amount) { return amount * TAX; }
export function discount(amount) { return amount / 10; }
export function label(value) { return value.toUpperCase(); }
export function cents(amount) { return Math.round(amount * 100); }
export function available(stock) { return stock > 0; }
export function total(items) { return items.reduce((a, b) => a + b, 0); }
export function currency() { return 'USD'; }
export function unused(x) { return 'old'; }
`;
const assertions = [
  ['shipping', '[[2,6],[3,9],[4,12]]'], ['tax','[[10,20],[20,40],[30,60]]'],
  ['discount','[[100,10],[200,20],[300,30]]'], ['label', `[['box','BOX'],['bag','BAG'],['item','ITEM']]`],
  ['cents','[[1.5,150],[2,200],[3,300]]'], ['available','[[2,true],[1,true],[0,false]]'],
  ['total','[[[1,2],3],[[4,5],9],[[],0]]'], ['currency', `[[null,'USD'],[null,'USD'],[null,'USD']]`],
];
export function files(extra = '') {
  const out = { 'rates.mjs': source, 'rate.txt': 'old', 'gate.mjs': 'export const enabled = false;\n' };
  assertions.forEach(([name, data], i) => {
    out[`unit-${i}.test.mjs`] = `import { test, expect } from 'vitest';\nimport { ${name} } from './rates.mjs';\nimport { threadId } from 'node:worker_threads';\nconsole.log('WORKER '+JSON.stringify({pid:process.pid,threadId}));\ntest.each(${data})('${name} %j', (value, wanted) => expect(${name}(value)).toEqual(wanted));\n`;
  });
  if (extra) out['hazard.test.mjs'] = `import { test, expect } from 'vitest';\nimport * as rates from './rates.mjs';\n${extra}\n`;
  return out;
}
export const cases = [
  { name: 'body-refactor', code: source.replace('return weight * 3;', 'const rate = 3;\n  return weight * rate;') },
  { name: 'body-regression', code: source.replace('return weight * 3;', 'return weight * 4;') },
  { name: 'insert-branch', code: source.replace('  if (weight > 20)', '  if (weight === 2) return 0;\n  if (weight > 20)') },
  { name: 'module-value', code: source.replace('TAX = 2', 'TAX = 3') },
  { name: 'signature', code: source.replace('unused(x)', 'unused(x,y)'), extra: `test('arity', () => expect(rates.unused.length).toBe(1));` },
  { name: 'reflection', code: source.replace("return 'old'", "return 'new'"), extra: `test('text', () => expect(rates.unused.toString()).toContain("'old'"));` },
  { name: 'data', code: source, extra: `import { readFileSync } from 'node:fs';\ntest('data', () => expect(readFileSync(new URL('./rate.txt', import.meta.url),'utf8')).toBe('old'));`, change: { 'rate.txt': 'new' } },
  { name: 'raw-source-read', code: source.replace("return 'old'", "return 'new'"), extra: `import { readFileSync } from 'node:fs';\ntest('source text', () => expect(readFileSync(new URL('./rates.mjs', import.meta.url),'utf8')).toContain("return 'old'"));` },
  { name: 'child', code: source.replace("return 'old'", "return 'new'"), extra: `import { execFileSync } from 'node:child_process';\ntest('child', () => expect(execFileSync(process.execPath,['--input-type=module','-e',"import {unused} from './rates.mjs'; console.log(unused(1))"], {cwd:new URL('.',import.meta.url),encoding:'utf8'}).trim()).toBe('old'));` },
  { name: 'stale-dependency', code: source.replace("return 'old'", "return 'new'"), extra: `import { enabled } from './gate.mjs';\ntest('gate', () => expect(enabled ? rates.unused(1) : 'old').toBe('old'));`, change: { 'gate.mjs': 'export const enabled = true;\n' } },
  { name: 'stale-evidence', code: source.replace('return weight * 3;', 'return weight * 4;'), corrupt: true },
  { name: 'syntax', code: source.replace("return 'old';", 'return (;') },
];
for (let i = 1; i <= 4; i++) cases.push({ ...cases[0], name: `body-refactor-repeat-${i}` });

cases.push({ name: 'independent-tax-refactor', code: source.replace('return amount * TAX;', 'return TAX * amount;') });
cases.push({ name: 'independent-label-regression', code: source.replace('value.toUpperCase()', 'value.toLowerCase()') });
