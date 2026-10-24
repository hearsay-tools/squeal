import re,html,sys,urllib.request
url,out=sys.argv[1],sys.argv[2]
req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
s=urllib.request.urlopen(req,timeout=60).read().decode('utf-8','replace')
s=re.sub(r'<script.*?</script>','',s,flags=re.S); s=re.sub(r'<style.*?</style>','',s,flags=re.S)
t=re.sub(r'<[^>]+>',' ',s); t=html.unescape(t); t=re.sub(r'[ \t]+',' ',t); t=re.sub(r'\n\s*\n+','\n',t)
open(out,'w').write(t); print(url,len(t))
