# Probe 011-181: test runs outside Squeal (throwaway)

Throwaway. These scripts measured `../../../host-load/011-181.md` once, from 2026-10-23 14:00Z to 2026-10-25, and are not maintained. They read agent transcripts, eval result files and `/proc`, read-only. They never open a store, a socket or a permit file, never run an agent CLI and never write under the transcripts' `HOME`. Their outputs that hold transcript text (`runs.jsonl`, `cls.jsonl`) stay in scratch space, out of the repository.

| File | What it does |
|---|---|
| `extract.py SINCE UNTIL OUT.jsonl` | Every shell command in Claude Code (`~/.claude/projects/*/*.jsonl`) and Codex (`~/.codex/sessions/*/*/*/*.jsonl`) transcripts that starts a test runner (Vitest, `npm test`, pytest, `node --test`, jest, mocha), with its session, cwd, wall, the last SQUEAL hook message and `squeal` command output before it, and the last edit. Here-document bodies and quoted text are not commands; `sh -c '…'` bodies are. |
| `classify.py RUNS.jsonl OUT.jsonl [overrides.json]` | Project, session role, scope and class of each run, by the rules in the findings file ("Method"). |
| `overrides.json` | The 8 runs read by hand, keyed `<session8> <start>`, with the class and reason. |
| `trees.json` | The sampled trees read by hand, keyed by cwd prefix or tree id: runs started from a script file and a run still running at the cut. |
| `eval-runs.py RESULT.json…` | Eval subjects' test runs from an eval result's cell timelines, by the class each would have outside an eval. |
| `sample-trees.py OUT.jsonl [SNAP_S] [LINE_S]` | The 24 h sampler: CPU per process tree outside Squeal, by test runner and agent session (its docstring has the rules). The daily's copy (`../sample-trees.py`, row 011-186) writes lines of another format; `analyze-samples.py` reads only this copy's. |
| `analyze-samples.py SAMPLES.jsonl [CLS.jsonl] [TREES.json] [EXCLUDE_TASK8…]` | The sampled hours' cores by kind of tree, and each test tree outside Squeal with its CPU seconds, joined to `classify.py`'s run of the same task, preferring a run whose command enters the tree's `/tmp` copy (`cd`, `--root`, `--dir`), or none when the tree is not in `/tmp`. |
| `runs-2026-10-24.tsv` | `classify.py`'s output for 2026-10-23 14:00Z to 2026-10-24 14:00Z, one line per run, without commands. |

## The sampler

It runs from `/home/agent/projects/squeal/.ai/cezar/t/04a258b0/samples-011-181/`, with its own copy of `sample-trees.py` and its cwd there. It writes `samples.jsonl` there and nothing else. It was started twice:

- 14:06:47Z, `setsid -f nice -n 10 timeout 24h python3 -I sample-trees.py samples.jsonl 5 60`. It stopped at 14:13Z: it was in `cezar.service`'s cgroup, and a cezar restart ended every process in it.
- 14:14:38Z, the same command under `systemd-run --user --scope -q --unit=sampler-011-181`, so a cezar restart does not reach it. It ends by itself at about 2026-10-25 14:14Z.

Each start writes a `{"event":"start"}` line, so the gap from 14:13Z to 14:15Z is visible.

## How to join the rest

After the sampler ends (`systemctl --user status sampler-011-181.scope` reports it gone, or `pgrep -f sample-trees.py` prints nothing):

```sh
S=/home/agent/projects/squeal/.ai/cezar/t/04a258b0/samples-011-181
P=<this folder>; W=<scratch outside the repository>
cd "$W"
nice -n 10 python3 -I $P/extract.py 2026-10-24T14:00:00Z 2026-10-25T14:30:00Z runs-s.jsonl
python3 -I $P/classify.py runs-s.jsonl cls-s.jsonl $P/overrides.json
python3 -I $P/analyze-samples.py $S/samples.jsonl cls-s.jsonl $P/trees.json 1bf0bde9 > trees.jsonl
```

The first line of `trees.jsonl` gives the whole window's cores by kind of tree; each later line is one test tree outside Squeal with its CPU seconds, role and class; the last line sums the CPU seconds per class. A Codex command appears in its transcript only when it ends, so run `extract.py` after the last sampled run has ended. A tree with no class has no matching run: read it by its task's transcript and add it to `overrides.json` (a run) or `trees.json` (a tree). Then delete `samples.jsonl` and the scratch files.

## Limits

- A tree's CPU counts its processes' own time and their reaped children's time. A process re-parented out of the tree before it ends gives its last seconds to its new parent's tree. `accounted` against `busy` in each line shows how much of the host's CPU the trees explain (88% in the first 17 minutes).
- A run detached from its agent (`setsid sh -c …`, reparented to `systemd --user`) has no agent in the samples. `analyze-samples.py` joins it by its cwd's task.
- Wall seconds from transcripts include waits: a locked full run's wall includes its wait for the lock, and a run in the background reports the time to start it.
