// 019-46 probe (throwaway): recorded seconds of candidate manual groups, from split.mjs output `files`.
const j=JSON.parse(require("fs").readFileSync(process.argv[2])); const pats=process.argv.slice(3);
const tot=j.total; for (const p of pats){ const re=new RegExp(p); let s=0,ns=0,n=0,f=0; for (const [k,[sec,notS,runs]] of Object.entries(j.files)) if(re.test(k)){s+=sec;ns+=notS;n+=runs;f++} console.log(p, "files",f,"runs",n,"sec",s,(100*s/tot).toFixed(1)+"%","notStored",ns); }
