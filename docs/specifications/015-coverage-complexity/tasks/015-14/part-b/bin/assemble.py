"""015-14 part B: puts the Round 2 draft into lessons.md and the D10 and OQ5 tables into part-b.md.
Each placeholder takes out/<name>.md when it exists, else a pending note.
Usage: python3 -I assemble.py <worktree root>"""
import os, re, sys
B = '/tmp/dogfood-015-14/w-327524f0/out/'
root = sys.argv[1]
spec = f'{root}/docs/specifications/015-coverage-complexity'
PENDING = {
    'VERDICT-D10': 'Pending: the A/B pairs run beside the host\'s load, and this line is filled when they end.',
    'VERDICT-OQ5': 'Pending: the two runs wait for the load gate.',
    'D10-SECTION': '### D10: CPU per edit, coverage off and on\n\nPending: the A/B pairs run beside the host\'s load (`part-b.md`).',
    'OQ5-SECTION': '### Open question 5\n\nPending: the two runs wait for the load gate (`part-b.md`).',
    'TABLE-D10': 'Pending: the A/B pairs run beside the host\'s load.',
    'TABLE-OQ5': 'Pending: the two runs wait for the load gate.',
}


def fill(text):
    for key, note in PENDING.items():
        path = f'{B}{key.lower()}.md'
        text = text.replace(key, open(path).read().strip() if os.path.exists(path) else note)
    return text


round2 = fill(open(B + 'round2.md').read()).rstrip('\n') + '\n'
lessons = open(f'{spec}/lessons.md').read()
head, sep, rest = lessons.partition('\n## ')
if rest.startswith('Round 2 (015-14)'):
    rest = rest[rest.index('\n## ') + 4:]
open(f'{spec}/lessons.md', 'w').write(head + '\n' + round2 + '\n## ' + rest)
notes = f'{spec}/tasks/015-14/part-b.md'
src = B + 'part-b.src.md'
if not os.path.exists(src):
    open(src, 'w').write(open(notes).read())
open(notes, 'w').write(fill(open(src).read()))
left = [k for k in PENDING if k in open(notes).read() + open(f'{spec}/lessons.md').read()]
print('placeholders left:', left)
