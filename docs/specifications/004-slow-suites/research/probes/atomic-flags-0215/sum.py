import json,glob,os,sys
roots={'0215':'/tmp/squeal-evals-1001/cells/581f1772dc45/20261018T125937Z-bcdbec','0199':'/tmp/squeal-evals-1001/cells/e77eff42453e/20261016T061730Z-07d7ab'}
task,model=sys.argv[1],sys.argv[2]
for v,r in roots.items():
  print('=====',v)
  for d in sorted(glob.glob(f'{r}/{task}.p0.{model}.e-medium.r*'),key=lambda p:int(p.rsplit('.r',1)[1])):
    try: g=json.load(open(d+'/out/grade.json'))
    except Exception as e: print(os.path.basename(d),'NO GRADE',e); continue
    a=g.get('atomic',{})
    m=a.get('measures',{})
    print(f"r{g['rep']:<2} truth={g['truth'].get('pass')} claim={g.get('claim')} sqEnd={g['squealEnd'].get('verdict')} known={g['squealEnd'].get('knownFailures')} m={m} load={g['load']['start']}")
    print('    ',(g.get('claimLine') or '')[:260])
