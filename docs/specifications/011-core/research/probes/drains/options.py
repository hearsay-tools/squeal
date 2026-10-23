#!/usr/bin/env python3
"""011-161 probe: the four drain options replayed over `drains.py`'s output.

Throwaway, a model. Usage:
  python3 -I options.py <drains.jsonl> <wait-pss-mib> <wait-cpu-s-per-min> [gap-s]

Per drain with a known end (a session's return of unknown time is left out):
  (d) as today: the drain's minutes and runs as recorded.
  (c) no drains: the daemon exits at the grace; every drain run is lost.
  (b) a 15-minute bound: runs that started in the first 15 min are kept, and
      the daemon lives until the last of them ends (a stop lets a tier in
      flight store, C9); later runs are lost.
  (a) exit when the drain must wait: the drain keeps the runs of its first
      busy stretch, beginning within <gap-s> (default 60) of the start, with
      no gap of <gap-s> or more between runs; it exits at that stretch's end,
      or at the start when no run began within <gap-s>.
  (a') as (a), but every fast run of the drain (an edit's work, the re-runs)
      is kept: it exits at the end of its fast work, or later at the end of a
      slow stretch that began within <gap-s> of it.
Saved daemon-minutes are today's minus the option's. MiB-minutes: a waiting
minute counts <wait-pss-mib> (measured, `memory.py`); a minute with a run is
counted the same, so tests' memory is left out (a lower bound). CPU-seconds:
a waiting minute counts <wait-cpu-s-per-min> (measured); a recorded second
counts 0.32 to 0.59 CPU-s (`research/edit-load.md` 0). Lost results: the
lost runs' results, those a later lookup read, and those at a key another
live worktree holds now (would be read within 7 days under 011-160, inferred).
"""
import json
import sys

GRACE_MS = 3_000


def option(drain, name, gap_ms):
    start, end = drain["start_ms"], drain["window_end_ms"]
    runs = sorted(drain["run_list"], key=lambda r: r["start"])
    if name == "d":
        kept, until = runs, end
    elif name == "c":
        kept, until = [], start + GRACE_MS
    elif name == "b":
        kept = [r for r in runs if r["start"] < start + 15 * 60_000]
        until = min(end, max([start + 15 * 60_000] + [r["end"] for r in kept]))
    elif name == "a2":
        # Fast work (an edit's, the re-runs) still runs; the drain exits once only slow
        # files are left and the slow lane must wait, at the end of the fast work.
        fast = [r for r in runs if not r["slow"]]
        edge = max([start + GRACE_MS] + [r["end"] for r in fast])
        kept = list(fast)
        for r in [r for r in runs if r["slow"]]:
            if r["start"] - edge >= gap_ms:
                break
            kept.append(r)
            edge = max(edge, r["end"])
        until = min(end, edge)
    else:
        kept, edge = [], start + GRACE_MS
        for r in runs:
            if r["start"] - edge >= gap_ms:
                break
            kept.append(r)
            edge = max(edge, r["end"])
        until = min(end, edge)
    lost = [r for r in runs if r not in kept]
    return {
        "minutes": max(0.0, (until - start) / 60_000),
        "recorded_s": sum(r["recorded_s"] for r in kept),
        "lost_runs": len(lost), "lost_results": sum(r["results"] for r in lost),
        "lost_read_later": sum(r["read_later"] for r in lost),
        "lost_key_elsewhere": sum(r["key_held_elsewhere"] for r in lost),
    }


def main(path, pss, cpu_min, gap_s="60"):
    pss, cpu_min, gap_ms = float(pss), float(cpu_min), float(gap_s) * 1000
    drains = [json.loads(l) for l in open(path)]
    drains = [d for d in drains if "totals" not in d and d["ended"] != "a session registered (time unknown)"]
    print(f"{len(drains)} drains with a known end; wait PSS {pss} MiB, wait CPU {cpu_min} CPU-s/min, gap {gap_s} s")
    today = {k: sum(option(d, "d", gap_ms)[k] for d in drains) for k in ("minutes", "recorded_s")}
    print("| Option | Daemon-minutes saved | MiB-minutes saved (daemon only) | CPU-s saved | Runs lost | Results lost | of them read later | at a key another live worktree holds |")
    print("| --- | --- | --- | --- | --- | --- | --- | --- |")
    for name, label in (("a", "(a) exit when it must wait"), ("a2", "(a') exit when only slow files wait"), ("b", "(b) 15-min bound"), ("c", "(c) no drains"), ("d", "(d) as today")):
        o = {k: 0.0 for k in ("minutes", "recorded_s", "lost_runs", "lost_results", "lost_read_later", "lost_key_elsewhere")}
        for d in drains:
            for k, v in option(d, name, gap_ms).items():
                o[k] += v
        saved_min = today["minutes"] - o["minutes"]
        saved_rec = today["recorded_s"] - o["recorded_s"]
        cpu_lo = saved_min * cpu_min + saved_rec * 0.32
        cpu_hi = saved_min * cpu_min + saved_rec * 0.59
        print(f"| {label} | {saved_min:.0f} of {today['minutes']:.0f} | {saved_min * pss:,.0f} | {cpu_lo:,.0f} to {cpu_hi:,.0f} |"
              f" {o['lost_runs']:.0f} | {o['lost_results']:.0f} | {o['lost_read_later']:.0f} | {o['lost_key_elsewhere']:.0f} |")


if __name__ == "__main__":
    main(*sys.argv[1:])
