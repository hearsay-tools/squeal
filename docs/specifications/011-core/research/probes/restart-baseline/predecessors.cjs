// 011-298 probe (throwaway): for class 1 (the predecessor listed the file and stored nothing), the predecessor daemon's life,
// its baseline end state, whether it ran anything, and the gap from its last run to the restart.
// Usage: node predecessors.cjs <store copy> <classify output.jsonl>
const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.argv[2],{readOnly:true});
const L=require("fs").readFileSync(process.argv[3],"utf8").trim().split("\n").map(JSON.parse);
const cks=db.prepare("select id,worktree_id,revision,test_files,started_at,completed_at,end_state from checkpoints where kind='baseline' order by started_at").all();
const prevOf=new Map(),last=new Map();for(const c of cks){c.set=new Set(JSON.parse(c.test_files).map(f=>f.project+"\0"+f.path));prevOf.set(c.id,last.get(c.worktree_id)??null);last.set(c.worktree_id,c);}
const runsIn=db.prepare("select count(*) n, sum(json_array_length(test_files)) f, max(ended_at) e, min(started_at) s from runs where worktree_id=? and started_at>=? and started_at<?");
const ckRuns=db.prepare("select count(*) n,min(started_at) s from runs where checkpoint_id=?");
const B=new Map();
for(const x of L){if(!x.ran)continue;const p=prevOf.get(x.ck);const own=x.prior&&x.prior.inPrev&&x.prior.completed&&x.prior.keys.length;if(!p.set.has(x.file)||own)continue;
 let b=B.get(x.ck);if(!b){const r=runsIn.get(x.W,p.started_at,x.T);const pr=ckRuns.get(p.id);b={sec:0,n:0,life:(x.T-p.started_at)/60e3,pEnd:p.end_state,pDone:p.completed_at?(p.completed_at-p.started_at)/60e3:null,pRuns:r.n,pFiles:r.f??0,pCkRuns:pr.n,pFirst:pr.s?(pr.s-p.started_at)/60e3:null,lastEnd:r.e?(x.T-r.e)/60e3:null,listed:p.set.size};B.set(x.ck,b);}b.sec+=x.sec;b.n++;}
const arr=[...B.values()];const tot=arr.reduce((s,b)=>s+b.sec,0);
const bucket=(v,cuts)=>{for(const c of cuts)if(v<c)return "<"+c;return ">="+cuts.at(-1);};
const agg=(f)=>{const g={};for(const b of arr){const k=f(b);g[k]??={n:0,s:0};g[k].n++;g[k].s+=b.sec;}return Object.entries(g).sort().map(([k,v])=>`${k}: ${v.n} restarts, ${Math.round(v.s)} s (${(100*v.s/tot).toFixed(0)}%)`).join("\n  ");};
console.log("restarts",arr.length,"sec",Math.round(tot));
console.log("predecessor life (min):\n  "+agg(b=>bucket(b.life,[1,5,15,60,240])));
console.log("predecessor baseline end:\n  "+agg(b=>b.pEnd??"open"));
console.log("predecessor baseline runs:\n  "+agg(b=>b.pCkRuns===0?"none":"some"));
console.log("predecessor runs of any kind:\n  "+agg(b=>b.pRuns===0?"none":"some"));
console.log("gap from predecessor's last run end to restart (min):\n  "+agg(b=>b.lastEnd===null?"no run":bucket(b.lastEnd,[1,5,15,60,240])));
