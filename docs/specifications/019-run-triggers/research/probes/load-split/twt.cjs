// 019-46 probe (throwaway): whether the store keeps transitions and results of removed worktrees.
const {DatabaseSync}=require("node:sqlite");
const db=new DatabaseSync(process.argv[2],{readOnly:true}); const T0=Date.parse("2026-11-02T16:50:00Z");
const q=(s,...a)=>db.prepare(s).get(...a);
console.log(q("select count(distinct worktree_id) all_w, count(distinct case when worktree_id in (select id from worktrees) then worktree_id end) live_w from transitions where at>=?",T0),
 q("select count(distinct worktree_id) all_w, count(distinct case when worktree_id in (select id from worktrees) then worktree_id end) live_w from runs where started_at>=?",T0),
 q("select count(*) n from results where recorded_at>=? and worktree_id not in (select id from worktrees)",T0));
