import subprocess,sys
root='/tmp/squeal-hook-levers-4f3e9ac9'
h=sys.argv[1]
modes=['baseline','rewrite','ask','deny','prectx','post','stop','allow','deny','prectx','post','stop']
if h=='claude':modes+=['allow-unlisted','deny-original','deny-rewritten','if']
for i,m in enumerate(modes,2):
 r=subprocess.run(['python3',root+'/probe.py',h,m,str(i)],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
 print(r.stdout,flush=True)
