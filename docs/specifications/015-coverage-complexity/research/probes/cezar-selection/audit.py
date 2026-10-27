"""Audit retained reporter evidence, without executing any tests."""
import collections,gzip,json,pathlib,statistics,sys
HERE=pathlib.Path(__file__).resolve().parent
with gzip.open(HERE/'inputs.json.gz','rt') as f: inputs=json.load(f)
for row in inputs:
    old={s.split('\t',1)[1]:s.split('\t',1)[0] for s in row['previousManifest'].splitlines()}
    new={s.split('\t',1)[1]:s.split('\t',1)[0] for s in row['nextManifest'].splitlines()}
    assert {p for p in old.keys()|new.keys() if old.get(p)!=new.get(p)}==set(row['paths'])
if len(sys.argv)>1:
    scratch=pathlib.Path(sys.argv[1]);evidence={'runs':[],'interrupted':[],'pilots':[]}
    for path in sorted((scratch/'results').glob('*-process.json')):
        key=path.name.removesuffix('-process.json');result=scratch/'results'/(key+'.json')
        evidence['runs'].append({'key':key,'result':json.loads(result.read_text()) if result.exists() else None,'process':json.loads(path.read_text())})
    for path in sorted((scratch/'pilot').glob('*-process.json')):
        key=path.name.removesuffix('-process.json');result=scratch/'pilot'/(key+'.json')
        evidence['pilots'].append({'key':key,'result':json.loads(result.read_text()) if result.exists() else None,'process':json.loads(path.read_text())})
    for path in sorted((scratch/'debug').glob('*.json')):evidence['interrupted'].append({'name':path.name,'process':json.loads(path.read_text())})
    with gzip.open(HERE/'runs.json.gz','wt') as f:json.dump(evidence,f)
else:
    with gzip.open(HERE/'runs.json.gz','rt') as f:evidence=json.load(f)
def count(run):
    states=collections.Counter(t['state'] for t in run['tests'])
    return {'files':len(run['modules']),'cases':sum(n for s,n in states.items() if s in ['passed','failed']),'skipped':states['skipped'],'failedCases':states['failed'],'failedFiles':sum(m['state']=='failed' for m in run['modules'])}
def timing(run):
    return {'cpuMs':run['execution']['cpuMs']+run['mapping']['cpuMs'],'wallMs':run['execution']['wallMs']+run['mapping']['wallMs'],
            'mappingWallMs':run['mapping']['wallMs'],'collectionMs':sum(m['diagnostic'].get('collectDuration',0) for m in run['modules'])}
def failures(run):return collections.Counter((t['file'],t['name']) for t in run['tests'] if t['state']=='failed')
groups=collections.defaultdict(dict)
for row in evidence['runs']:
    key,mode=row['key'].rsplit('-',1);groups[key][mode]=row
rows=[]
for key,arms in groups.items():
    if set(arms)!={'structural','file','exhaustive'} or any(not a['result'] or not a['result'].get('edited') for a in arms.values()):
        rows.append({'key':key,'status':'incomplete','arms':list(arms)});continue
    vals={k:v['result'] for k,v in arms.items()}
    assert all(v['baselineOk'] for v in vals.values())
    if not all(v.get('protocol')==2 for v in vals.values()):
        rows.append({'key':key,'status':'pilot-awaiting-cost-correction','arms':list(arms)});continue
    assert all(len(v['baseline']['modules'])==18 for v in vals.values())
    baseline_sets=[collections.Counter((t['file'],t['name'],t['state']) for t in v['baseline']['tests']) for v in vals.values()]
    assert all(x==baseline_sets[0] for x in baseline_sets)
    assert set(vals['structural']['decision']['structural'])<=set(vals['file']['decision']['file'])
    for mode,v in vals.items():
        assert set(v['edited']['requested'])=={m['file'] for m in v['edited']['modules']},(key,mode,'module count mismatch')
        assert not v['edited']['errors'],(key,mode,'unhandled errors')
    oracle=vals['exhaustive']['edited'];failed=failures(oracle)
    item={'key':key,'status':'complete','baseline':count(vals['exhaustive']['baseline']),
          'counts':{m:count(v['edited']) for m,v in vals.items()},'timing':{m:{**timing(v['edited']), 'selectionMs':v['selection']['wallMs'],'selectionCpuMs':v['selection']['cpuMs']} for m,v in vals.items()},
          'missedCases':{m:sum((failed-failures(vals[m]['edited'])).values()) for m in ['structural','file']},
          'missedFiles':{m:sorted({x['file'] for x in oracle['modules'] if x['state']=='failed'}-{x['file'] for x in vals[m]['edited']['modules'] if x['state']=='failed'}) for m in ['structural','file']},
          'staleOmissions':vals['structural']['decision']['debt'],
          'sourceShapes':{p:{'kind':s['kind'],'changedBodies':[b['name'] for b in s.get('changedBodies',[])]} for p,s in vals['structural']['decision']['shapes'].items()},
          'globalChange':vals['structural']['globalChange'],
          'reasons':vals['structural']['decision']['reasons']}
    rows.append(item)
complete=[r for r in rows if r['status']=='complete'];historical=[r for r in complete if len(r['key'])==9 and all(c in '0123456789abcdef' for c in r['key'])];mutations=[r for r in complete if r not in historical]
def aggregate(rows):
    return {mode:{'files':sum(r['counts'][mode]['files'] for r in rows),'cases':sum(r['counts'][mode]['cases'] for r in rows),
        'failedCases':sum(r['counts'][mode]['failedCases'] for r in rows),
        'cpuMs':sum(r['timing'][mode]['cpuMs'] for r in rows),'wallMs':sum(r['timing'][mode]['wallMs'] for r in rows),
        'selectionMs':sum(r['timing'][mode]['selectionMs'] for r in rows),'selectionCpuMs':sum(r['timing'][mode]['selectionCpuMs'] for r in rows),'totalCpuMs':sum(r['timing'][mode]['cpuMs']+r['timing'][mode]['selectionCpuMs'] for r in rows),'totalWallMs':sum(r['timing'][mode]['wallMs']+r['timing'][mode]['selectionMs'] for r in rows)} for mode in ['structural','file','exhaustive']}
phases={}
for mode in ['structural','file','exhaustive']:
    data=[r['result'] for r in evidence['runs'] if r['key'].endswith('-'+mode) and r['result'] and r['result'].get('edited')]
    if data:phases[mode]={'startupMedianMs':statistics.median(r['startup']['wallMs'] for r in data),
       **{phase:{k:statistics.median(timing(r[phase])[k] for r in data) for k in ['cpuMs','wallMs','mappingWallMs','collectionMs']} for phase in ['cold','baseline']}}
primary_process=[r['process'] for r in evidence['runs'] if r['result'] and r['result'].get('protocol')==2 and r['result'].get('edited')]
by_arm={mode:{'arms':len([r for r in evidence['runs'] if r['key'].endswith('-'+mode) and r['result'] and r['result'].get('protocol')==2 and r['result'].get('edited')]),'cpuSeconds':sum(r['process']['cpuSeconds'] for r in evidence['runs'] if r['key'].endswith('-'+mode) and r['result'] and r['result'].get('protocol')==2 and r['result'].get('edited')),'wallSeconds':sum(r['process']['wallSeconds'] for r in evidence['runs'] if r['key'].endswith('-'+mode) and r['result'] and r['result'].get('protocol')==2 and r['result'].get('edited'))} for mode in ['structural','file','exhaustive']}
all_process=[r['process'] for r in evidence['runs']]+[r['process'] for r in evidence['interrupted']]+[r['process'] for r in evidence.get('pilots',[])]
diagnostics=[]
if (HERE/'failure-diagnostics.json.gz').exists():
    with gzip.open(HERE/'failure-diagnostics.json.gz','rt') as f: diagnostics=json.load(f)
summary={'historical':aggregate(historical),'mutations':aggregate(mutations),'completeHistorical':len(historical),'completeMutations':len(mutations),
 'phasesMedian':phases,'primaryProcessByArm':by_arm,'processTotals':{'cpuSeconds':sum(r['cpuSeconds'] for r in all_process),'wallSeconds':sum(r['wallSeconds'] for r in all_process),'snapshotSeconds':sum(r['snapshotSeconds'] for r in all_process),'maxChildRssKiB':max(r['maxRssKiB'] for r in all_process)},
 'diagnosticTotals':{'runs':len(diagnostics),'cpuSeconds':sum(r['cpuSeconds'] for r in diagnostics),'wallSeconds':sum(r['wallSeconds'] for r in diagnostics)},'interruptedAttempts':len(evidence['interrupted']),'pilotArms':len(evidence.get('pilots',[])),'rows':rows}
(HERE/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k not in ['rows','phasesMedian']},indent=2))
for r in complete:print(r['key'],{m:(c['files'],c['cases'],c['failedCases']) for m,c in r['counts'].items()},'missed',r['missedCases'])
