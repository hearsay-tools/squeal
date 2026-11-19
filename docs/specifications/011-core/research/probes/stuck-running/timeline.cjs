const L=require("fs").readFileSync(process.argv[2],"utf8").trim().split("\n").map(JSON.parse);
for(const l of L){ if(l.error){console.log(l.t,l.error);continue}; const ws=l.worktrees.map(w=>`${w.root}:rev${w.revision}/ref${w.refined}/hb${w.heartbeatAgeMs}`).join(" ");
 console.log(l.t.slice(11,19), "load",l.load[0], ws, "open",l.open.map(o=>`${o.w}:${o.files}f/${Math.round(o.ageMs/1000)}s`).join(","), "pend",JSON.stringify(l.pending), "ended",l.ended.length+"x", l.ended.filter(e=>e.end!=="completed"||e.ms>5000).map(e=>e.w+":"+e.files+"f/"+e.ms+"ms/"+e.end).join(" ").slice(0,300))}
