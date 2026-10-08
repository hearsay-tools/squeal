"""Throwaway: extract portable summaries before deleting owned scratch logs."""
import json,pathlib,re,sys
root=pathlib.Path(sys.argv[1]);out=pathlib.Path(__file__).parent
rows=[json.loads(x) for x in (out/'measurements.ndjson').read_text().splitlines()]
exclude=json.loads((out/'exclusions.json').read_text()) if (out/'exclusions.json').exists() else {}
lines=['# Observed resource trials','','Single observations; see README for accounting limits. MiB is sampled summed RSS, CPU is user+system seconds. Load is the host one-minute average at start and finish.','','| Trial | Wall s | CPU s | RSS MiB | Load start/end | Exit |','| --- | ---: | ---: | ---: | --- | ---: |']
files={};outcomes={}
for r in rows:
    nums=r['gnu_time'].splitlines()[-1].split();cpu=float(nums[1])+float(nums[2]);name=r['name']
    lines.append(f"| {name}{' (excluded)' if name in exclude else ''} | {r['wall_s']:.2f} | {cpu:.2f} | {r['peak_tree_rss_mib']:.1f} | {r['load_before'][0]:.1f}/{r['load_after'][0]:.1f} | {r['exit']} |")
    report=root/(name+'.json');log=root/(name+'.log')
    if report.exists():
        d=json.loads(report.read_text());files[name]=[{'file':pathlib.Path(t['name']).name,'reported_span_s':round((t['endTime']-t['startTime'])/1000,3),'status':t['status']} for t in d['testResults']]
        outcomes[name]={'tests':d['numTotalTests'],'passed':d['numPassedTests'],'failed':d['numFailedTests'],'failures':[{'file':pathlib.Path(t['name']).name,'name':a['fullName'],'messages':a.get('failureMessages',[])[:1]} for t in d['testResults'] for a in t['assertionResults'] if a['status']=='failed']}
    elif log.exists():
        text=log.read_text();outcomes[name]={'summary':re.findall(r'^# (?:tests|pass|fail|cancelled|skipped|duration_ms).*',text,re.M),'failures':re.findall(r'^not ok .*|^  error: .*',text,re.M)}
    events=root/(name+'-events.ndjson')
    if events.exists():
        durations=[]
        for line in events.read_text().splitlines():
            event=json.loads(line);d=event.get('data',{});detail=d.get('details',{})
            if event['type']=='test:complete' and detail.get('type')=='test' and str(d.get('name','')).endswith('.test.ts'):
                durations.append({'file':pathlib.Path(d['name']).name,'duration_s':round(detail['duration_ms']/1000,3)})
        if durations:files[name]=durations
lines+=['','## Excluded trials','']+[f'- `{name}`: {reason}' for name,reason in exclude.items()]
(out/'results.md').write_text('\n'.join(lines)+'\n');(out/'file-durations.json').write_text(json.dumps(files,indent=2)+'\n');(out/'outcomes.json').write_text(json.dumps(outcomes,indent=2)+'\n')
