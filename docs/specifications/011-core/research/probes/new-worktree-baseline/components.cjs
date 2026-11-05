// 011-299 probe (throwaway): class (c) in detail: when the equal-content row was stored, by which worktree, which project.
// Usage: run from the folder that holds stores/cezar/store.sqlite and out/classes{,.cls}.jsonl: node components.cjs
const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync("stores/cezar/store.sqlite",{readOnly:true});
const R=require("fs").readFileSync("out/classes.jsonl","utf8").trim().split("\n").map(JSON.parse);
const C=require("fs").readFileSync("out/classes.cls.jsonl","utf8").trim().split("\n").map(JSON.parse);
const main=db.prepare("select id from worktrees where is_main=1").get().id;
const S={}; const add=(k,s)=>S[k]=(S[k]??0)+s;
R.forEach((r,i)=>{ if(!C[i].c.startsWith("c ")) return; const d=r.ownDirty==="unknown"?"dirty-unknown":"known";
 const ys=r.sameContentY; const hasMain=ys.some(y=>y.wts.includes(main)); const sameTree=r.sameTreeY;
 const gap=Math.min(...ys.map(y=>r.rs-y.at))/3600e3;
 add(`${d} sameTree=${sameTree}`,r.sec); add(`${d} Y from main checkout only=${ys.every(y=>y.wts.every(w=>w===main))}`,r.sec);
 add(`${d} newest equal-content row ${gap<1?"<1h":gap<6?"1-6h":gap<24?"6-24h":">24h"} before`,r.sec);
 add(`${d} project ${r.file.split("\0")[0]}`,r.sec);
});
console.log(Object.entries(S).sort().map(([k,v])=>Math.round(v)+" "+k).join("\n"));
