# 011-30 probes (throwaway)

Throwaway evidence for `../design.md`, section 2. Delete freely. This is not product code and not a test.

`successor-cpu.sh <old plugin root> <new plugin root> <vitest node_modules> [hold-s]` follows the shape of `../../../research/probes/issue-47/probe.sh` run 2. An old daemon holds an edit's Vitest tier, and six new SessionStart hooks (three concurrent, three a second apart) ask it to step down. Each hook spawns a `--await-lock 120000` successor. The script samples every successor's CPU time (`ps cputimes`, 1 s resolution) and RSS at +10, +30 and +60 s. Then it releases the hold, samples once more and counts what is left. It refuses to run when the one-minute load is at or above the CPU count. `HOME` and `XDG_*` are inside a fresh `/tmp/issue47cpu.XXXX`, every fixture process is killed by that path, and the root is removed.

Run kept: `output-cpu-run1.txt`, 2026-10-20 07:40 UTC. Command:

```sh
P=~/.claude/plugins/cache/hearsay/squeal
./successor-cpu.sh $P/0.1.223 $P/0.1.224 /home/agent/projects/cezar/node_modules 90
```

Node v24.21.0 and Vitest 4.1.10. The load was 14.25 on 24 CPUs at the start and 24.99 at the end, because of other work on the host. After the run, `pgrep -af /tmp/issue47cpu` found no process and the root was gone.
