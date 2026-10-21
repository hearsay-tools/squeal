// Throwaway probe for research 011-53: does V8 in Node v24.21.0 give freed heap pages back? Run: node --expose-gc [flags] ns2.cjs
const v8=require("v8"),fs=require("fs");
const split=()=>{const o={h256:0,heap:0,other:0,file:0};let cur;for(const l of fs.readFileSync("/proc/self/smaps","utf8").split("\n")){const m=/^([0-9a-f]+)-([0-9a-f]+) \S+ \S+ \S+ (\d+)\s*(.*)$/.exec(l);if(m){const sz=parseInt(m[2],16)-parseInt(m[1],16);const n=m[4].trim();cur=m[3]!=="0"&&n.startsWith("/")?"file":n==="[heap]"?"heap":n===""&&sz===262144?"h256":"other"}else if(l.startsWith("Rss:"))o[cur]+=+l.split(/\s+/)[1]}for(const k in o)o[k]=Math.round(o[k]/1024);return o};
const p=(l)=>console.log(l.padEnd(10),JSON.stringify(split()),"heapTotal",Math.round(process.memoryUsage().heapTotal/2**20));
p("start");let keep=[];for(let i=0;i<3e6;i++){keep.push({i,s:"x"+i}); if(keep.length>2e5) keep=[];} keep=null;
p("churned"); gc(); gc(); p("gc x2"); for (const s of [30,60,90]) setTimeout(()=>p("gc+"+s+"s"),s*1000);
