// 019-46 probe (throwaway): seconds that kept no result, by cause bucket and by run shape (split.mjs fateByShape).
const j=JSON.parse(require("fs").readFileSync(process.argv[2])); const tot=j.total;
const bucket=(k)=>k==="stored"?null:/timeoutMs/.test(k)?"timed out":/edit arrived during a backlog/.test(k)?"cancelled by an edit (backlog tier)":/yielded/.test(k)?"yielded":/changed an input/.test(k)?"inputs changed during the run":/squeal stop|squeal hold/.test(k)?"squeal stop or hold":/executed bytes/.test(k)?"unkeyed bytes":/^ended-not-stored:completed/.test(k)?"ended, discarded or replaced at the same key":"other ("+k.slice(0,50)+")";
const o={}; for (const [k,v] of Object.entries(j.fateByShape)){const b=bucket(k); if(!b) continue; for (const [s,sec] of Object.entries(v)){o[b]??={total:0}; o[b].total+=sec; o[b][s]=(o[b][s]??0)+sec}}
let ns=0; for (const v of Object.values(o)) ns+=v.total; console.log("notStored",ns,(100*ns/tot).toFixed(1)+"% of",tot);
for (const [b,v] of Object.entries(o).sort((a,b)=>b[1].total-a[1].total)) console.log((100*v.total/tot).toFixed(1)+"%", b, JSON.stringify(v));
