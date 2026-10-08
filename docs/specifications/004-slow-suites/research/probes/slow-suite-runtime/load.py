"""Throwaway: read only sysstat queue history. No process arguments or environment recorded."""
import json, subprocess, sys
host=json.loads(subprocess.check_output(['sadf','-j',sys.argv[1],'--','-q']))['sysstat']['hosts'][0]
rows=[r for r in host['statistics'] if '08:00:00' <= r['timestamp']['time'] < '18:00:00']
loads=[r['queue']['ldavg-1'] for r in rows]
print(json.dumps({'samples':[{'timestamp':r['timestamp'],'queue':r['queue']} for r in rows],
 'summary':{'source':sys.argv[1],'date':rows[0]['timestamp']['date'],'window':'08:00–18:00 UTC (10:00–20:00 Europe/Warsaw)',
 'samples':len(rows),'cpus':host['number-of-cpus'],'thresholds':{str(t):{'above':sum(v>t for v in loads),'fraction':sum(v>t for v in loads)/len(loads)} for t in [4,10,25]},
 'min':min(loads),'max':max(loads),'median':sorted(loads)[len(loads)//2]}},indent=2))
