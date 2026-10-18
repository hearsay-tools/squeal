import json,glob,os,collections
roots={'0199':'/tmp/squeal-evals-1001/cells/e77eff42453e/20261016T061730Z-07d7ab','0215':'/tmp/squeal-evals-1001/cells/581f1772dc45/20261018T125937Z-bcdbec'}
T=['a2-slow','a3-harmless','a8-load-hold','a11-inherited-flake']
res=collections.defaultdict(lambda: collections.defaultdict(lambda:[0,0]))
claims=collections.defaultdict(collections.Counter)
for v,r in roots.items():
  for d in glob.glob(r+'/*'):
    b=os.path.basename(d); t=b.split('.p0.')[0]
    if t not in T: continue
    m=b.split('.p0.')[1].split('.e-')[0]
    try: g=json.load(open(d+'/out/grade.json'))
    except: continue
    claims[(t,m,v)][g.get('claim')]+=1
    for k,x in (g.get('atomic',{}).get('measures') or {}).items():
      if x is None: continue
      res[(t,m,k)][v][0]+=bool(x); res[(t,m,k)][v][1]+=1
for k in sorted(res):
  a,b=res[k]['0199'],res[k]['0215']
  print(f"{k[0]:20} {k[1]:28} {k[2]:22} 0199 {a[0]}/{a[1]}  0215 {b[0]}/{b[1]}")
print()
for k in sorted(claims): print(k, dict(claims[k]))
