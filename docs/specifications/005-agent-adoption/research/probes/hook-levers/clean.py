import probe
probe.PROMPT='For this experiment, use Squeal only from /tmp/squeal-hook-levers-4f3e9ac9/plugins/codex/ (CLI: node /tmp/squeal-hook-levers-4f3e9ac9/plugins/codex/dist/cli/squeal.mjs); never read or execute an installed Squeal copy. '+probe.PROMPT
for i,mode in enumerate(['baseline','rewrite','ask','allow','deny','stop']):probe.session('codex',mode,'clean'+str(i))
