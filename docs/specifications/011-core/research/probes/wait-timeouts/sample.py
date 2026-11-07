"""Q3: a stratified sample of timed-out waits (4 or 5 per load band, both projects, varied classes) with their
rebuilt timelines from timeline.mjs. Throwaway. Usage: python3 -I sample.py TL.jsonl SEED"""
import json, sys, random
EDG = ["0-6", "6-12", "12-16", "16-20", "20-24"]
tl = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
tl = [t for t in tl if t["storeHasWorktree"] and t["nTests"] > 0]
random.seed(int(sys.argv[2]))
pick = []
for b in range(5):
    seen = set()
    pool = [t for t in tl if t["band"] == b]
    random.shuffle(pool)
    for t in pool:
        k = (t["project"], t["primary"])
        if k in seen:
            continue
        seen.add(k)
        pick.append(t)
        if sum(1 for p in pick if p["band"] == b) >= (4 if b == 0 else 5):
            break
print("| # | start (UTC) | busy | project | class | named tests | named run running / other runs / no run (s of 60) | first named run starts | answered | runs in the worktree, s from wait start: start–end (files, named) |")
print("|---|---|---|---|---|---|---|---|---|---|")
for i, t in enumerate(pick, 1):
    runs = [u for u in t["runs"] if u["end"] > -30 and u["start"] < 240][:6]
    rs = "; ".join(f"{u['start']:.0f}–{u['end']:.0f} ({u['n']}{', ' + str(u['named']) if u['named'] else ''}{', cp' if u['cp'] else ''})" for u in runs) or "none"
    fs = "—" if t["firstNamedStartAfter"] is None else f"+{t['firstNamedStartAfter']:.0f} s"
    an = "not in 15 min" if t["answeredAfter"] is None else f"+{t['answeredAfter']:.0f} s"
    print(f"| {i} | {t['start'][5:16]} | {t['busy']:.0f} | {t['project']} | {t['primary']} | {t['nTests']} | {t['covered']:.0f} / {t['other']:.0f} / {t['idle']:.0f} | {fs} | {an} | {rs} |")
