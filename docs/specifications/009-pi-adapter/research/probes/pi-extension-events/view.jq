# THROWAWAY: compact one-line view of probe.jsonl
(if .ctx then .sid = (.ctx.sessionId // "" | .[0:8]) | .mode = .ctx.mode | .idle = .ctx.idle else . end)
| del(.t, .pid, .ctx, .hr)
| tostring | .[0:420]
