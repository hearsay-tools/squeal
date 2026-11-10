# Probes for survey 020-07 (daemon parity)

Throwaway. Kept only as the evidence behind `../../daemon-parity.md`. Nothing here is product code or a test.

Every probe is read-only. The store probes open `<common-dir>/squeal/{store,code}.sqlite` with `node:sqlite` `{ readOnly: true }` and write nothing. No daemon, no test run, no build.

| Probe | Question | Run | Output |
|---|---|---|---|
| `parity.mts` | Q2, Q4 | `node_modules/.bin/tsx <dir>/parity.mts` | `parity.out.json` |
| `count-tests.mts` | Q3 | `node_modules/.bin/tsx <dir>/count-tests.mts <common-dir> ea9b1bcbb0fd4139` (3 runs, `nice -n 10`) | `count-tests.{1,2,3}.json` |
| `no-loader.mjs` | Q4 | `node <dir>/no-loader.mjs <common-dir> ea9b1bcbb0fd4139` | `no-loader.out.json` |
| `reuse.mjs` | Q5 | `node <dir>/reuse.mjs <common-dir> 72b72a160688bbde 5644f6f4bf38d407 ea9b1bcbb0fd4139 dabd2fa9168de306` | `reuse.out.json` |
| `no-record.mjs` | Q5 | `node <dir>/no-record.mjs <common-dir> 5644f6f4bf38d407` | `no-record.out.json` |

`<common-dir>` was `/home/agent/projects/squeal/.git`. The stores are live: other daemons wrote to them during the runs, so counts can differ by a few rows between runs.

Squeal at `1e8b506ed` (0.1.423 plus docs), Node v24.22.1, Vitest 5.0.3. One-minute load: 24 to 28 during every run (24 vCPUs).
