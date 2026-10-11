# Throwaway probe (001-280 Q4): time from a headless session's silent Stop until the slow tier
# is current, on a scratch fixture with scratch HOME/XDG_RUNTIME_DIR/TMPDIR. Hooks and CLI are
# this worktree's own Squeal bundles; no agent harness runs.
import json, os, subprocess, sys, time
S, PLUGIN, MODE, N = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
WORK = os.path.join(S, "work"); Q = os.path.join(PLUGIN, "dist/cli/squeal.mjs")
env = {k: v for k, v in os.environ.items() if not k.startswith(("CLAUDE", "CODEX", "CEZ_"))}
env.update(HOME=f"{S}/home", XDG_RUNTIME_DIR=f"{S}/run", TMPDIR=f"{S}/tmp", CLAUDE_PLUGIN_ROOT=PLUGIN,
           CLAUDE_PROJECT_DIR=WORK, CLAUDE_CODE_ENTRYPOINT="sdk-cli", CLAUDE_CODE_SESSION_ATTENDED="0")
def node(args, stdin=None):
    return subprocess.run(["node", "--disable-warning=ExperimentalWarning", *args], cwd=WORK, env=env,
                          input=stdin, capture_output=True, text=True, timeout=600)
def hook(name, event, sid, **kw):
    return node([f"{PLUGIN}/dist/{name}.mjs"], json.dumps(dict(session_id=sid, cwd=WORK, hook_event_name=event, **kw)))
def status():
    return json.loads(node([Q, "status", "--json"]).stdout)
def load(): return open("/proc/loadavg").read().split()[0]
def slow_current(st):
    t = st["slowTier"]; return t and t["current"] == t["testFiles"] and t["currentAt"] == st["revision"]
for i in range(N):
    sid = f"probe-{MODE}-{i}"
    hook("session-start", "SessionStart", sid, source="startup")
    hook("user-prompt-submit", "UserPromptSubmit", sid, prompt="x")
    # wait until the worktree is settled: slow current at the current revision
    t = time.time()
    while not slow_current(status()) and time.time() - t < 300: time.sleep(0.5)
    rev0 = status()["revision"]
    with open(os.path.join(WORK, "src/money.ts"), "a") as f: f.write(f"\n// probe {MODE} {i} {time.time()}\n")
    t_edit = time.time(); l0 = load()
    if MODE == "settled":   # Stop after the edit's fast tests have results (the usual claim moment)
        while True:
            st = status()
            if st["revision"] > rev0 and st["runnerPartPending"] is False and st["counts"]["pending"] <= 2: break
            time.sleep(0.2)
    t_stop = time.time()
    out = hook("stop", "Stop", sid, stop_hook_active=False)
    t_after_hook = time.time()
    trace = []
    while True:
        st = status()
        a = st["slowTier"]["activity"] if st["slowTier"] else None
        k = (a or {}).get("kind"), (a or {}).get("reason"), st["revision"], st["counts"]["pending"]
        if not trace or trace[-1][1] != k: trace.append((round(time.time() - t_stop, 1), k))
        if slow_current(st): break
        if time.time() - t_stop > 600: print("timeout"); break
        time.sleep(0.2)
    t_slow = time.time()
    hook("session-end", "SessionEnd", sid, reason="other")
    print(json.dumps(dict(mode=MODE, i=i, rev=st["revision"], edit_to_stop=round(t_stop - t_edit, 1),
        stop_hook_s=round(t_after_hook - t_stop, 2), stop_to_slow_current=round(t_slow - t_stop, 1),
        stop_said=out.stdout.strip()[:80], load_start=l0, load_end=load(),
        trace=trace, last_ms=st["slowTier"]["activity"] and st["slowTier"]["activity"].get("lastDurationMs"))), flush=True)
    time.sleep(4)  # past the 3 s sessions-gone window is fine: the next SessionStart spawns a daemon
