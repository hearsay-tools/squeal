// Rollup 4: what the host learns when a plugin hook throws, and when it never settles.
import { rollup } from 'rollup';
const virtual = { name: 'virtual', resolveId: (id) => (id === 'entry' ? id : null), load: (id) => (id === 'entry' ? 'export default 1' : null) };
const thrower = { name: 'thrower', transform() { throw new Error('plugin bug'); } };
const hanger = { name: 'hanger', transform() { return new Promise(() => {}); } };
const mode = process.argv[2];
console.log('mode', mode);
try {
  await rollup({ input: 'entry', plugins: [virtual, mode === 'throw' ? thrower : hanger] });
  console.log('build finished');
} catch (e) {
  console.log('caught:', JSON.stringify({ message: e.message, plugin: e.plugin, hook: e.hook, code: e.code }));
}
