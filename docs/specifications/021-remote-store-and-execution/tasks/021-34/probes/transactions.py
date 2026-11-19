import re,subprocess,collections,sys
files=subprocess.check_output(['grep','-rl',r'transaction(','src','--include=*.ts']).decode().split()
res=collections.Counter(); bydir=collections.defaultdict(collections.Counter)
for f in files:
    s=open(f).read()
    for m in re.finditer(r'\.transaction\(|\btransaction\(\s*(\(|async|function|[a-zA-Z_]+\s*,)',s):
        i=s.find('(',m.start())
        d=0;j=i
        while j<len(s):
            c=s[j]
            if c=='(':d+=1
            elif c==')':
                d-=1
                if d==0:break
            j+=1
        body=s[i:j]
        if len(body)<15: continue
        reads=bool(re.search(r'\.(get|all|iterate)\(|\bselect\b|SELECT|read[A-Z]\w*\(|load[A-Z]\w*\(',body))
        k='reads inside' if reads else 'writes only (or calls)'
        res[k]+=1; bydir[f.rsplit('/',1)[0]][k]+=1
print(res)
for d,c in sorted(bydir.items(),key=lambda x:-sum(x[1].values()))[:12]: print(d,dict(c))
