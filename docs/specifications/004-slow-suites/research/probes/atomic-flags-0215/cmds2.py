import json,glob,os,sys
r={'0199':'/tmp/squeal-evals-1001/cells/e77eff42453e/20261016T061730Z-07d7ab','0215':'/tmp/squeal-evals-1001/cells/581f1772dc45/20261018T125937Z-bcdbec'}[sys.argv[3]]
for d in sorted(glob.glob(f'{r}/{sys.argv[1]}.p0.{sys.argv[2]}.e-medium.r*'),key=lambda p:int(p.rsplit('.r',1)[1])):
  g=json.load(open(d+'/out/grade.json'))
  print('##',os.path.basename(d).split('.')[-1], g.get('claim'))
  for t in g['transcript']:
    if t.startswith('$ ') and 'squeal' in t.split('\n')[0]:
      print('   ',t.split('\n')[0][:150], t.split('\n')[1] if '\n' in t else '')
