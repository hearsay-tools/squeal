#!/bin/sh
# per-edit summary: label, wall to idle, CPU total, daemon CPU, tests CPU, runs and files in [t0, next t0)
STORE=$1; shift
for L in "$@"; do f=/tmp/el143/logs/edit-$L.jsonl
node -e '
const ls=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);const a=ls[0],z=ls.at(-1);
const c0=a.cpu0.trim().split(" ").map(Number),c1=z.cpu1.trim().split(" ").map(Number);const tot=(c1[0]-c0[0])/1e6,d=(z.dcpu1-a.dcpu0)/100;
let first=null;const cur0=+ls[1].s.split(" ")[1];for(const l of ls.slice(1,-1)){const s=l.s.split(" ");if(first==null&&+s[1]>cur0-0)first=l.t}
console.log(JSON.stringify({label:a.label,file:a.file,t0ms:Math.round(a.t0*1000),endS:+z.end.toFixed(1),cpuS:+tot.toFixed(1),userS:+((c1[1]-c0[1])/1e6).toFixed(1),sysS:+((c1[2]-c0[2])/1e6).toFixed(1),daemonS:d,testsS:+(tot-d).toFixed(1),load1Start:a.load1,load1End:z.load1}))' $f
done
