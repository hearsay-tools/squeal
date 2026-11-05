// 011-299 probe (throwaway): question 2. Main commits in the window that change a hub file; per first baseline, whether
// its base commit on main changed one. Usage: run from the folder with stores/ and out/starts.jsonl: node hubs.cjs
const {DatabaseSync}=require("node:sqlite");const {execFileSync}=require("child_process");
const db=new DatabaseSync("stores/cezar/store.sqlite",{readOnly:true});
const git=(...a)=>execFileSync("git",["-C",process.env.HOME+"/projects/cezar",...a],{encoding:"utf8"}).trim();
const cl=db.prepare("select closure_paths from test_files where project='server'").all().map(r=>JSON.parse(r.closure_paths));
const cnt=new Map(); for(const c of cl) for(const p of c) cnt.set(p,(cnt.get(p)??0)+1);
const hub=new Set([...cnt].filter(([,n])=>n>=0.5*cl.length).map(([p])=>p));
const S=require("fs").readFileSync("out/starts.jsonl","utf8").trim().split("\n").map(JSON.parse);
let a={n:0,sec:0,hub:0,hubsec:0}; const mains=git("rev-list","--first-parent","--since=2026-11-02T16:50Z","--until=2026-11-05T16:50Z","origin/main").split("\n");
let mh=0; for(const c of mains){ const ch=git("diff","--name-only",c+"^",c).split("\n"); if(ch.some(p=>hub.has(p))) mh++; }
console.log(`main commits in window ${mains.length}, changing a hub file ${mh}`);
const g={}; for(const s of S){ if(!s.X0) continue; const b=s.onMain?s.X0:git("merge-base",s.X0,"origin/main"); const ch=git("diff","--name-only",b+"^",b).split("\n"); const h=ch.some(p=>hub.has(p));
 const k=(s.seenTree?"tree seen":"tree never seen")+(s.onMain?", on main":", branch")+", base commit's own diff changes a hub file: "+h; g[k]??={n:0,sec:0}; g[k].n++; g[k].sec+=s.sec; }
for(const [k,v] of Object.entries(g).sort()) console.log(v.n, Math.round(v.sec), k);
