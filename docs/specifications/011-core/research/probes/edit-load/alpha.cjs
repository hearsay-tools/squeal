// CPU calibration: recorded host-store seconds of the files a probe store's runs ran in a window
const {DatabaseSync}=require("node:sqlite");const probe=new DatabaseSync(process.argv[2],{readOnly:true});const host=new DatabaseSync(process.argv[3],{readOnly:true});
const t0=+process.argv[4],t1=+(process.argv[5]||9e15);
const dur=new Map();for(const r of host.prepare("select c.project p,c.test_path t,sum((select duration_ms from results r where r.check_id=c.id order by recorded_at desc limit 1)) d from checks c group by 1,2").all())dur.set(r.p+"\0"+r.t,(r.d||0)/1000);
let n=0,s=0,miss=0;for(const r of probe.prepare("select test_files from runs where started_at>=? and started_at<?").all(t0,t1))for(const f of JSON.parse(r.test_files)){n++;const d=dur.get(f.project+"\0"+f.path);if(d==null)miss++;else s+=d}
console.log(JSON.stringify({fileRuns:n,recordedSeconds:+s.toFixed(1),missing:miss}))
