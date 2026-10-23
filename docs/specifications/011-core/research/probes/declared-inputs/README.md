# Probes for 011-150: declared inputs broader than what a test reads

Throwaway. Written for `research/declared-inputs.md`, 2026-10-23. Nothing here is product code, and nothing here is maintained.

## Rules these probes keep

- Stores are read only from copies (`store.sqlite` with its `-wal` and `-shm`) under `/tmp/di150/stores`, opened read only. No live store, daemon socket or permit pool is touched.
- Other repositories are read with read-only git commands (`git ls-tree`, `git cat-file`, `git show`) at a named commit, never edited.
- The one experiment (`build-diff.sh`) runs in a `git clone` under `/tmp/di150`, `node_modules` copied from the installed checkout at the same commit, through `env.sh` (`env -i`, `HOME`, `XDG_*`, `TMPDIR` and the npm, pnpm and corepack homes under `/tmp/di150`, npm offline). It runs at nice 10, pinned to 4 CPUs. No Squeal daemon, no test runner and no browser was started. `PLUGIN_ROOT` and `PLUGIN_DATA` are never set.

## Files

| File | Measures | Question |
|---|---|---|
| `globre.py` | the policy `inputs` glob, copied from squeal `src/core/keys/glob.ts` at `4e1ba068a` | all |
| `walk.py` | files at a commit, and a regex walk of static and dynamic imports (type-only imports dropped), with squeal's and cezar's resolvers | all |
| `routes.py <repo> <store> <checkout> <commit> <config> <hours> <out.json>` | per edit (watch revision of 1 to 9 paths) the test files re-keyed and why: own file, import, declared, observed; per (test glob, input glob) the files covered, the carriers and the declared-alone seconds; the walk's accuracy against the stored graph (`walk` line, `MISS` samples on stderr) | 1, 3 |
| `fails.py <store> <config> <hours> <file regex> <out.json>` | each test file that turned to FAIL, the paths changed in its worktree since its previous result, the route of each, what came next, the failure summary | 2, 3 |
| `narrow-e2e.py <checkout> <commit> <store> <config> <routes.json> <fails.json> <hours>` | cezar's specs under the sets S0 to S3: declared files per spec, re-keys, FAIL transitions kept, runs that would not have started, runs per worktree after pulls or edits | 2, 4 |
| `web-eager.py <checkout> <commit>` | eager and lazy modules of cezar's web app and server entry | 2 |
| `bundle-closure.py <checkout> <commit> <routes-squeal.json> <store>` | the `src/**/*.ts` files squeal's plugin bundles can contain, and the declared-alone seconds of edits outside them | 3, 4 |
| `build-diff.sh <clone> <label> [<path> comment\|literal]` | builds cezar's e2e bundle (`build-e2e.sh`) after one edit and prints one hash per output tree | 2 |
| `env.sh` | the isolated environment for `build-diff.sh` | 2 |

## Re-running each measurement

```sh
S=/tmp/di150; P=<this folder>
mkdir -p $S/stores $S/an $S/logs $S/home $S/tmp $S/run $S/xdg/config $S/xdg/cache $S/xdg/data $S/xdg/state; chmod 700 $S/run
for r in squeal cezar toolkit-dev mvp-unveiled-july26; do mkdir -p $S/stores/$r; cp ~/projects/$r/.git/squeal/store.sqlite* $S/stores/$r/; done
git -C ~/projects/squeal show 88f90431c:squeal.config.json > $S/an/squeal.config.json
git -C ~/projects/cezar show 565fd3eaf:squeal.config.json > $S/an/cezar.config.json
cp ~/projects/toolkit-dev/squeal.config.json $S/an/toolkit-dev.config.json
cd $S
# question 1 (and the route split question 3 uses)
nice -n 10 python3 -I $P/routes.py squeal stores/squeal/store.sqlite ~/projects/squeal 88f90431c an/squeal.config.json 72 an/routes-squeal.json
nice -n 10 python3 -I $P/routes.py cezar stores/cezar/store.sqlite ~/projects/cezar 565fd3eaf an/cezar.config.json 72 an/routes-cezar.json
nice -n 10 python3 -I $P/routes.py toolkit-dev stores/toolkit-dev/store.sqlite ~/projects/toolkit-dev 7f939fb9 an/toolkit-dev.config.json 72 an/routes-toolkit.json
# question 2: FAIL transitions of the specs (72 h, then the whole store), narrower sets, eager and lazy modules
nice -n 10 python3 -I $P/fails.py stores/cezar/store.sqlite an/cezar.config.json 72 '^packages/web/e2e/' an/fails-cezar-e2e.json
nice -n 10 python3 -I $P/fails.py stores/cezar/store.sqlite an/cezar.config.json 400 '^packages/web/e2e/' an/fails-cezar-e2e-all.json
nice -n 10 python3 -I $P/narrow-e2e.py ~/projects/cezar 565fd3eaf stores/cezar/store.sqlite an/cezar.config.json an/routes-cezar.json an/fails-cezar-e2e.json 72
nice -n 10 python3 -I $P/web-eager.py ~/projects/cezar 565fd3eaf
# question 2 experiment: scratch clone, copied node_modules, one build per edit
git clone -q ~/projects/cezar $S/cezar && git -C $S/cezar checkout -q 565fd3eaf
(cd ~/projects/cezar && find . -maxdepth 4 -name node_modules -type d -prune -not -path './node_modules/*' | grep -v '^./.ai') | while read d; do mkdir -p "$S/cezar/$(dirname $d)"; cp -a ~/projects/cezar/$d $S/cezar/$d; done
cp $P/env.sh $P/build-diff.sh $S/
sh $S/build-diff.sh $S/cezar base-1; sh $S/build-diff.sh $S/cezar base-2
sh $S/build-diff.sh $S/cezar t-cezar-test packages/cezar/src/server/git.test.ts comment
sh $S/build-diff.sh $S/cezar l-web-literal packages/web/src/routes/task-thread/activity-summary.tsx literal
# question 3: FAIL transitions of squeal, bundle closure
nice -n 10 python3 -I $P/fails.py stores/squeal/store.sqlite an/squeal.config.json 72 '.' an/fails-squeal.json
nice -n 10 python3 -I $P/bundle-closure.py ~/projects/squeal 88f90431c an/routes-squeal.json stores/squeal/store.sqlite
```

The per-folder and per-carrier tables of question 3 and the FAIL classification are short Python one-liners over `routes-squeal.json` and `fails-squeal.json`; each takes the route of the changed paths (`inClosure`), the `next` outcome and the `summary` field.

Clean up: `rm -rf /tmp/di150`. Done on 2026-10-23 after the last build: no process was left, and `/tmp/di150` (clone, store copies, analysis files, logs) is removed.
