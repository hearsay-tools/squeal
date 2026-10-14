# Throwaway probes: pi-extension-events (spec 009, board row 009-01)

THROWAWAY. Not product code; nothing imports it. Kept as the evidence behind `../../pi-extension-events.md`.

Pi 1.0.4 runs only as the throwaway user `squeal-e2e`, never as the agent user, never with credentials:

- `go.sh <scenario>...` copies these files into `/home/squeal-e2e/pee/probe` through `sudo -n -u squeal-e2e` and runs `sc.sh <scenario>` there with `env -i`. `sc.sh` refuses to run as any other user.
- `sc.sh` points `PI_CODING_AGENT_DIR` at `/home/squeal-e2e/pee/agent`, sets `PI_OFFLINE=1`, and gives each scenario its own session dir under `/home/squeal-e2e/pee/out/<scenario>/`. The real `~/.pi/agent` is never read or written.
- `probe.ts` is one extension: a scripted fake provider (`fake/fake-1`, plans in `plans/`) that logs every request's context markers, an event recorder, and behaviours switched by `PROBE_FLAGS`, `PROBE_THROW`, `PROBE_SLOW` and `PROBE_HANG`.
- `rpc-drive.mjs` drives `pi --mode rpc` from `steps/*.json`. `sock-server.mjs` stands in for a daemon on a unix socket.
- `view.jq` condenses a `probe.jsonl`. `results/` holds the condensed logs the findings cite. Session files and full logs stay in the throwaway home.

Run it again: `./go.sh events-print`, then `./go.sh --cat events-print probe.jsonl | jq -r -f view.jq`.
