# Throwaway probe for research 011-53: prints the inside log; a second argument keeps the ticks.
# Usage: python3 -I show.py <inside.jsonl> [all]
import sys,json
for l in open(sys.argv[1]):
  d=json.loads(l)
  if d['label']=='tick' and len(sys.argv)<3: continue
  print(d['t'][11:19],d['label'].ljust(14),d['load1'],'priv',d['privMiB'],'hT',d['heapTotalMiB'],'phys',d['physicalHeapMiB'],'used',d['heapUsedMiB'],'ext',d['externalMiB'],'new',d['spaces']['new_space']['size'],'old',d['spaces']['old_space'],d.get('pauseMs',''))
