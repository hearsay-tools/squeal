// Throwaway probe for research 011-53: does V8 in Node v24.21.0 give freed heap pages back? Run: node --expose-gc [flags] ns.cjs
const v8=require("v8"),fs=require("fs");
const priv=()=>{const s=fs.readFileSync("/proc/self/status","utf8");const k=n=>+(new RegExp(n+":\\s+(\\d+)").exec(s)[1]);return Math.round((k("RssAnon"))/1024)};
const ns=()=>{const s=v8.getHeapSpaceStatistics().find(s=>s.space_name=="new_space");return s.space_size/2**20};
const p=(l)=>console.log(l.padEnd(10),"priv",priv(),"newspace",ns(),"heapTotal",Math.round(process.memoryUsage().heapTotal/2**20));
p("start");let keep=[];for(let i=0;i<3e6;i++){keep.push({i,s:"x"+i}); if(keep.length>2e5) keep=[];} keep=null;
p("churned"); gc(); p("gc"); setTimeout(()=>{p("gc+10s"); gc(); p("gc2"); setTimeout(()=>p("gc2+10s"),10000)},10000);
