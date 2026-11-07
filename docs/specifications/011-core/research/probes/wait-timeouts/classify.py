"""Q1: classify each named `squeal status --wait 60000` by what its output said about the named files. Throwaway.

Usage: python3 -I classify.py WAITS.jsonl SAR_U.csv EXCLUDE_ID8 OUT.jsonl
WAITS from extract-waits.py; SAR_U is `sadf -d -U -- -u` before 2026-11-07 08:20Z. Prints tables; writes one line
per named 60 s wait with its band, its classes and counts (no output text).

A wait timed out when its output holds Squeal's own sentence "the deadline passed after" (src/cli/status-wait*.ts).
The first such sentence is classified (a command may loop several waits; `loops` counts them).
Per named pending file, the state words of that sentence give its class:
  quiet      "N queued: the <lane> lane waits for quiet until ..." (catch-up quiet period)
  behind     "N queued behind the <lane> tier of M test files" or "N queued, promoted, ... behind the ..."
  promoted   "N queued, promoted" with no tier ahead named
  noholder   "N queued, nothing recorded holds them" / "no run is open and nothing recorded holds them"
  running    "N in the <lane> tier of M test files" / "N running since"
  ended      "N ended at revision R, awaiting the tier's final checks"
  sharedkey  "N waiting for <other worktree>'s run of its key"
  queued     any other "N queued"
  stale / unknown  "N stale" / "N unknown"
Whole-wait states (no per-file split): unlisted ("revision R is not listed yet"), daemon ("heartbeat had lapsed",
"has not stored its pass over the edits"). The flag `hb` marks "the daemon's heartbeat went N s stale".
Primary class: the class with most named files; whole-wait states win when present.
"""
import json, re, sys, os, collections
from datetime import datetime
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "load-slowdown"))
from load import Sar, band, label, med, quant  # noqa: E402

EDGES = [0, 6, 12, 16, 20, 24.01]
DL = re.compile(r"the deadline passed after ([\d.]+) s: (.*?)(?:\. Worktree:|\n|$)", re.S)
PEND = re.compile(r"^(\d+) test files? still pending at revision (\d+): (.*)$", re.S)
PARTS = [
    ("quiet", re.compile(r"(\d+) queued: the \S+ lane waits for quiet until (\d\d:\d\d:\d\d), (\d+) s after")),
    ("behind", re.compile(r"(\d+) queued behind the \S+ tier of (\d+) test files?")),
    ("promoted", re.compile(r"(\d+) queued, promoted(.{0,160}?)(?=, \d+ (?:queued|in the|running|ended|waiting)|;|$)", re.S)),
    ("noholder", re.compile(r"(\d+) queued(?:, nothing recorded holds them|; no run is open and nothing recorded holds them)")),
    ("running", re.compile(r"(\d+) (?:in the \S+ tier of (\d+) test files?|running since)")),
    ("ended", re.compile(r"(\d+) ended at revision \d+, awaiting the tier's final checks")),
    ("sharedkey", re.compile(r"(\d+) waiting for \S+'s run of its key")),
    ("stale", re.compile(r"(\d+) stale")),
    ("unknown", re.compile(r"(\d+) unknown")),
    ("queued", re.compile(r"(\d+) queued(?! behind|: the|, promoted|, nothing|; no run)")),
]
SEL = re.compile(r"Not a listed test file: (\S+); it selects (?:the )?(\d+) test files?")


def classify(o):
    ms = list(DL.finditer(o))
    if not ms:
        return None
    m = ms[0]
    s = m.group(2)
    r = {"after": float(m.group(1)), "loops": len(ms), "hb": "heartbeat went" in s, "counts": {}, "behindTier": None, "whole": None}
    p = PEND.match(s)
    if "is not listed yet" in s and not p:
        r["whole"] = "unlisted"
    elif ("heartbeat had lapsed" in s or "has not stored its pass" in s) and not p:
        r["whole"] = "daemon"
    if p:
        r["pending"] = int(p.group(1))
        body = p.group(3)
        # Each part starts with a count; the first matching pattern at a part start wins.
        starts = [0] + [x.end() for x in re.finditer(r", (?=\d+ (?:queued|in the|running|ended|waiting|stale|unknown))", body)]
        for i, st in enumerate(starts):
            part = body[st:(starts[i + 1] - 2) if i + 1 < len(starts) else len(body)]
            for name, rx in PARTS:
                mm = rx.match(part)
                if mm:
                    n = int(mm.group(1))
                    if name == "promoted" and " behind the " in part:
                        name = "behind"
                    r["counts"][name] = r["counts"].get(name, 0) + n
                    if name == "behind":
                        t = re.search(r"behind the \S+ tier of (\d+) test files?", part)
                        if t:
                            r["behindTier"] = max(r["behindTier"] or 0, int(t.group(1)))
                    if name == "quiet":
                        r["quietUntil"] = mm.group(2)
                    break
            else:
                r["counts"]["other"] = r["counts"].get("other", 0) + 1
    if r["whole"]:
        r["primary"] = r["whole"]
    elif r["counts"]:
        order = ["quiet", "behind", "running", "ended", "promoted", "noholder", "sharedkey", "queued", "stale", "unknown", "other"]
        r["primary"] = max(r["counts"], key=lambda k: (r["counts"][k], -order.index(k)))
    else:
        r["primary"] = "other"
    return r


def main():
    waits, sarp, excl, out = sys.argv[1:5]
    sar = Sar(sarp)
    fo = open(out, "w")
    rows = []
    for line in open(waits):
        w = json.loads(line)
        if w["limit"] != 60000 or not w["paths"] or (w["cwd"] and excl in w["cwd"]):
            continue
        t0 = datetime.fromisoformat(w["start"]).timestamp()
        smp = sar.at(t0 + min(w["wall"], 60) / 2)
        if not smp:
            continue
        sels = SEL.findall(w["out"])
        c = classify(w["out"])
        row = {"src": w["src"], "session": w["session"], "cwd": w["cwd"], "start": w["start"], "wall": w["wall"], "exit": w["exit"],
               "busy": round(smp[2], 2), "band": band(smp[2], EDGES), "paths": w["paths"], "nNamed": len(w["paths"]),
               "sources": len(sels), "sourceSelects": sum(int(n) for _, n in sels), "timedOut": bool(c), **(c or {})}
        rows.append(row)
        fo.write(json.dumps(row) + "\n")
    print("named 60 s waits", len(rows), "timed out (deadline sentence)", sum(r["timedOut"] for r in rows),
          "wall>=59.5", sum(r["wall"] >= 59.5 for r in rows))
    print("\nband | n | median wall | timed out | share")
    for b in range(len(EDGES) - 1):
        x = [r for r in rows if r["band"] == b]
        to = [r for r in x if r["timedOut"]]
        print(label(EDGES, b), len(x), round(med([min(r["wall"], 65) for r in x]) or 0, 1), len(to), f"{len(to) / max(1, len(x)):.0%}")
    to = [r for r in rows if r["timedOut"]]
    classes = collections.Counter(r["primary"] for r in to)
    print("\nprimary class of timed-out waits | all | per band (count, share of band's timed-out)")
    for k, v in classes.most_common():
        per = []
        for b in range(len(EDGES) - 1):
            xb = [r for r in to if r["band"] == b]
            n = sum(r["primary"] == k for r in xb)
            per.append(f"{n} ({n / max(1, len(xb)):.0%})")
        print(k, v, f"{v / len(to):.0%}", " | ".join(per))
    print("\nnamed files pending at the deadline, by state (file-weighted):")
    fc = collections.Counter()
    for r in to:
        for k, v in r["counts"].items():
            fc[k] += v
    tot = sum(fc.values())
    for k, v in fc.most_common():
        print(k, v, f"{v / tot:.0%}")
    print("\nnamed a source file (wide set):", sum(r["sources"] > 0 for r in to), "of", len(to), "timed out;",
          sum(r["sources"] > 0 for r in rows), "of", len(rows), "all")
    for wide in (True, False):
        x = [r for r in rows if (r["sources"] > 0) == wide]
        print(" wide" if wide else " tests only", len(x), "timed out", f"{sum(r['timedOut'] for r in x) / max(1, len(x)):.0%}",
              "median wall", round(med([min(r['wall'], 65) for r in x]), 1),
              "per band:", " ".join(f"{label(EDGES, b)}:{sum(r['timedOut'] for r in x if r['band'] == b)}/{sum(1 for r in x if r['band'] == b)}" for b in range(len(EDGES) - 1)))
    print("\npending named files at deadline: median", med([r.get("pending", 0) for r in to if "pending" in r]),
          "p75", quant([r.get("pending", 0) for r in to if "pending" in r], .75))
    print("heartbeat-stale flag:", sum(r["hb"] for r in to), "of", len(to), "; per band",
          " ".join(f"{sum(r['hb'] for r in to if r['band'] == b)}/{sum(1 for r in to if r['band'] == b)}" for b in range(len(EDGES) - 1)))
    bt = [r["behindTier"] for r in to if r.get("behindTier")]
    print("behind: tier size ahead median", med(bt), "share >= 20 files", f"{sum(t >= 20 for t in bt) / max(1, len(bt)):.0%}", "n", len(bt))
    proj = collections.Counter(("cezar" if "/cezar/" in (r["cwd"] or "") else "squeal" if "/squeal/" in (r["cwd"] or "") else "other") for r in to)
    print("projects:", dict(proj))


main()
