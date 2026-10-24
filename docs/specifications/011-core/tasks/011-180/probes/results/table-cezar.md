| Run | Worktree | Files | Start (UTC) | Wall, s | Rule B (probe) | Waited for | Event before the end, s | Cut: grace + in flight | Cut s, low to high | Cut files' remainder past the end, s | Next tier after the end, s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1e09718a | 20d1db55 (removed) | 37 | 10-23 13:42:32 | 36.6 | neither | a wait, named file next | 36.9 | 1 + 0 | 0.0 to 7.3 | not all started | 0.9 |
| 3ead9f2d | a6e709c7 (removed) | 4 | 10-23 16:13:42 | 49.7 | remainder | a revision |  | 1 + 1 | 73.6 to 98.6 | 41.6 | 0.7 |
| 79f7a847 | a6e709c7 (removed) | 4 | 10-23 16:24:35 | 134.6 | remainder | a wait, named file next | 1.4 | 1 + 0 | 132.5 to 134.6 | 59.1 | 0.3 |
| 465855ed | 8d98b80f (removed) | 4 | 10-23 16:44:57 | 30.9 | remainder | a revision; a wait | 57.2 | 3 + 0 | 56.4 to 92.6 | 80.1 | 6.0 |
| 2e7ae991 | 8d98b80f (removed) | 4 | 10-23 16:47:23 | 31.3 | overrun at 30 s | a revision |  | 1 + 0 | 0.0 to 31.3 | 281.5 | 265.4 |
| 9c8c963d | a6e709c7 (removed) | 4 | 10-23 16:53:08 | 31.4 | overrun at 30 s | a revision; a wait | 17.4 | 1 + 0 | 16.8 to 31.4 | 128.2 | 8.5 |
| 9077a52a | 8d98b80f (removed) | 4 | 10-23 16:53:32 | 31.1 | overrun at 30 s | a wait that named 1 cut file | 58.1 | 1 + 0 | 0.0 to 31.1 | 281.6 | 201.4 |
| c27dc6ca | a6e709c7 (removed) | 4 | 10-23 16:57:21 | 72.5 | overrun | a wait, named file next | 3.0 | 1 + 0 | 66.3 to 72.5 | 87.1 | 0.6 |
| ec8e900c | 8d98b80f (removed) | 4 | 10-23 16:57:25 | 31.0 | overrun at 30 s | a revision; a wait that named 1 cut file | 40.9 | 1 + 0 | 0.0 to 31.0 | 281.7 | 0.6 |
| 0196b2db | a6e709c7 (removed) | 4 | 10-23 16:58:34 | 143.8 | remainder | a wait that named 2 cut files | 2.0 | 2 + 0 | 269.2 to 287.6 | 396.4 | 0.7 |
| d2054886 | d15de12f (removed) | 4 | 10-23 17:08:45 | 36.9 | neither | a wait, named file next | 5.2 | 1 + 0 | 21.3 to 32.5 | -4.5 | 3.5 |
| 8bf747ac | 8d98b80f (removed) | 4 | 10-23 17:09:14 | 58.9 | remainder | a revision |  | 1 + 0 | 53.0 to 58.8 | -0.1 | 0.6 |
| d08d705d | 564fa151 (removed) | 4 | 10-23 17:10:14 | 98.9 | overrun | a revision; a wait | 11.8 | 1 + 0 | 76.4 to 98.9 | no later run | 1579.4 |
| 06c55d2f | 5e76f9b0 (removed) | 4 | 10-23 17:46:25 | 351.0 | remainder | a wait that named 1 cut file | 5.9 | 0 + 1 | 332.4 to 351.0 | 62.9 | 0.9 |
| 0de48a6a | 700e10dd (removed) | 4 | 10-23 17:46:25 | 81.3 | remainder | a wait, named file next | 45.7 | 1 + 2 | 204.9 to 243.9 | 96.0 | 0.8 |
| 0f9db7cc | 5e76f9b0 (removed) | 4 | 10-23 17:52:16 | 261.6 | remainder | a wait that named 2 cut files | 5.0 | 1 + 1 | 500.7 to 523.1 | 159.2 | 0.7 |
| 9a9f3b34 | d15de12f (removed) | 4 | 10-23 18:10:28 | 309.5 | remainder | a wait, named file next | 34.2 | 1 + 0 | 306.0 to 309.5 | 66.5 | 0.9 |
| 4be9a483 | 8d98b80f (removed) | 4 | 10-23 18:23:50 | 28.3 | remainder | a revision; a wait | -0.2 | 2 + 1 | 61.3 to 84.9 | 48.4 | 3.0 |
| 7ef80fd1 | a6e709c7 (removed) | 4 | 10-23 18:36:08 | 20.3 | remainder | a revision; a wait that named 2 cut files | 7.6 | 2 + 0 | 29.5 to 40.6 | 8.8 | 0.4 |
| 4f874ee9 | 8d98b80f (removed) | 4 | 10-23 18:38:54 | 199.3 | neither | no revision, no wait found |  | 1 + 0 | 197.4 to 199.3 | 43.9 | 0.6 |
| 9074c84b | 8d98b80f (removed) | 4 | 10-23 18:42:51 | 168.4 | remainder | no revision, no wait found |  | 3 + 0 | 494.5 to 505.3 | 89.8 | 0.4 |
| ccbb872d | bcf1abf6 (live) | 4 | 10-23 18:44:13 | 185.4 | remainder | a wait, named file next | 2.9 | 2 + 0 | 356.9 to 370.9 | 40.6 | 0.4 |
| dd2b498a | 8d98b80f (removed) | 4 | 10-23 18:46:46 | 285.9 | remainder | no revision, no wait found |  | 1 + 0 | 281.2 to 285.9 | 222.8 | 0.7 |
| 155bf309 | bcf1abf6 (live) | 1 | 10-23 18:54:13 | 9.1 | remainder | r21; a wait, named file next | 17.6 | 0 + 0 | 0.0 to 0.0 | none cut | 0.2 |
| fa2ca271 | bcf1abf6 (live) | 4 | 10-23 18:57:33 | 2.5 | remainder | a wait that named 1 cut file | 19.3 | 3 + 0 | 0.0 to 7.4 | not all started | 0.2 |
| 8c5addea | bcf1abf6 (live) | 1 | 10-23 19:05:47 | 9.8 | remainder | a wait that named 1 cut file | 3.3 | 1 + 0 | 7.4 to 9.8 | 176.1 | 0.4 |
| 4688bfd5 | bcf1abf6 (live) | 2 | 10-23 19:14:04 | 27.0 | remainder | a wait that named 1 cut file | 4.7 | 2 + 0 | 43.3 to 53.9 | 210.0 | 0.2 |
| 77d77da1 | 8d98b80f (removed) | 4 | 10-23 19:16:20 | 153.5 | remainder | no revision, no wait found |  | 0 + 1 | 146.3 to 153.5 | 117.5 | 0.5 |
| adde770c | 8d98b80f (removed) | 4 | 10-23 19:25:27 | 120.0 | remainder | a revision |  | 1 + 0 | 117.1 to 120.0 | 33.1 | 4.3 |
| 8df3c6fc | 8d98b80f (removed) | 4 | 10-23 19:27:36 | 12.5 | remainder | a wait that named 2 cut files | 2.0 | 3 + 0 | 31.0 to 37.4 | 30.7 | 34.0 |
| b3a5fed9 | 8d98b80f (removed) | 200 | 10-23 20:00:16 | 33.7 | overrun | a revision; a wait | 38.6 | 2 + 0 | 0.0 to 1.9 | not all started | 47.2 |
| 19ffa47b | a6e709c7 (removed) | 4 | 10-23 20:01:55 | 92.4 | remainder | a revision |  | 2 + 0 | 168.5 to 156.7 | 60.2 | 4.5 |
| 108b2064 | 8d98b80f (removed) | 23 | 10-23 20:12:41 | 54.0 | overrun | no revision, no wait found |  | 3 + 0 | 13.1 to 44.0 | not all started | 0.4 |
| a3eb96f0 | bcf1abf6 (live) | 4 | 10-23 21:22:05 | 92.2 | remainder | a wait that named 1 cut file | 4.1 | 3 + 0 | 257.1 to 254.9 | 220.2 | 0.4 |
| 55e9db01 | 8d98b80f (removed) | 9 | 10-23 21:33:42 | 64.6 | overrun | a wait | 54.6 | 3 + 0 | 88.9 to 84.8 | not all started | 0.5 |
| 372745be | 8d98b80f (removed) | 3 | 10-23 21:48:04 | 93.8 | overrun | no revision, no wait found |  | 1 + 0 | 35.8 to 59.3 | -34.5 | 0.6 |
| 7781e596 | 3a40e85f (removed) | 139 | 10-23 22:24:25 | 71.2 | overrun | no revision, no wait found |  | 3 + 0 | 5.2 to 11.1 | not all started | 1.6 |
| 7ee84410 | 8d98b80f (removed) | 2 | 10-23 22:26:50 | 320.4 | overrun | a wait | 2.4 | 0 + 1 | 311.9 to 320.4 | 33.5 | 0.9 |
| 0da0178f | bcf1abf6 (live) | 4 | 10-23 22:39:18 | 56.7 | remainder | a wait that named 1 cut file | 2.1 | 2 + 1 | 151.9 to 170.1 | 96.2 | 0.7 |
| b778f4e4 | 3a40e85f (removed) | 6 | 10-23 22:51:36 | 61.9 | overrun | no revision, no wait found |  | 2 + 0 | 22.2 to 72.1 | not all started | 0.7 |
| 78b13ae2 | 3a40e85f (removed) | 6 | 10-23 22:56:27 | 93.6 | overrun | a revision |  | 5 + 0 | 351.0 to 353.3 | 9.2 | 1031.3 |
| 7a73f4dd | 3a40e85f (removed) | 11 | 10-23 23:28:02 | 59.8 | overrun | no revision, no wait found |  | 1 + 1 | 64.4 to 36.4 | not all started | 0.7 |
| 064d17a3 | bcf1abf6 (live) | 4 | 10-24 06:26:30 | 132.9 | remainder | r56 | 6.8 | 4 + 0 | 507.7 to 531.5 | 117.2 | 43.4 |
| 7f12c3e8 | bcf1abf6 (live) | 4 | 10-24 06:34:25 | 96.5 | remainder | no revision, no wait found |  | 2 + 0 | 183.3 to 192.9 | 194.5 | 0.4 |
| 63ff0ecf | bcf1abf6 (live) | 9 | 10-24 06:40:59 | 45.0 | remainder | no revision, no wait found |  | 6 + 0 | 252.7 to 269.8 | 401.5 | 0.5 |
| 4c29626b | bcf1abf6 (live) | 4 | 10-24 10:11:01 | 65.8 | remainder | a wait that named 1 cut file | 0.7 | 3 + 0 | 189.9 to 197.4 | 116.2 | 0.3 |
| 3142c25d | d3b6399f (live) | 4 | 10-24 10:52:22 | 59.7 | overrun | a wait that named 1 cut file | 4.9 | 0 + 2 | 18.6 to 65.7 | not all started | 0.6 |
| 03e1d628 | d3b6399f (live) | 4 | 10-24 10:53:23 | 120.5 | overrun | r6 | 26.5 | 0 + 1 | 42.6 to 74.8 | -45.7 | 18.3 |
| 77bc2a49 | d3b6399f (live) | 4 | 10-24 10:55:41 | 57.3 | overrun | r8; a wait, named file next | 33.4 | 1 + 1 | 62.6 to 17.1 | not all started | 0.8 |
| 31997ecb | d3b6399f (live) | 3 | 10-24 10:58:58 | 13.4 | neither | r11 | 3.0 | 1 + 0 | 9.0 to 13.4 | 5.6 | 1.4 |
| c46b73ff | b7555ac0 (live) | 4 | 10-24 11:07:59 | 165.2 | overrun | a wait that named 3 cut files | 4.9 | 0 + 4 | 541.3 to 660.9 | 480.5 | 1.1 |
| 7c46709b | 87db4ccb (live) | 4 | 10-24 11:08:01 | 226.5 | overrun | a wait that named 1 cut file | 4.9 | 1 + 0 | 191.3 to 201.9 | -24.6 | 2.4 |
| 1e292ecc | 87db4ccb (live) | 4 | 10-24 11:12:41 | 72.5 | overrun | a wait, named file next | 3.3 | 2 + 0 | 63.3 to 127.5 | -4.0 | 1.2 |
| 48a776e6 | 48f74c52 (live) | 4 | 10-24 11:19:40 | 35.9 | remainder | r8; a wait, named file next | 10.0 | 0 + 0 | 0.0 to 0.0 | none cut | 0.4 |
| 9178590d | 48f74c52 (live) | 2 | 10-24 11:34:35 | 125.7 | overrun | a wait, named file next | 3.6 | 1 + 0 | 121.0 to 125.7 | 22.6 | 1.3 |
