// Throwaway probe for research 011-53: does V8 in Node v24.21.0 give freed heap pages back? Run: node --expose-gc [flags] ns3.cjs
const fs=require("fs");
const priv=()=>{const s=fs.readFileSync("/proc/self/status","utf8");return Math.round(+/RssAnon:\s+(\d+)/.exec(s)[1]/1024)};
const r={start:priv()};let keep=[];for(let i=0;i<3e6;i++){keep.push({i,s:"x"+i}); if(keep.length>2e5) keep=[];} keep=null;
r.churned=priv(); gc(); gc(); r.gc2=priv(); r.heapTotal=Math.round(process.memoryUsage().heapTotal/2**20);
setTimeout(()=>{r.after10s=priv();console.log((process.execArgv.filter(a=>a!=="--expose-gc").join(" ")||"default").padEnd(32),JSON.stringify(r))},10000);
