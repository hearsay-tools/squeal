import json,glob,os,sys,re
r={'0199':'/tmp/squeal-evals-1001/cells/e77eff42453e/20261016T061730Z-07d7ab','0215':'/tmp/squeal-evals-1001/cells/581f1772dc45/20261018T125937Z-bcdbec'}[sys.argv[3]]
for d in sorted(glob.glob(f'{r}/{sys.argv[1]}.p0.{sys.argv[2]}.e-medium.r*'),key=lambda p:int(p.rsplit('.r',1)[1])):
  g=json.load(open(d+'/out/grade.json'))
  print('##',os.path.basename(d).split('.')[-1], g.get('claim'))
  for t in g['transcript']:
    if t.startswith('$ '):
      first=t.split('\n')[0]; ex=t.split('\n')[1] if '\n' in t else ''
      first=first.replace('node --disable-warning=ExperimentalWarning "<cell>/codex/plugins/cache/hearsay/squeal/0.1.215/dist/cli/squeal.mjs"','SQ').replace('node --disable-warning=ExperimentalWarning "<cell>/codex/plugins/cache/hearsay/squeal/0.1.199/dist/cli/squeal.mjs"','SQ')
      if 'squeal' in first.lower() or 'SQ' in first or 'status' in first or 'vitest' in first or 'npm' in first:
        print('   ',first[:200], ex)
    elif t.startswith('edit '): print('   ',t[:60])
