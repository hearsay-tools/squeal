"""Check that captured experimental evidence supports the written findings."""
import ast
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
checks = 0


def check(condition, message):
    global checks
    assert condition, message
    checks += 1


def events(case, kind):
    return [event for event in case['events'] if event['kind'] == kind]


codes = []
for version in ('3.10', '3.13'):
    data = json.loads((BASE/f'results-{version}.json').read_text())
    cases = data['cases']
    check(len(cases) == 50, f'{version}: all main cases recorded')
    codes.append({name: case['code'] for name, case in cases.items()})
    for name, code in dict(smoke=0, outcomes=1, broken=2, broken_continue=1,
                           empty=5, usage=4, internal=3, keyboard=2,
                           hang_SIGINT=2, hang_SIGTERM=-15, hang_SIGKILL=-9,
                           timeout_signal=1, timeout_thread=1,
                           async_unittest=0, django_missing=0, django_settings=0,
                           snapshot_missing=1, snapshot_update=0, snapshot_saved=0,
                           import_prepend=0, import_append=4, import_importlib=0,
                           lf_no_cache=4, duplicate_prepend=2, duplicate_append=2,
                           duplicate_importlib=0).items():
        check(cases[name]['code'] == code, f'{version}: {name} exit')
    check(not events(cases['broken'], 'report'), 'broken collection prevents healthy body')
    check(len(events(cases['broken_continue'], 'report')) == 3, 'continue collection runs healthy file')
    reports = events(cases['outcomes'], 'report')
    check(len(reports) == 22, 'all possible outcome phases recorded')
    by_key = {(r['nodeid'].split('::')[-1], r['when']): r for r in reports}
    check(('test_setup', 'call') not in by_key, 'setup error has no call')
    check(by_key['test_teardown', 'call']['outcome'] == 'passed' and by_key['test_teardown', 'teardown']['outcome'] == 'failed', 'teardown can overturn passed call')
    check(by_key['test_xfail', 'call']['outcome'] == 'skipped' and by_key['test_xfail', 'call']['wasxfail'], 'xfail metadata')
    check(by_key['test_xpass', 'call']['outcome'] == 'passed' and by_key['test_xpass', 'call']['wasxfail'], 'xpass metadata')
    check(by_key['test_strict_xpass', 'call']['outcome'] == 'failed' and by_key['test_strict_xpass', 'call']['wasxfail'] is None, 'strict xpass differs')
    check(by_key['test_fail', 'call']['location'][1] == 10 and by_key['test_fail', 'call']['crash']['lineno'] == 9, 'test versus helper location')
    for name in ('hang_SIGTERM', 'hang_SIGKILL', 'timeout_thread'):
        check(not cases[name]['json_exists'] and not cases[name]['junit_exists'], name+' lacks final artifacts')
        check(not events(cases[name], 'sessionfinish') and events(cases[name], 'start'), name+' retains incomplete stream')
    for name in ('hang_SIGINT', 'hang_SIGTERM', 'hang_SIGKILL', 'timeout_signal', 'timeout_thread'):
        check(cases[name]['child_alive'], name+' leaves descendant alive')
    ids = [[item['nodeid'] for e in events(cases[name], 'collection') for item in e['items']] for name in ('collect1', 'collect2')]
    check([i for i in ids[0] if 'test_repr' not in i] == [i for i in ids[1] if 'test_repr' not in i], 'normal IDs stable')
    check([i for i in ids[0] if 'test_repr' in i] != [i for i in ids[1] if 'test_repr' in i], 'repr IDs unstable')
    check(any('test_duplicate[same0]' in i for i in ids[0]), 'duplicate IDs disambiguated')
    check(len(events(cases['batch_reports'], 'report')) == 60 and len(events(cases['xdist4_reports'], 'report')) == 60, 'parallel phase fidelity')
    check(not events(cases['xdist4_reports'], 'collection') and len(events(cases['xdist4_reports'], 'worker_collection')) == 4, 'xdist inventory belongs to workers')
    check(data['writes']['test_write'] and not data['writes']['pyc'] and data['writes']['snapshots'], 'filesystem writes observed')
    check(any(r['outcome'] == 'skipped' for r in events(cases['django_missing'], 'report')), 'Django without settings skipped')
    warm = json.loads((BASE/f'warm-{version}.json').read_text())
    check([r['code'] for r in warm['repeat']] == [0, 1, 1], 'repeat main stale')
    check([r['fresh_code'] for r in warm['repeat']] == [0, 0, 0], 'fresh main sees edits')
    check([r['code'] for r in warm['fork']] == [1, 1], 'contaminated fork stale')
    check([r['code'] for r in warm['clean_fork']] == [0, 0], 'clean fork sees edits')
    check(warm['reload'] == dict(module_value=5, earlier_from_import=1, deleted_name='retained'), 'reload limits')
    edge = json.loads((BASE/f'edges-{version}.json').read_text())
    check(edge['xdist_unstable_ids']['code'] == 1 and 'Different tests were collected' in edge['xdist_unstable_ids']['stdout'], 'xdist rejects unstable IDs')
    check(len(events(edge['xdist_outcomes'], 'report')) == 22, 'xdist retains outcome phases')
    check(edge['reporter_blocked']['code'] == 0 and not edge['reporter_blocked']['events'], 'exit zero does not prove reporting')
    check(edge['collect_sideeffects'] == dict(collection=True, body=False), 'collection executes imports only')
    check(edge['module_skip']['code'] == 5 and not events(edge['module_skip'], 'report'), 'module skip has no test phases')
    check([r['code'] for r in edge['packaged_conftest']] == [0, 1], 'packaged conftest stale')
    check(edge['group_term']['parent_code'] == -15 and edge['group_term']['child_state'] in ('gone', 'Z'), 'group termination ends descendant')
    for timing in data['timings'].values():
        check(timing['median_ms'] > 0 and len(timing['samples_ms']) in (3, 5), 'timing repetitions present')
    print(f'Python {data["python"]}: 50 main cases, warm/fork/reload, 10 edge records and 10 timing groups verified')
check(codes[0] == codes[1], 'main-case exits agree across Python versions')
for path in BASE.glob('*.py'):
    ast.parse(path.read_text(), filename=str(path))
    checks += 1
print(f'PASS: {checks} evidence and syntax checks')
