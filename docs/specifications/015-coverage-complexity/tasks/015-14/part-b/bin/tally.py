"""015-14 part B: verdicts and tables for the window's code lines.
Verdict rules (Round 1's, with one addition):
  useful   the agent acted on it or used it to choose, or a coordinator relayed it and a test followed;
           a PASS that confirms a fix the agent made for that function.
  noise    from a pull or another actor and not acted on; a FAIL the session's own next write reversed
           within 180 s with no action (`transient`), and the PASS that reversed it; code only a child
           process or a worker thread runs, or that no test is meant to load (fixtures, probes,
           Squeal-excluded files); a repeated summary.
  unclear  true, about the session's own edit, and the agent did not react; a first summary.
Usage: python3 -I tally.py   (reads out/cases.json, out/lines.json; writes out/judged.json, prints tables)"""
import json, re, collections
from datetime import datetime

O = '/tmp/dogfood-015-14/w-327524f0/out/'
xs = json.load(open(O + 'cases.json'))
allx = json.load(open(O + 'lines.json'))


def t(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00'))


# Paths whose functions run only in a child process or worker thread, or that no test is meant to load.
NOT_IN_PROCESS = re.compile(r'^(test/fixtures/|research/probes/|test/e2e/|test/real-cli/|test/keys/validity/harness/'
                            r'|src/core/code/coverage/provider\.mjs|src/core/lint/provider/)')
# Lines a coordinator relayed to the owner, after which a test was written (rows 011-228, 011-229).
RELAYED = {('605ca21e', 'withSlowInstance.drop.<catch> (occurrence 2)'), ('605ca21e', 'FullCheckOwner.constructor.<catch>'),
           ('605ca21e', 'runFullCheck.<new Promise>.<on> (occurrence 2)')}
# Used to choose: the 015 coordinator researched `relist` (row 015-58) and took the wording to the human.
CHOSE = {('52e58f23', 'relist')}

for x in xs:
    x['verdict'] = None
    x['why'] = None
cov = [x for x in xs if x['measure'] in ('crap', 'untested')]
for x in cov:
    key = (x['session'], x['function'])
    if key in RELAYED:
        x['verdict'], x['why'] = 'useful', 'relayed to the owner; a test followed'
    elif key in CHOSE:
        x['verdict'], x['why'] = 'useful', 'researched; became a product decision'
    elif x['path'] and NOT_IN_PROCESS.match(x['path']):
        x['verdict'], x['why'] = 'noise', 'runs only in another process or thread, or no test is meant to load it'
    elif x['cause'] in ('pull', 'not own'):
        x['verdict'], x['why'] = 'noise', f'from a {x["cause"]}'
# transient: a FAIL reversed by a PASS (or RESOLVED) of the same function in the same session within 180 s
for x in cov:
    if x['verdict'] or x['kind'] != 'FAIL':
        continue
    later = [y for y in cov if y['session'] == x['session'] and y['function'] == x['function'] and y['measure'] == x['measure']
             and y['kind'] in ('PASS', 'RESOLVED') and 0 < (t(y['ts']) - t(x['ts'])).total_seconds() <= 180]
    if later:
        x['verdict'], x['why'] = 'noise', 'transient: reversed by the next write within 180 s'
        for y in later:
            if not y['verdict']:
                y['verdict'], y['why'] = 'noise', 'reverses a transient FAIL'
for x in cov:
    if not x['verdict']:
        x['verdict'], x['why'] = 'unclear', 'true, own edit, no reaction'
for x in xs:
    if x['measure'] == 'complexity' and not x['verdict']:
        x['verdict'], x['why'] = ('noise', f'from a {x["cause"]}') if x['cause'] != 'own' else ('unclear', 'own edit')
json.dump(xs, open(O + 'judged.json', 'w'), indent=0)

# Summaries: first of its text per session unclear, repeats noise.
sums = [x for x in allx if x['kind'] == 'summary']
seen = set()
for x in sums:
    k = (x['harness'], x['session'], re.sub(r'\d+', 'N', x['line']))
    x['verdict'] = 'noise' if k in seen else 'unclear'
    seen.add(k)


def stype(line):
    if 'that this session was told about' in line:
        return 'told-over'
    if line.startswith('Complexity counted'):
        return 'counted'
    if 'counting has not started' in line or 'counting,' in line:
        return 'counting'
    if line.startswith('Coverage checks changed') or 'no longer checked' in line:
        return 'exclude change'
    if re.match(r'^Complexity: \d+ functions? over \d+; squeal code lists them\.$', line):
        return 'registration'
    return 'other'


print('== summaries by repo, checkout, harness, type, event')
c = collections.Counter((x.get('repo', 'squeal'), x['where'], x['harness'], stype(x['line']), x['event'][:5]) for x in sums)
for k, v in sorted(c.items()):
    print(v, k)
print('== other summary texts')
for x in sums:
    if stype(x['line']) == 'other':
        print('  ', x['session'], x['version'], x['line'][:160])

print('\n== coverage lines in this repository by version: kind x verdict')
rows = collections.defaultdict(collections.Counter)
for x in cov:
    if x.get('repo', 'squeal') != 'squeal':
        continue
    rows[x['version']][(x['kind'], x['measure'])] += 1
    rows[x['version']]['v:' + x['verdict']] += 1
    rows[x['version']]['sessions:' + x['session']] = 1
for v in sorted(rows):
    r = rows[v]
    ses = sum(1 for k in r if isinstance(k, str) and k.startswith('sessions:'))
    print(v, 'sessions', ses, {f'{k[0]} {k[1]}': n for k, n in r.items() if isinstance(k, tuple)},
          {k: n for k, n in r.items() if isinstance(k, str) and k.startswith('v:')})
print('\n== coverage verdict reasons')
print(collections.Counter((x['verdict'], x['why']) for x in cov if x.get('repo', 'squeal') == 'squeal'))
print('\n== complexity lines in this repository: kind x cause')
print(collections.Counter((x['version'], x['kind'], x['cause']) for x in xs if x['measure'] == 'complexity' and x.get('repo', 'squeal') == 'squeal'))
print('\n== codex other repos')
print(collections.Counter((x.get('repo'), x['version'], x['kind'], x['measure'], x['cause']) for x in xs if x.get('repo', 'squeal') != 'squeal'))
print('\n== per session (this repository): version, kinds, verdicts')
per = collections.defaultdict(list)
for x in cov:
    if x.get('repo', 'squeal') == 'squeal':
        per[(x['harness'], x['session'])].append(x)
for (h, s), ls in sorted(per.items(), key=lambda kv: kv[1][0]['ts']):
    vs = sorted({x['version'] for x in ls})
    kinds = collections.Counter(f'{x["kind"]} {x["measure"]}' for x in ls)
    ver = collections.Counter(x['verdict'] for x in ls)
    print(f'{h} {s} {"/".join(vs)} {ls[0]["ts"][5:16]} {dict(kinds)} {dict(ver)}')
