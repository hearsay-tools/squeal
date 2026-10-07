#!/usr/bin/env bash
# Throwaway probe hook. Usage: hook.sh <label> [mode]
# Appends {"t_ns":..,"label":..,"stdin":<event json>} to $PROBE_LOG, then
# emits output chosen by mode (see README). Never reads credentials.
label="$1"; mode="${2:-silent}"
t=$(date +%s%N)
in=$(cat)
log="${PROBE_LOG:-/tmp/cxh/probe.log}"
printf '{"t_ns":%s,"label":"%s","mode":"%s","pid":%s,"stdin":%s}\n' "$t" "$label" "$mode" "$$" "${in:-null}" >> "$log"
ev=$(printf '%s' "$in" | sed -n 's/.*"hook_event_name":"\([A-Za-z]*\)".*/\1/p')
nonce="$label-$(printf '%04x' $((RANDOM)))"
case "$mode" in
  silent) ;;
  ctx) printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":"Squeal status note: nonce %s"}}\n' "$ev" "$nonce"; echo "{\"t_ns\":$t,\"emitted\":\"$nonce\"}" >> "$log" ;;
  plain) echo "Squeal status note (plain): nonce $nonce"; echo "{\"t_ns\":$t,\"emitted\":\"$nonce\"}" >> "$log" ;;
  deny) printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"SQUEAL-PROBE %s: tests/a.test.ts PASS -> FAIL at revision 7. The edit was not applied and can be re-issued."}}\n' "$nonce"; echo "{\"t_ns\":$t,\"emitted\":\"$nonce\"}" >> "$log" ;;
  block) printf '{"decision":"block","reason":"SQUEAL-PROBE %s: blocked by probe hook."}\n' "$nonce"; echo "{\"t_ns\":$t,\"emitted\":\"$nonce\"}" >> "$log" ;;
  exit2) echo "SQUEAL-PROBE-EXIT2 $nonce: blocked by probe hook (exit 2)." >&2; echo "{\"t_ns\":$t,\"emitted\":\"$nonce\"}" >> "$log"; exit 2 ;;
  blockonce) m="${PROBE_LOG}.once-$label"; if [ ! -e "$m" ]; then : > "$m"; printf '{"decision":"block","reason":"SQUEAL-PROBE %s: tests/a.test.ts PASS -> FAIL at revision 7. The edit was not applied and can be re-issued."}\n' "$nonce"; echo "{\"t_ns\":$t,\"emitted\":\"$nonce\"}" >> "$log"; fi ;;
  stopjson) echo '{}' ;;
  exit1) echo "probe failure on stderr" >&2; exit 1 ;;
  badjson) echo '{not json' ;;
  big) n="${PROBE_BIG:-20000}"; body=$(printf '%*s' "$n" '' | tr ' ' 'x'); half=$((n/2))
       printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":"HEAD-%s %s MID-%s %s TAIL-%s"}}\n' "$ev" "$nonce" "${body:0:$half}" "$nonce" "${body:$half}" "$nonce"; echo "{\"t_ns\":$t,\"emitted\":\"big-$n-$nonce\"}" >> "$log" ;;
  hang) sleep "${PROBE_HANG:-30}" ;;
esac
exit 0
