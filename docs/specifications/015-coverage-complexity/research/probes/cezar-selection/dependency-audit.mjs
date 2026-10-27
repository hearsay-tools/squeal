// Compare the pinned tools' complete lockfile dependency graphs across retained parents.
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const {parseAllDocuments}=createRequire(process.argv[2]+'/structural/node_modules/.pnpm/node_modules/probe.cjs')('yaml');
import {createHash} from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url));
const inputs=JSON.parse(gunzipSync(readFileSync(join(here,'inputs.json.gz'))));
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
function graph(text){
 const lock=Object.assign({},...parseAllDocuments(text).map(d=>d.toJSON())),found={};
 const roots={vitest:lock.importers['.'].devDependencies.vitest.version,'@babel/parser':lock.importers['.'].devDependencies['@babel/parser'].version,zod:lock.importers['packages/contract'].dependencies.zod.version};
 function visit(name,version){
   const key=name+'@'+version;if(key in found)return;
   const snap=lock.snapshots[key];if(!snap)throw Error('Missing snapshot '+key);
   const pkg=lock.packages[key]??lock.packages[key.split('(')[0]];
   found[key]={snapshot:snap,package:pkg};
   for(const [n,v]of Object.entries({...snap.dependencies,...snap.optionalDependencies}))visit(n,v);
 }
 for(const [n,v]of Object.entries(roots))visit(n,v);
 return {roots,nodes:Object.keys(found).length,sha256:createHash('sha256').update(JSON.stringify(stable(found))).digest('hex')};
}
const rows=inputs.map(r=>({commit:r.commit,parent:r.parent,previous:graph(r.previous['pnpm-lock.yaml']),next:graph(r.next['pnpm-lock.yaml'])}));
const reference=rows[0].next.sha256;
const installed=graph(readFileSync(process.argv[2]+'/structural/node_modules/.pnpm/lock.yaml','utf8'));
if(installed.sha256!==reference)throw Error('Installed dependency graph differs from historical graphs');
writeFileSync(join(here,'dependency-audit.json'),JSON.stringify({reference,installed,allMatch:rows.every(r=>r.previous.sha256===reference&&r.next.sha256===reference),rows},null,2)+'\n');
console.log(JSON.stringify({allMatch:rows.every(r=>r.previous.sha256===reference&&r.next.sha256===reference),graphs:rows.length*2,nodes:rows[0].next.nodes}));
