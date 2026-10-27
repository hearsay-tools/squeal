// Throwaway adaptation of ../selection-tools/structural.mjs to original TypeScript spans.
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const {parse}=createRequire(process.env.PROBE_NODE_MODULES+'/../package.json')('@babel/parser');
export const hash = s => createHash('sha256').update(s).digest('hex');
const canonical = value => {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value)
    .filter(([k])=>!['start','end','loc','extra','leadingComments','trailingComments','innerComments','comments','tokens'].includes(k))
    .map(([k,v])=>[k,canonical(v)]));
  return value;
};
export function structure(code) {
  const ast=parse(code,{sourceType:'module',plugins:['typescript'],errorRecovery:false});
  const skeleton=canonical(ast),bodies=[];
  ast.program.body.forEach((statement,i)=>{
    const fn=statement.type==='ExportNamedDeclaration'?statement.declaration:statement;
    if(fn?.type!=='FunctionDeclaration'||!fn.id||!fn.body)return;
    if(bodies.some(b=>b.name===fn.id.name))throw Error('duplicate declaration');
    bodies.push({name:fn.id.name,start:fn.start,end:fn.end,hash:hash(JSON.stringify(canonical(fn.body)))});
    const destination=statement.type==='ExportNamedDeclaration'?skeleton.program.body[i].declaration:skeleton.program.body[i];
    destination.body='<body>';
  });
  return {skeleton:hash(JSON.stringify(skeleton)),bodies};
}
export function decide(previous,next,records,changes,globalChange) {
  const shapes={};
  for(const path of changes) {
    if (!path.endsWith('.ts') || path.endsWith('.test.ts') || previous[path]===undefined || next[path]===undefined) continue;
    try {
      const before=structure(previous[path]),after=structure(next[path]);
      shapes[path]={before,after,kind:before.skeleton===after.skeleton?'bodies':'module',
        changedBodies:before.bodies.filter(b=>b.hash!==after.bodies.find(n=>n.name===b.name)?.hash)};
    } catch {shapes[path]={kind:'parse-failure'};}
  }
  const file=[],structural=[],reasons={},debt=[];
  for(const r of records) {
    const affected=changes.filter(p=>r.inputs.includes(p));
    if(!globalChange && !r.failure && !affected.length) continue;
    file.push(r.test);
    let reason=globalChange?'environment/config':r.failure?'prior failure':null;
    for(const path of affected) {
      if(reason) break;
      if(path===r.test || path.endsWith('.testkit.ts')) {reason='test or helper changed';break;}
      const s=shapes[path],cov=r.coverage[path];
      if(!s || s.kind!=='bodies') {reason=s?.kind??'whole-input fallback';break;}
      if(!cov || cov.sourceHash!==hash(previous[path])) {reason='missing/stale coverage';break;}
      for(const b of s.changedBodies) {
        const match=cov.functions.filter(f=>f.start===b.start && f.end===b.end);
        if(!match.length || match.some(f=>f.hit)) {reason=match.length?'executed body: '+b.name:'unmapped body: '+b.name;break;}
      }
    }
    if(reason) {structural.push(r.test);reasons[r.test]=reason;}
    else debt.push({test:r.test,state:'stale',reason:'structural omission at changed input key'});
  }
  return {file,structural,reasons,debt,shapes};
}
