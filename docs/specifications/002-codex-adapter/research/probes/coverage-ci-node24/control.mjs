// Throwaway control without Squeal. Keep or delete only NODE_V8_COVERAGE.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const tree = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const root = mkdtempSync(join(tree, 'test/fixtures/node-test/.tmp/control-002-42-'));
const results = [];
try {
  writeFileSync(join(root, 'source.ts'), 'export function area(w: number, h: number): number {\n  if (w < 0) return 0;\n  return w * h;\n}\n');
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  for (const hide of [false, true]) {
    const dir = join(root, hide ? 'hide' : 'keep'); mkdirSync(dir);
    writeFileSync(join(root, 'main.mjs'), `${hide ? 'delete process.env.NODE_V8_COVERAGE;' : ''}\nconst {area} = await import('./source.ts');\nconsole.log(area(2,3));\nconst {spawnSync} = await import('node:child_process');\nconsole.log('child coverage variable: '+spawnSync(process.execPath, ['-e','process.stdout.write(String(Boolean(process.env.NODE_V8_COVERAGE)))'], {encoding:'utf8'}).stdout);\n`);
    const stdout = execFileSync(process.execPath, ['--import','tsx',join(root,'main.mjs')],{cwd:tree,env:{...process.env,NODE_V8_COVERAGE:dir},encoding:'utf8'});
    const payloads = readdirSync(dir).map(name=>JSON.parse(readFileSync(join(dir,name),'utf8')));
    const own = payloads.find(p=>p.result.some(s=>s.url.endsWith('/source.ts')));
    const cache = Object.fromEntries(Object.entries(own['source-map-cache']??{}).filter(([url])=>url.endsWith('/source.ts')));
    results.push({hide,stdout,payloadCount:payloads.length,cache,scripts:own.result.filter(s=>s.url.endsWith('/source.ts'))});
  }
  writeFileSync(output,JSON.stringify({node:process.version,execPath:process.execPath,results},null,2)+'\n');
} finally {rmSync(root,{recursive:true,force:true});}
