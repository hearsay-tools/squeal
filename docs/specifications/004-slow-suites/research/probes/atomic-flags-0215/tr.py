import json,sys
g=json.load(open(sys.argv[1]+'/out/grade.json'))
skip=int(sys.argv[2]) if len(sys.argv)>2 else 0
for i,t in enumerate(g['transcript']):
  if i<skip: continue
  print(f'--- [{i}]'); print(t[:int(sys.argv[3]) if len(sys.argv)>3 else 3000])
