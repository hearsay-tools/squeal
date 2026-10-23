// runs of a probe store after <t0 ms>: files, ended files, sum of reported file durations, wall
const {DatabaseSync}=require("node:sqlite");const fs=require("fs");const db=new DatabaseSync(process.argv[2],{readOnly:true});
const t0=+process.argv[3], t1=+(process.argv[4]||9e15);let F=0,E=0,S=0,runs=0;const sizes=[];
for(const r of db.prepare("select * from runs where started_at>=? and started_at<?").all(t0,t1)){runs++;const n=JSON.parse(r.test_files).length;F+=n;sizes.push(n);
try{const rep=JSON.parse(fs.readFileSync(r.log_dir+"/report.json","utf8")).report;for(const d of Object.values(rep.fileDurations)){E++;S+=d.durationMs/1000}}catch{}}
console.log(JSON.stringify({runs,files:F,ended:E,sumFileSeconds:+S.toFixed(1),tierSizes:sizes.join(",")}))
