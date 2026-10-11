import json,sys,re,collections
rows=[]
for f in sys.argv[1:]:
  d=json.load(open(f))
  for c in d["cells"]:
    tr=c.get("transcript") or []
    last=None
    for s in tr:
      if s.startswith("final message"): break
      m=re.search(r"Slow tier: ([^\n]*)", s)
      if m: last=m.group(1)
    state=None
    if last:
      state="current" if "current against" in last and "pending" not in last and "running" not in last else ("running" if "running" in last else ("pending" if "pending" in last else ("notrun" if "not run" in last else last[:40])))
    e=c.get("expectations") or {}
    rows.append(dict(v=d["squealVersion"],id=c["id"],m=c["model"],task=c["task"],skill=c["skillLoads"]>0,slowrun=c["squealRunSlow"]>0,cbc=e.get("current-before-claim"),slow=state,claim=c.get("claim"),waits=c.get("squealWaits")))
by=collections.defaultdict(collections.Counter)
for r in rows:
  k=r["m"]
  by[k]["cells"]+=1; by[k]["skill"]+=r["skill"]; by[k]["runslow"]+=r["slowrun"]
  if r["cbc"] in ("met","missed"):
    by[k]["cbc_"+r["cbc"]]+=1
    if r["cbc"]=="missed": by[k]["missed_slow_"+str(r["slow"])]+=1
    else: by[k]["met_slow_"+str(r["slow"])]+=1
    by[k][f"cbc_{r['cbc']}_skill{int(r['skill'])}"]+=1
for k,v in by.items(): print(k, dict(sorted(v.items())))
tot=collections.Counter()
for r in rows:
  if r["cbc"]=="missed": tot[r["slow"]]+=1
print("all misses by slow state", tot)
json.dump(rows, open("rows.json", "w"), indent=0)
