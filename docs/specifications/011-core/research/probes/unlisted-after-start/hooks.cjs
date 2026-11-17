// For one run log: every hook item with its status and the first line of its Squeal text.
const fs=require("fs");const [file,from,to]=process.argv.slice(2);
const lines=fs.readFileSync(file,"utf8").split("\n").filter(Boolean);
for(const l of lines){const o=JSON.parse(l);if(o.type!=="item.completed"||!o.item||o.item.kind!=="hook")continue;
 if(from&&o.ts<from)continue;if(to&&o.ts>to)continue;
 let t=(o.item.entries||[]).map(e=>e.text||"").join(" ");
 if(!t&&o.item.stdout){try{t=JSON.parse(o.item.stdout).hookSpecificOutput?.additionalContext||""}catch{t="(stdout)"}}
 console.log(o.ts.slice(11,19),o.item.event,o.item.status,o.item.exitCode??"",t.split("\n")[0].slice(0,110))}
