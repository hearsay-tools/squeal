// Throwaway HTTP driver; run only as squeal-e2e.
import {spawn} from 'node:child_process';
import {writeFileSync,readFileSync,existsSync} from 'node:fs';
const mode=process.argv[2]||'base';writeFileSync('mode.txt',mode);writeFileSync('probe.jsonl','');
const root=process.cwd();
const server=spawn('opencode',['serve','--port','4198','--hostname','127.0.0.1'],{stdio:['ignore','ignore','ignore']});
const call=async(path,body,method)=>{const r=await fetch('http://127.0.0.1:4198'+path+'?directory='+encodeURIComponent(root),{signal:AbortSignal.timeout(path==='/global/health'?1000:90000),...(body===undefined?{}:{method:method||'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})});if(!r.ok)throw Error(await r.text());return r.status===204?null:r.json()};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try {
 for(let i=0;i<120;i++){try{await call('/global/health');break}catch{await sleep(250)}}
 const session=await call('/session',{});writeFileSync('serve-session.json',JSON.stringify(session));
 if(mode!=='runtime') {
 const pending=call('/session/'+session.id+'/message',{parts:[{type:'text',text:mode==='base'?'Use bash to run printf probe. Then create serve-hello.txt containing hello using the file edit tool. If a tool is denied, reissue once. Reply briefly.':'Use bash to run printf probe, then reply briefly.'}]}).catch(e=>({error:String(e)}));
 if(mode==='hang') {for(let i=0;i<120;i++){if(readFileSync('probe.jsonl','utf8').includes('"kind":"before"'))break;await sleep(250)};await sleep(3000);const t=performance.now();const health=await call('/global/health');const abort=await call('/session/'+session.id+'/abort',{});writeFileSync('serve-result.json',JSON.stringify({health,healthAndAbortMs:performance.now()-t,abort,reply:await pending}));}
 else {const result=await pending;if(mode==='idle')await sleep(7000);const messages=await call('/session/'+session.id+'/message');writeFileSync('serve-result.json',JSON.stringify({result,messages}));}
 } else {writeFileSync('serve-result.json',JSON.stringify({runtime:true}));}
 await call('/session/'+session.id,{},'DELETE');
} finally {if(server.exitCode===null){const done=new Promise(r=>server.on('exit',r));server.kill('SIGTERM');const killer=setTimeout(()=>server.kill('SIGKILL'),5000);await done;clearTimeout(killer);}}
await sleep(3200);
writeFileSync('detached-result.json',JSON.stringify({afterExit:existsSync('detached.txt')?readFileSync('detached.txt','utf8'):null}));
