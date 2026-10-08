# Observed resource trials

Single observations; see README for accounting limits. MiB is sampled summed RSS, CPU is user+system seconds. Load is the host one-minute average at start and finish.

| Trial | Wall s | CPU s | RSS MiB | Load start/end | Exit |
| --- | ---: | ---: | ---: | --- | ---: |
| sq-a-full | 71.42 | 84.92 | 2439.3 | 10.4/16.5 | 0 |
| sq-a-lifecycle.test | 42.03 | 12.67 | 486.9 | 16.5/19.4 | 0 |
| sq-a-policy.test | 65.19 | 20.00 | 342.1 | 19.4/19.8 | 0 |
| sq-a-shipped-plugin.test | 9.63 | 8.47 | 719.8 | 19.8/18.7 | 0 |
| sq-a-torn-status.test | 0.97 | 1.11 | 252.3 | 18.7/18.7 | 0 |
| sq-a-transitions.test | 17.53 | 8.89 | 338.9 | 18.7/18.0 | 0 |
| sq-a-worktrees.test | 32.27 | 11.56 | 557.8 | 18.0/22.6 | 0 |
| sq-serial | 170.99 | 56.67 | 680.4 | 36.4/30.7 | 0 |
| sq-nice | 83.66 | 65.88 | 1458.9 | 30.7/40.6 | 0 |
| sq-affinity | 200.61 | 59.03 | 754.8 | 40.6/36.2 | 0 |
| cz-serial (excluded) | 117.28 | 134.81 | 886.1 | 36.2/28.0 | 1 |
| cz-nice (excluded) | 95.08 | 197.76 | 2810.1 | 28.0/40.5 | 1 |
| cz-affinity | 257.23 | 185.33 | 1060.9 | 40.5/25.2 | 0 |
| cz-a-full | 52.57 | 204.61 | 3116.0 | 20.5/25.8 | 0 |
| cz-a-alias-bin-exports.test | 0.25 | 0.24 | 118.7 | 25.8/25.8 | 0 |
| cz-a-application-update.test | 47.16 | 49.81 | 549.1 | 25.8/21.9 | 0 |
| cz-a-cockpit-ownership.test | 7.51 | 16.47 | 894.7 | 21.9/21.0 | 0 |
| cz-a-delegation.test | 17.26 | 19.52 | 588.3 | 21.0/18.7 | 0 |
| cz-a-inline-contract.test | 1.94 | 5.13 | 594.7 | 18.7/17.8 | 0 |
| cz-a-package-cli.test | 20.48 | 26.12 | 1073.2 | 17.8/15.7 | 0 |
| cz-a-release-snapshot.test | 8.78 | 7.70 | 263.2 | 15.7/14.9 | 0 |
| cz-a-release.test | 6.16 | 6.34 | 263.8 | 14.9/13.6 | 0 |
| cz-a-serve-port.test | 11.46 | 18.23 | 717.5 | 13.6/13.0 | 0 |
| cz-a-stop-child.test | 0.36 | 0.24 | 118.8 | 13.0/13.0 | 0 |
| cz-a-task-cli.test | 20.74 | 20.24 | 787.9 | 13.0/11.4 | 0 |
| cz-a-tick-writer.test | 0.24 | 0.20 | 149.7 | 11.4/11.4 | 0 |
| sq-pair-a | 62.45 | 56.74 | 1310.8 | 11.4/13.9 | 0 |
| sq-pair-b | 63.86 | 57.06 | 1203.1 | 11.4/13.9 | 0 |
| cz-pair-a | 59.30 | 182.46 | 2404.9 | 13.9/23.5 | 1 |
| cz-pair-b | 64.00 | 205.75 | 3376.1 | 13.9/23.1 | 0 |
| sq-quota-2cpu-missing-bus (excluded) | 0.12 | 0.00 | 0.0 | 23.1/23.1 | 1 |
| cz-quota-2cpu-missing-bus (excluded) | 0.12 | 0.00 | 0.0 | 23.1/23.1 | 1 |
| sq-quota-2cpu | 129.95 | 53.71 | 670.4 | 12.5/7.0 | 0 |
| cz-quota-2cpu | 126.03 | 142.40 | 1018.5 | 7.0/3.8 | 0 |
| cz-serial-fixed | 122.96 | 152.57 | 1100.4 | 8.5/6.2 | 0 |
| cz-nice-fixed | 44.40 | 184.61 | 3180.6 | 6.2/11.6 | 0 |

## Excluded trials

- `cz-serial`: Probe setup error: generated packages/cezar/README.md was not copied alongside fresh dist. 69/70 pass, not a valid complete package-suite timing.
- `cz-nice`: Same generated README omission at launch; repaired during run for subsequent trials. Discard this timing because inputs were mutable.
- `sq-quota-2cpu-missing-bus`: Probe environment omitted XDG_RUNTIME_DIR, so systemd could not connect to the user bus; no suite started. Retried with the non-secret user-bus location preserved.
- `cz-quota-2cpu-missing-bus`: Probe environment omitted XDG_RUNTIME_DIR, so systemd could not connect to the user bus; no suite started. Retried with the non-secret user-bus location preserved.
