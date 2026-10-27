"""Recompute counts, missed failures and timing summaries from saved executions."""
import json
from pathlib import Path
import statistics
import sys

root = Path(__file__).parent
summary = {}
for version in ['stable', 'current']:
    data = json.loads((root/version/'testmon-results.json').read_text())
    cases = data['cases']
    for case in cases:
        assert case['baseline']['exit'] == 0
        full_failures = {r['id'] for r in case['exhaustive']['reports'] if r['outcome'] == 'failed'}
        found = {r['id'] for r in case['selected']['reports'] if r['outcome'] == 'failed'}
        assert sorted(full_failures-found) == case['missed_failures']
    ordinary = [c for c in cases if c['case'].startswith('body-refactor')]
    assert len(ordinary) == 5
    assert all(c['selected_count'] == 1 and c['full_count'] == 8 and not c['missed_failures'] for c in ordinary)
    timing = {f'{arm}_{metric}_median': statistics.median(c[arm][metric] for c in ordinary)
              for arm in ['baseline','selected','exhaustive'] for metric in ['cpu_ms','wall_ms']}
    summary[f'testmon_{version}'] = {'metadata': data['metadata'], 'cases': len(cases),
        'missed_cases': [c['case'] for c in cases if c['missed_failures']], 'ordinary': timing}
js = json.loads((root/'current/js-results.json').read_text())
for case in js['cases']:
    assert not any(r['failure'] for r in case['baseline']['results'])
    assert not any(r['failure'] for r in case['existingBaseline']['results'])
    full_failures = {r['test'] for r in case['exhaustive']['results'] if r['failure']}
    assert sorted(full_failures) == sorted(case['failures'])
    for key, missed in [('raw','rawMissed'), ('guarded','guardedMissed'), ('existing','existingMissed')]:
        assert sorted(full_failures - set(case[key]['tests'])) == sorted(case[missed])
    for arm, selection in [('reduced','guarded'), ('existingReduced','existing')]:
        assert {r['test'] for r in case[arm]['results']} == set(case[selection]['tests'])
        assert {r['test'] for r in case[arm]['results'] if r['failure']} == full_failures & set(case[selection]['tests'])
ordinary = [c for c in js['cases'] if c['case'].startswith('body-refactor')]
assert len(ordinary) == 5
assert all(len(c['existing']['tests']) == 1 and c['population'] == 8 and not c['failures'] for c in ordinary)
summary['javascript'] = {'metadata': js['metadata'], 'cases': len(js['cases']),
    'missed_cases': {key: [c['case'] for c in js['cases'] if c[key]] for key in ['rawMissed','guardedMissed','existingMissed']},
    'ordinary': {f'{arm}_{metric}_median': statistics.median(c[arm][metric] for c in ordinary)
        for arm in ['baseline','existingBaseline','reduced','existingReduced','exhaustive']
        for metric in ['processTreeCpuMs','childWallMs','wallMs']},
    'selection_ms_median': statistics.median(c['selectionMs'] for c in ordinary)}
warm = json.loads((root/'current/warm-results.json').read_text())
for case in warm['cases']:
    choice, oracle = case['variants']
    assert choice['mode'] == 'selected' and oracle['mode'] == 'exhaustive'
    for arm in case['variants']:
        assert not arm['baseline']['errors']
        assert all(t['state'] == 'passed' for t in arm['baseline']['tests'])
        assert all(m['state'] == 'passed' for m in arm['baseline']['modules'])
        assert sorted(m['file'] for m in arm['edited']['modules']) == sorted(arm['decision']['tests'])
        assert arm['edited']['totalCpuMs'] >= 0
    full_failures = {m['file'] for m in oracle['edited']['modules'] if m['state'] == 'failed'}
    selected_failures = {m['file'] for m in choice['edited']['modules'] if m['state'] == 'failed'}
    assert sorted(full_failures - selected_failures) == sorted(case['missed'])
    chosen = set(choice['decision']['tests'])
    assert {(t['file'], t['name'], t['state']) for t in choice['edited']['tests']} == {
        (t['file'], t['name'], t['state']) for t in oracle['edited']['tests'] if t['file'] in chosen}
ordinary = [c for c in warm['cases'] if c['case'].startswith('body-refactor')]
assert len(ordinary) == 5
assert all(len(c['variants'][0]['edited']['tests']) == 3 and len(c['variants'][1]['edited']['tests']) == 24 for c in ordinary)
summary['warm_vitest'] = {'cases': len(warm['cases']), 'missed_cases': [c['case'] for c in warm['cases'] if c['missed']],
    'ordinary': {f'{arm}_{step}_{metric}_median': statistics.median(c['variants'][index][step][metric] for c in ordinary)
        for index,arm in [(0,'selected'),(1,'exhaustive')] for step in ['baseline','edited']
        for metric in ['totalCpuMs','totalWallMs','captureWallMs']},
    'collection_ms_median': {arm: statistics.median(sum(m['diagnostic']['collectDuration'] for m in c['variants'][index]['edited']['modules']) for c in ordinary)
        for index,arm in [(0,'selected'),(1,'exhaustive')]},
    'selection_ms_median': statistics.median(c['variants'][0]['decisionMs'] for c in ordinary),
    'load_one_minute_range': [min(a[step]['load'][0] for c in warm['cases'] for a in c['variants'] for step in ['cold','baseline','edited']),
                            max(a[step]['load'][0] for c in warm['cases'] for a in c['variants'] for step in ['cold','baseline','edited'])]}
text = json.dumps(summary, indent=2)+'\n'
if '--check' in sys.argv:
    assert text == (root/'summary.json').read_text(), 'saved summary differs'
    print('PASS: baseline outcomes, selections, failure detection and saved summary agree')
else:
    (root/'summary.json').write_text(text)
    print(text)
