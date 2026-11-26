// Throwaway interleaved startup measurement, with no Squeal/store work.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, loadavg } from 'node:os';
import { join } from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'sq-startup-'));
const entry=join(dir,'empty.mjs'); writeFileSync(entry,'if(process.env.SQUEAL_CARRIED_NODE_USE_ENV_PROXY) throw Error("not restored");');
const restore="data:text/javascript,if(process.env.SQUEAL_CARRIED_NODE_USE_ENV_PROXY!==undefined){process.env.NODE_USE_ENV_PROXY=process.env.SQUEAL_CARRIED_NODE_USE_ENV_PROXY;Reflect.deleteProperty(process.env,'SQUEAL_CARRIED_NODE_USE_ENV_PROXY')}";
const samples={bare:[],cache:[],restore:[],proxy:[]};
const before=loadavg();
for(let i=0;i<65;i++) {
 const modes=Object.keys(samples); if(i%2) modes.reverse();
 for(const mode of modes){
  const env={PATH:process.env.PATH,HOME:dir,HTTP_PROXY:'http://127.0.0.1:9',HTTPS_PROXY:'http://127.0.0.1:9'}; const args=[];
  if(mode!=='bare')env.NODE_COMPILE_CACHE=join(dir,'cache');
  if(mode==='proxy')env.NODE_USE_ENV_PROXY='1';
  if(mode==='restore'){env.SQUEAL_CARRIED_NODE_USE_ENV_PROXY='1';args.push('--import',restore);}
  args.push(entry); const start=performance.now();const child=spawnSync(process.execPath,args,{env});const ms=performance.now()-start;
  if(child.status!==0)throw Error(child.stderr.toString());
  if(i>=5)samples[mode].push(ms);
 }
}
const rows=Object.fromEntries(Object.entries(samples).map(([name,times])=>{const s=[...times].sort((a,b)=>a-b);return [name,{p50:s[30],p95:s[56],max:s[59],samples:times}]}));
console.log(JSON.stringify({node:process.version,proxyEndpoint:'http://127.0.0.1:9 (no requests)',before,after:loadavg(),rows},null,2));rmSync(dir,{recursive:true,force:true});
