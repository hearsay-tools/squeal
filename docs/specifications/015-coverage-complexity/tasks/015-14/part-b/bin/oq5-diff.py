"""015-14 part B, open question 5: compare two runs' records of the same test files at the same content.
Per test file, per source: the lines bitset, the covered bitset, and each function's hit bit by span.
Usage: python3 -I oq5-diff.py <run-a.json> <run-b.json>"""
import base64, collections, json, sys

a, b = (json.load(open(p)) for p in sys.argv[1:3])


def bits(s):
    raw = base64.b64decode(s)
    return {i * 8 + j + 1 for i, byte in enumerate(raw) for j in range(8) if byte >> j & 1}


def funcs(src):
    out = collections.Counter()
    for f in src['functions']:
        span, hit = tuple(f[:4]), f[4] if len(f) > 4 else None
        out[(span, hit)] += 1
    return out


stats = collections.Counter()
diffs = []
both = sorted(set(a['records']) & set(b['records']))
stats['files a'] = len(a['records'])
stats['files b'] = len(b['records'])
stats['files in both'] = len(both)
for tf in both:
    ra, rb = a['records'][tf], b['records'][tf]
    sa = {s['path']: s for s in ra['sources']}
    sb = {s['path']: s for s in rb['sources']}
    if set(sa) != set(sb):
        diffs.append((tf, 'sources differ', sorted(set(sa) ^ set(sb))[:5]))
        stats['files with other sources'] += 1
    for p in sorted(set(sa) & set(sb)):
        x, y = sa[p], sb[p]
        stats['sources compared'] += 1
        if x['blob'] != y['blob']:
            stats['blob differs'] += 1
        la, lb = bits(x['lines']), bits(y['lines'])
        ca, cb = bits(x['covered']), bits(y['covered'])
        stats['lines compared'] += len(la | lb)
        if la != lb:
            stats['sources whose lines differ'] += 1
            diffs.append((tf, p, 'lines', len(la ^ lb)))
        if ca != cb:
            stats['sources whose covered lines differ'] += 1
            stats['covered lines that differ'] += len(ca ^ cb)
            diffs.append((tf, p, 'covered', sorted(ca - cb)[:8], sorted(cb - ca)[:8]))
        fa, fb = funcs(x), funcs(y)
        stats['functions compared'] += sum(fa.values())
        spans_a = collections.defaultdict(set)
        spans_b = collections.defaultdict(set)
        for (span, hit), n in fa.items():
            spans_a[span].add(hit)
        for (span, hit), n in fb.items():
            spans_b[span].add(hit)
        for span in set(spans_a) | set(spans_b):
            if spans_a.get(span) != spans_b.get(span):
                stats['functions whose hit bit differs'] += 1
                diffs.append((tf, p, 'function', span, sorted(spans_a.get(span, set()), key=str), sorted(spans_b.get(span, set()), key=str)))
oa, ob = a['outcomes'], b['outcomes']
stats['test files whose outcomes differ'] = sum(1 for tf in set(oa) | set(ob) if oa.get(tf) != ob.get(tf))
print(json.dumps(stats, indent=1))
for d in diffs[:40]:
    print(d)
