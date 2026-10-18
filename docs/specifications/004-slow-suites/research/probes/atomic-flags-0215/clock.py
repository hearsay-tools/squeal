import json,sys
g=json.load(open(sys.argv[1]+'/out/grade.json'))
for i,t in enumerate(g['transcript']):
  if 'clock' in t or t.startswith('final') or t.startswith('$ ') and 'squeal' in t:
    print(f'--- [{i}]'); print(t[:int(sys.argv[2])])
