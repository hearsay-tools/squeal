const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.argv[2],{readOnly:true});
const rows=db.prepare("select worktree_id w, number n, created_at t, head, changes from revisions where trigger='watch'").all();
const out=[];for(const r of rows){const all=JSON.parse(r.changes);if(all.length>3)continue;const c=all.filter(x=>/\.(ts|tsx|mts|mjs|cjs|js|py)$/.test(x.path)&&!x.path.startsWith("plugins/")&&!x.path.startsWith("docs/"));for(const x of c)out.push([r.w,r.n,r.t,r.head,x.path,x.oldHash||"",x.newHash||""].join("\t"))}
require("fs").writeFileSync(process.argv[3],out.join("\n")+"\n");console.log(out.length);
