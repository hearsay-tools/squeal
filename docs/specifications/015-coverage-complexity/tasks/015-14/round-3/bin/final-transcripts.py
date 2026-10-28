"""Read-only final window. Raw extracts stay in the supplied private scratch directory.
Usage: python3 -I final-transcripts.py /var/tmp/coverage-final-05fecde6
Uses the committed Round 2 extractors and Round 3 analysis; no sessions started.
"""
import json, pathlib, subprocess, sys, datetime
R=pathlib.Path(__file__).resolve().parents[1]
O=pathlib.Path(sys.argv[1]); O.mkdir(parents=True,exist_ok=True)
W0="2026-10-27T08:23:46Z"; W1="2026-10-28T06:31:05Z"
EXCLUDE=("a52cf0ea-7aa1-403e-8932-9af0f8d38bc0","05fecde6-12b3-4b82-a7a4-de871ee53819")
start=datetime.datetime.fromisoformat(W0.replace("Z","+00:00")).timestamp()
home=pathlib.Path.home()
cc=[p for p in (home/".claude/projects").glob("-home-agent-projects-squeal*/*.jsonl") if p.stat().st_mtime>=start and not any(x in str(p) for x in EXCLUDE)]
(O/"cc-list.txt").write_text("\n".join(map(str,cc)))
def run(*args): subprocess.run(list(map(str,args)),check=True)
run("python3","-I",R.parent/"part-b/bin/extract_cc.py",O/"cc-list.txt",O/"cc.json",W0,W1)
cx=[]
for p in (home/".codex/sessions").rglob("*.jsonl"):
 if p.stat().st_mtime<start: continue
 with p.open() as f:
  try: meta=json.loads(f.readline())
  except ValueError: continue
 cwd=meta.get("payload",{}).get("cwd","")
 if cwd.startswith("/home/agent/projects/squeal") and not any(x in cwd for x in EXCLUDE): cx.append(p)
# Keep full command text in private scratch so later apply_patch headers are not lost.
extract=(R.parent/"part-b/bin/extract_codex.py").read_text().replace("[:1500]", "[:100000]")
(O/"extract_codex.py").write_text(extract)
run("python3","-I",O/"extract_codex.py",O/"codex.json",W0,W1,*cx)
for name in ("cc","codex"):
 data=json.loads((O/(name+".json")).read_text())
 data=[s for s in data if (s.get("cwd") or "").startswith("/home/agent/projects/squeal") and not any(x in (s.get("cwd") or "") for x in EXCLUDE)]
 if name=="codex":
  for s in data: s["deliveries"]=[d for d in s["deliveries"] if d["text"].lstrip().startswith("SQUEAL")]
 (O/(name+".json")).write_text(json.dumps(data))
for script in ("lines","cases","window"):
 run("python3","-I",(R/"data/interim-bin/cases.py" if script=="cases" else R/"bin"/("final-"+script+".py")),O,W0,W1)
# Publish only Squeal lines and structured counts. Never publish raw commands or agent text.
for name in ("lines","window"):
 data=json.loads((O/(name+".json")).read_text())
 if name=="lines":
  for x in data: x["file"]=pathlib.Path(x["file"]).name
 (R/"data"/("final-"+name+".json")).write_text(json.dumps(data,indent=1)+"\n")

run("python3","-I",R/"data/interim-bin/tally.py",O)
data=json.loads((O/"judged.json").read_text())
for x in data: x["file"]=pathlib.Path(x["file"]).name
(R/"data/final-judged.json").write_text(json.dumps(data,indent=1)+"\n")
import hashlib
mapping={}
for name in ("cc","codex"):
 for session in json.loads((O/(name+".json")).read_text()):
  root=session['cwd']; wid=hashlib.sha256(root.encode()).hexdigest()[:16]
  mapping[wid]={'name':root.split('/')[-1][:8],'harness':name,'root':root}
(R/"data/final-worktree-names.json").write_text(json.dumps(mapping,indent=1)+"\n")
