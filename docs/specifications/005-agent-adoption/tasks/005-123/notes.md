# 005-123: the pending overlay is built only for a meta read

## Change

`SendingConnection.get` (`src/core/delivery/sending-connection.ts`) asks `readsMeta(sql)` (new export of `src/core/delivery/sent-meta.ts`) before it builds `#pending()`. Any read that is not `SELECT value FROM meta WHERE key = ?` goes to the store at once. `overlaidMeta` returned `undefined` for those reads already, so no read returns a different value. Only a held connection with an open transaction paid the copy (`[...held, ...batch]`); outside a hold `#pending()` returned `#batch` itself.

Other read paths of the class: `all`, `read` and `transaction` never build the overlay. `prepared.ts` copies only its short lists of reports and holds, once per delivery (`abandonAll`, `rollbackHolds`), not per read: not the same pattern, left as it is.

A meta read inside a hold still builds `[...held, ...batch]` once per read. The meaning stays spec 021 D15. If meta reads under a growing hold show up in a later profile, scan `#batch` then `#held` without the copy.

## Count

`test/delivery/sending-overlay-cost.test.ts` counts the statements handed to `overlaidMeta` for N = 50 non-meta reads against a batch of M = 200 writes:

| | outside a hold, open batch | inside a hold, held batch + open batch |
|---|---|---|
| main (33d14059b) | 10,000 (M x N) | 20,000 (2M x N) |
| this row | 0 | 0 |

Its two other cases check the overlay values (held write, open write over it, delete, untouched key) and pass on both.

## Timing

30,000 `get` calls of a non-meta read, each after one more meta write in the same transaction, `:memory:` store, 3 runs each. Host load average 13 to 16 on 24 vCPUs at the time (other coordinators' work), 2026-11-17 21:58Z.

| | no hold | inside a hold |
|---|---|---|
| main | 41, 79, 57 ms | 2,731, 3,078, 3,154 ms |
| this row | 42, 52, 45 ms | 48, 75, 34 ms |
