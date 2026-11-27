# Spec 026 Wave 14.6: close review 0.1.659-r2 B1 and its N1 note (row `026-37`)

Shape: **repair**. Use /worker. The human chose a last repair and a narrow third review (2026-11-27). Read `reviews/0.1.659-r2.md`: "Remaining blocker" and "N1 decision and new defect".

## Fixes

- **B1** Carry the optional `signal` from `Agent37Api.remove` (`providers/agent37/api.ts` `#call`) through `openEndpoint`, proxy CONNECT and TCP/TLS readiness (`providers/agent37/net.ts`). On abort: destroy the actual request and socket, clear the deadline timer, reject. The record stays; no later release starts. No promise race. Regression: a real loopback proxy that accepts CONNECT and never answers; abort; assert 0 open sockets and no live timer. Also cover a pending TLS handshake through the same cancellation path.
- **N1 note** In `prune.ts`, apply the automatic scope rule to the freshly read record before each release (use its path and scope, not the snapshot's). Inside the registry write lock, forget only when id and scope still match (manual prune keeps its cross-scope behaviour). Regressions: a queued record moved to a foreign scope before its turn is kept; a scope change during an in-flight release keeps the new record.

## Owns

`providers/agent37/api.ts`, `providers/agent37/net.ts`, `prune.ts`, `machines-store.ts`, and their tests. Nothing else. Do not run `pnpm run build`; do not edit `docs/board.md`. Give direct vitest runs a timeout.

## Done when

Both regressions fail on the current code and pass after; existing agent37, prune and machine-share tests pass; lint, typecheck and `squeal status --wait 60000 <changed paths>` show no failure your change causes.
