// ESLint 10: who is named when a plugin rule crashes, and what of the plugin enters the serialized config.
import { ESLint } from 'eslint';
import x from './plugin-x.mjs';
import y from './plugin-nometa.mjs';
const overrideConfig = [{ files: ['**/*.js'], plugins: { x, y }, rules: { 'x/boom': 'error', 'y/quiet': 'error', 'no-unused-vars': 'error' } }];
const eslint = new ESLint({ overrideConfigFile: true, overrideConfig, cwd: process.cwd() });
console.log('eslint', ESLint.version);
const cfg = await eslint.calculateConfigForFile('a.js');
console.log('serialized plugins:', JSON.stringify(JSON.parse(JSON.stringify(cfg)).plugins));
try {
  const r = await eslint.lintText('const fine = 1;\nconst boom = 2;\n', { filePath: 'a.js' });
  console.log('lint returned', r[0].messages.length, 'messages');
} catch (e) {
  console.log('lintText threw; message:\n' + e.message.split('\n').map((l) => '  ' + l).join('\n'));
}
const ok = await eslint.lintText('const fine = 1;\n', { filePath: 'b.js' });
console.log('a file without boom still lints:', ok[0].messages.map((m) => m.ruleId));
