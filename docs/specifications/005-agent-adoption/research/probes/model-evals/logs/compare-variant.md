| Behaviour | p0 | p1 |
| --- | --- | --- |
| own Vitest run | 0/16 | 4/16 |
| own run after last edit | 0/16 | 3/16 |
| status --wait after last edit | 15/16 | 14/16 |
| sleep | 6/16 | 5/16 |
| skill loaded | 9/16 | 10/16 |
| squeal why | 2/16 | 2/16 |
| run --slow | 13/16 | 13/16 |
| node:test run when scripts edited | 4/8 | 5/8 |
| final claim true | 11/16 | 13/16 |
| final claim false | 2/16 | 3/16 |
| ended green (truth) | 12/16 | 13/16 |
| mean wall s | 65.9 | 80.9 |
| mean status --wait calls | 3.1 | 2.6 |
| mean Squeal pulls | 4.4 | 4.4 |
| mean ms from first FAIL to next action | 5865.5 | 6577.8 |
| mean cost $ (Claude Code), x1000 | 143.7 | 145.1 |
| mean output tokens (Codex) | 1938.0 | 2323.3 |

Repetitions per arm to separate the two arms at these rates (alpha 0.05, power 0.8):
  own Vitest run: 0% vs 25% -> 24
  own run after last edit: 0% vs 19% -> 35
  status --wait after last edit: 94% vs 88% -> 338
  sleep: 38% vs 31% -> 903
  skill loaded: 56% vs 63% -> 966
  squeal why: 13% vs 13% -> no difference observed
  run --slow: 81% vs 81% -> no difference observed
  node:test run when scripts edited: 50% vs 63% -> 244
  final claim true: 69% vs 81% -> 185
  final claim false: 13% vs 19% -> 526
  ended green (truth): 75% vs 81% -> 683
