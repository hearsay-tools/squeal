# Medians per case (seconds), from summary.mjs

Stages as in README.md. A negative delivery means the wait returned before the edited file's result. Lookup samples have no run; their result time is when the poller saw the file current, up to a poll late.

| repo | case | sample | n | load | watcher | runnerPart | queueWait | tierStart | run | record | delivery | resultAfterEdit | waitReturned | dominant | wait outcomes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| squeal | (b) baseline | run, news | 2 | 27 to 28 | 0.4 | 0.2 | 2.0 | 0.0 | 1.7 | 0.2 | 0.1 | 4.6 | 4.7 | queueWait | news 2 |
| squeal | (b) baseline | run, no news | 1 | 27 to 27 | 0.5 | 0.3 | 1.2 | 0.0 | 4.1 | 0.1 | 345.3 | 6.2 | 351.5 | delivery | quiet 1 |
| squeal | (a) idle | lookup | 4 | 147 to 166 | 0.3 | 0.4 | - | - | - | - | 0.3 | 0.7 | 1.0 | runnerPart | quiet (before the edit's revision) 1, news 3 |
| squeal | (a) idle | run, no news | 3 | 152 to 166 | 0.4 | 0.2 | -0.0 | 0.2 | 0.8 | 0.1 | 0.6 | 1.9 | 2.4 | run | quiet 3 |
| squeal | (a) idle | run, news | 3 | 149 to 166 | 0.3 | 0.3 | -0.0 | 0.3 | 0.6 | 0.1 | 0.6 | 1.8 | 2.5 | delivery | news 3 |
| squeal | (c) run --all --force | run, news | 3 | 122 to 127 | 0.2 | 0.2 | 2.1 | 0.3 | 0.8 | 0.1 | 0.5 | 3.7 | 4.2 | queueWait | news 3 |
| squeal | (c) run --all --force | lookup | 3 | 123 to 124 | 0.4 | 0.6 | - | - | - | - | 0.2 | 0.9 | 1.1 | runnerPart | news 3 |
| squeal | (c) run --all --force | run, no news | 1 | 128 to 128 | 0.3 | 0.4 | 4.3 | 0.3 | 0.8 | 0.1 | 0.7 | 6.2 | 6.9 | queueWait | quiet 1 |
| squeal | (c) config-edit backlog | run, news | 4 | 73 to 91 | 0.2 | 0.1 | 4.4 | 0.1 | 4.0 | 0.3 | -1.8 | 9.3 | 6.6 | queueWait | news 4 |
| squeal | (c) config-edit backlog | lookup | 2 | 59 to 73 | 0.2 | 0.1 | - | - | - | - | 0.2 | 0.3 | 0.5 | watcher | news 2 |
| squeal | (c) config-edit backlog | run, no news | 1 | 59 to 59 | 0.2 | 0.1 | 1.5 | 0.0 | 0.2 | 0.1 | -0.3 | 2.1 | 1.8 | queueWait | news 1 |
| squeal | (d) slow file | run, news | 2 | 73 to 75 | 1.4 | 0.3 | -0.0 | 0.1 | 0.5 | 0.1 | -0.5 | 2.3 | 1.7 | watcher | news 1, quiet (before the edit's revision) 1 |
| squeal | (d) slow file | lookup | 2 | 73 to 75 | 0.3 | 0.2 | - | - | - | - | 0.2 | 0.5 | 0.7 | watcher | news 2 |
| squeal | (d) slow file | run, no news | 1 | 75 to 75 | 0.3 | 0.2 | -0.0 | 0.3 | 0.3 | 0.1 | 98.5 | 1.1 | 99.6 | delivery | quiet 1 |
| squeal | (a) idle +8 burners | run, news | 3 | 63 to 68 | 0.3 | 0.1 | -0.0 | 0.1 | 0.3 | 0.1 | 0.3 | 1.0 | 1.4 | delivery | news 3 |
| squeal | (a) idle +8 burners | lookup | 3 | 63 to 69 | 0.4 | 0.2 | - | - | - | - | 0.4 | 0.6 | 1.0 | delivery | news 3 |
| squeal | (a) idle +8 burners | run, no news | 3 | 63 to 69 | 0.2 | 0.2 | -0.0 | 0.1 | 0.6 | 0.0 | 0.5 | 1.3 | 1.8 | run | quiet 3 |
| cezar | (b) baseline | run, news | 7 | 32 to 75 | 0.5 | 1.2 | 1.1 | 0.1 | 3.7 | 0.0 | 0.2 | 6.8 | 7.1 | run | news 7 |
| cezar | (b) baseline | lookup | 5 | 31 to 52 | 0.6 | 1.6 | - | - | - | - | -1.1 | 2.2 | 1.1 | runnerPart | news 5 |
| cezar | (b) baseline | run, no news | 1 | 32 to 32 | 0.5 | 1.8 | 0.1 | 0.4 | 186.7 | 0.1 | 189.8 | 189.6 | 379.3 | delivery | news 1 |
| cezar | (a) idle | run, news | 3 | 103 to 120 | 0.5 | 3.3 | 0.0 | 1.3 | 3.6 | 0.2 | -6.6 | 8.3 | 2.3 | run | quiet (before the edit's revision) 2, news 1 |
| cezar | (a) idle | lookup | 3 | 105 to 117 | 0.6 | 3.6 | - | - | - | - | -1.9 | 4.1 | 2.2 | runnerPart | news 1, quiet (before the edit's revision) 2 |
| cezar | (a) idle | run, no news | 3 | 103 to 112 | 0.6 | 2.5 | -0.0 | 0.7 | 4.7 | 0.1 | -5.4 | 9.8 | 2.2 | run | quiet 1, quiet (before the edit's revision) 2 |
| cezar | (a) idle +8 burners | run, news | 3 | 99 to 105 | 1.2 | 3.2 | -0.0 | 1.1 | 4.4 | 0.2 | -6.7 | 8.8 | 2.7 | run | quiet (before the edit's revision) 3 |
| cezar | (a) idle +8 burners | lookup | 3 | 98 to 106 | 0.6 | 3.8 | - | - | - | - | -1.2 | 4.4 | 2.1 | runnerPart | quiet (before the edit's revision) 3 |
| cezar | (a) idle +8 burners | run, no news | 3 | 95 to 105 | 0.7 | 2.7 | -0.0 | 0.9 | 4.1 | 0.1 | -5.6 | 7.9 | 2.1 | run | quiet (before the edit's revision) 3 |
| cezar | (d) slow file | run, news | 2 | 62 to 71 | 0.8 | 3.1 | -0.0 | 0.7 | 3.2 | 0.1 | -1.6 | 8.0 | 6.3 | runnerPart | news 1, quiet (before the edit's revision) 1 |
| cezar | (d) slow file | lookup | 2 | 66 to 67 | 0.7 | 2.8 | - | - | - | - | -0.4 | 3.5 | 3.1 | runnerPart | news 1, quiet (before the edit's revision) 1 |
| cezar | (d) slow file | run, no news | 2 | 67 to 69 | 0.6 | 2.8 | 0.4 | 0.5 | 3.0 | 0.2 | 285.4 | 7.5 | 292.9 | delivery | news 1, quiet 1 |
| cezar | (c) config-edit backlog | run, news | 4 | 55 to 85 | 1.3 | 3.3 | 1.2 | 0.4 | 16.6 | 0.1 | 1.7 | 23.1 | 25.1 | run | news 4 |
| cezar | (c) config-edit backlog | lookup | 2 | 76 to 81 | 0.9 | 8.2 | - | - | - | - | -5.9 | 9.1 | 3.2 | runnerPart | news 2 |
| cezar | (c) config-edit backlog | run, no news | 1 | 81 to 81 | 1.6 | 2.8 | 0.5 | 0.3 | 1.7 | 0.1 | 316.8 | 7.0 | 323.8 | delivery | news 1 |
