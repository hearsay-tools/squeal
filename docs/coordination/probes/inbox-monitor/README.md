# Inbox monitor probe (throwaway)

Throwaway probe for `docs/coordination/inbox-monitor-findings.md`. Not product code; delete freely.
It ran only against a fake inbox under the task scratch directory, never the real `.agent-inbox/`.

`watch-inbox.sh <messages-dir> <session-id> <seen-file> [owner-pid]` exits 0 and prints `inbox: <id>...` when a `.md` message to the session or `all`, not from it, is missing from the seen file. It exits 3 when the owner PID is gone. It polls every 5 s.
