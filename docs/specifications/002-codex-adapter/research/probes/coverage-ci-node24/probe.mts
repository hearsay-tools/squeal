// Throwaway read-only product probe. Each invocation creates and removes its own fixture.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const tree = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const mode = process.argv[4] ?? 'adapter';
const load = (p: string) => import(pathToFileURL(join(tree, p)).href);
const { createNodeTestAdapter } = await load('src/runners/node-test/adapter.ts');
const { ownRecord } = await load('src/core/code/coverage/own.ts');
const { countFile } = await load('src/core/code/count/index.ts');
const { joinCoverage } = await load('src/core/code/crap/join.ts');
const { blobHash } = await load('src/core/hash/index.ts');
const parent = join(tree, 'test/fixtures/node-test/.tmp');
mkdirSync(parent, { recursive: true });
const root = mkdtempSync(join(parent, 'research-002-42-'));
const shapes = 'export function area(w: number, h: number): number {\n  if (w < 0) {\n    return 0;\n  }\n  return w * h;\n}\n\nexport function neverCalled(): string {\n  return "no";\n}\n';
const ran = 'export function called(x: number): number {\n  return x + 1;\n}\nexport function unused(): number {\n  return 0;\n}\n';
const replacement = 'export const nowEdited = 1;\n';
let adapter;
try {
  mkdirSync(join(root, 'src')); mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
  writeFileSync(join(root, 'src/shapes.ts'), shapes);
  writeFileSync(join(root, 'src/edited.ts'), ran);
  writeFileSync(join(root, 'test/main.test.ts'), 'import {test} from "node:test";\nimport {area} from "../src/shapes.ts";\nimport {called} from "../src/edited.ts";\ntest("calls", () => { area(2, 3); called(1); });\n');
  const runs: any[] = []; // Raw research capture, outside the product.
  const notes: string[] = [];
  const argv = mode === 'source-maps' ? ['--enable-source-maps', '--import', 'tsx'] : ['--import', 'tsx'];
  adapter = await createNodeTestAdapter({ name: 'unit', node: process.execPath, argv, env: {}, include: ['test/*.test.ts'] }, {
    root, tempDir: join(root, 'temp'), note: (s: string) => notes.push(s), coverage: { enabled: () => true, collected: (r: any) => runs.push(r) },
  });
  await adapter.environment();
  const report = await adapter.run([{project:'unit',path:'test/main.test.ts'}], { runId:'probe', logDir:join(root,'logs'), timeoutMs:60000 });
  await adapter.close(); adapter = null;
  const payload = JSON.parse(readFileSync(runs[0].files[0].payload, 'utf8'));
  const before = ownRecord(root, payload, 'sha1');
  writeFileSync(join(root, 'src/edited.ts'), replacement);
  const after = ownRecord(root, payload, 'sha1');
  // Counterfactual payload only: decode the inline bytes Node kept, never edit product code.
  const hydrated = structuredClone(payload);
  for (const entry of Object.values(hydrated['source-map-cache'] ?? {}) as any[]) {
    if (entry.data === null && entry.url?.startsWith('data:application/json;base64,')) {
      entry.data = JSON.parse(Buffer.from(entry.url.split(',')[1], 'base64').toString('utf8'));
    }
  }
  const fromInline = ownRecord(root, hydrated, 'sha1');
  const missingText = structuredClone(hydrated);
  for (const entry of Object.values(missingText['source-map-cache'] ?? {}) as any[]) {
    if (entry.data) entry.data.sourcesContent = [null];
  }
  const withoutText = ownRecord(root, missingText, 'sha1');
  const mapVariants = {};
  for (const [label, url] of [['missing', undefined], ['malformed', 'data:application/json;base64,bm90IGpzb24=']]) {
    const variant = structuredClone(payload);
    for (const entry of Object.values(variant['source-map-cache'] ?? {}) as any[]) {
      entry.data = null; entry.url = url;
    }
    mapVariants[label] = ownRecord(root, variant, 'sha1');
  }
  const { functions } = await countFile(shapes, 'typescript');
  const inlineShape = fromInline.sources.find((s: any) => s.path === 'src/shapes.ts');
  const inlineJoined = joinCoverage(functions, inlineShape ? [inlineShape] : []);
  const shapeRecord = before.sources.find((s: any) => s.path === 'src/shapes.ts');
  const joined = joinCoverage(functions, shapeRecord ? [shapeRecord] : []);
  const relevant = payload.result.filter((s: any) => s.url.startsWith(pathToFileURL(root).href));
  const cache = Object.fromEntries(Object.entries(payload['source-map-cache'] ?? {}).filter(([url]) => url.startsWith(pathToFileURL(root).href)));
  writeFileSync(output, JSON.stringify({node:process.version,execPath:process.execPath,commit:execFileSync('git',['rev-parse','HEAD'],{cwd:tree,encoding:'utf8'}).trim(),mode,notes,outcomes:report.results.map((r:any)=>r.outcome),source:{shapes,ran,replacement},blobs:{shapes:blobHash(Buffer.from(shapes),'sha1'),ran:blobHash(Buffer.from(ran),'sha1'),replacement:blobHash(Buffer.from(replacement),'sha1')},states:functions.map((f:any,i:number)=>[f.qualifiedName,joined[i]?.ran,joined[i]?.covered,joined[i]?.lines]),before,after,mapVariants,fromInline,withoutText,inlineStates:functions.map((f:any,i:number)=>[f.qualifiedName,inlineJoined[i]?.ran,inlineJoined[i]?.covered,inlineJoined[i]?.lines]),scripts:relevant,cache,allCacheKeys:Object.keys(payload['source-map-cache']??{})}, null, 2)+'\n');
} finally { if(adapter) await adapter.close(); rmSync(root,{recursive:true,force:true}); }
