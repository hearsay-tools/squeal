#!/usr/bin/env python3
"""Throwaway, read-only inventory of the selected commit and 100 first-parent commits."""
import collections
import json
import subprocess
import sys

ref = sys.argv[1] if len(sys.argv) > 1 else 'HEAD'
def git(*args):
    return subprocess.check_output(['git', *args], text=True)

sha = git('rev-parse', ref).strip()
files = []
for line in git('ls-tree', '-r', '-l', sha).splitlines():
    meta, path = line.split('\t')
    mode, kind, oid, size = meta.split()
    if kind == 'blob':
        files.append((path, int(size), oid))
dists = [x for x in files if '/dist/' in x[0] or x[0].startswith('dist/')]
groups = collections.defaultdict(lambda: {'files': 0, 'bytes': 0})
for path, size, oid in dists:
    group = path.split('/dist/')[0] + '/dist'
    groups[group]['files'] += 1
    groups[group]['bytes'] += size
commits = git('rev-list', '--first-parent', '--max-count=100', sha).splitlines()
base = git('rev-parse', commits[-1]+'^').strip()
metrics = {'all': {'added': 0, 'deleted': 0, 'file_changes': 0}, 'dist': {'added': 0, 'deleted': 0, 'file_changes': 0}}
touched = 0
for commit in commits:
    hit = False
    for line in git('diff', '--numstat', commit+'^', commit).splitlines():
        a, d, path = line.split('\t', 2)
        keys = ['all']
        if path.startswith('plugins/') and '/dist/' in path:
            keys.append('dist'); hit = True
        for key in keys:
            metrics[key]['file_changes'] += 1
            if a != '-':
                metrics[key]['added'] += int(a); metrics[key]['deleted'] += int(d)
    touched += hit
print(json.dumps({'commit': sha, 'tracked_files':len(files), 'tracked_bytes':sum(x[1] for x in files), 'dist': dict(groups), 'dist_total_bytes':sum(x[1] for x in dists), 'dist_unique_blob_bytes':sum(dict((x[2],x[1]) for x in dists).values()), 'window': {'base_exclusive': base, 'head_inclusive': sha, 'first_parent_commits': len(commits), 'commits_touching_dist': touched, 'numstat': metrics}}, indent=2))
