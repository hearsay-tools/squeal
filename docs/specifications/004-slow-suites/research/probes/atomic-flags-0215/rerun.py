# Three-way table for row 004-77: 0.1.199, 0.1.215 and the 0.1.216 re-run, per flagged
# model and scenario: each measure, the claims, the commands that decided them, and the
# load at each cell's start (first row of out/load.tsv) beside its max.
import json,glob,os,collections,statistics
roots={'0.1.199':'/tmp/squeal-evals-1001/cells/e77eff42453e/20261016T061730Z-07d7ab',
       '0.1.215':'/tmp/squeal-evals-1001/cells/581f1772dc45/20261018T125937Z-bcdbec',
       '0.1.216':'/tmp/squeal-evals-1001/cells/98beb8cd9f3b/20261018T184306Z-4fc7da'}
groups=[(t,m) for m in ('codex-gpt-6-luna','claude-claude-sonnet-5-5') for t in ('a2-slow','a3-harmless','a8-load-hold','a11-inherited-flake')]
def load(d):
  rows=[l.split('\t') for l in open(d+'/out/load.tsv') if l.strip()]
  return float(rows[0][1]), max(float(r[1]) for r in rows)
for t,m in groups:
  print(f'## {t} {m}')
  for v,r in roots.items():
    meas=collections.defaultdict(lambda:[0,0]); claims=collections.Counter(); starts=[]; maxes=[]
    c=collections.Counter(); n=0
    for d in glob.glob(f'{r}/{t}.p0.{m}.e-medium.r*'):
      try: g=json.load(open(d+'/out/grade.json'))
      except Exception: continue
      n+=1; claims[g.get('claim')]+=1
      for k,x in (g.get('atomic',{}).get('measures') or {}).items():
        if x is not None: meas[k][0]+=bool(x); meas[k][1]+=1
      s,mx=load(d); starts.append(s); maxes.append(mx)
      cmds=[x.split('\n')[0] for x in g['transcript'] if x.startswith('$ ')]
      c['path wait']+=any('status --wait 60000 src/' in x for x in cmds)
      c['run --slow']+=any('run --slow' in x for x in cmds)
      c['run --all']+=any('run --all' in x for x in cmds)
      c['retry']+=any(' retry ' in x for x in cmds)
      c['no CLI']+=any(x.startswith("$ /bin/bash -lc 'status ") or 'npx squeal' in x for x in cmds)
    if not n: continue
    ms=', '.join(f'{k} {a}/{b}' for k,(a,b) in sorted(meas.items()))
    print(f'  {v}: n={n} {ms}')
    print(f'      claims {dict(claims)}; ran {dict(c)}; load at start {min(starts):.1f}-{max(starts):.1f} (median {statistics.median(starts):.1f}), max {max(maxes):.1f}')
