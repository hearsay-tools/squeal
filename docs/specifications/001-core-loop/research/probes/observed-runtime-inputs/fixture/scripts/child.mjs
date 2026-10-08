import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fromLib } from './child-lib.mjs';
const which = process.argv[2] ?? 'other';
readFileSync(new URL(`../data/${which}.txt`, import.meta.url), 'utf8');
if (process.argv[3] === 'grand') spawnSync(process.execPath, [new URL('./grandchild.mjs', import.meta.url).pathname], { stdio: 'inherit', env: {} });
process.stdout.write(String(fromLib));
