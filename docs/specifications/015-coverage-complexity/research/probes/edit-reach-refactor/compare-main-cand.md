
every source once, all sources (before 6db9fcb7b, after 963aff844)
| Measure | Before | After | Change |
|---|---|---|---|
| pair-seconds | 3118856 | 2722219 | -12.7% |
| called pair-seconds | 763064 | 757996 | -0.7% |
| called share | 24.5% | 27.8% | |
| kind setup | 17268 | 17268 | 0.0% |
| kind direct | 28566 | 32231 | 12.8% |
| kind helper | 511181 | 979007 | 91.5% |
| kind transitive | 353893 | 756666 | 113.8% |
| kind barrel | 1270516 | 3904 | -99.7% |
| kind declared | 190377 | 191925 | 0.8% |
| kind observed | 612635 | 603154 | -1.5% |
| kind childProcess | 52600 | 55658 | 5.8% |
| kind typeImport | 76114 | 82477 | 8.4% |
| kind typesModule | 5772 | 0 | -100.0% |

every source once, sources at both commits (before 6db9fcb7b, after 963aff844)
| Measure | Before | After | Change |
|---|---|---|---|
| pair-seconds | 3008426 | 2715930 | -9.7% |
| called pair-seconds | 761465 | 757996 | -0.5% |
| called share | 25.3% | 27.9% | |
| kind setup | 17268 | 17268 | 0.0% |
| kind direct | 21982 | 28461 | 29.5% |
| kind helper | 476451 | 976487 | 104.9% |
| kind transitive | 332758 | 756666 | 127.4% |
| kind barrel | 1251209 | 3904 | -99.7% |
| kind declared | 184479 | 191925 | 4.0% |
| kind observed | 592679 | 603154 | 1.8% |
| kind childProcess | 51122 | 55658 | 8.9% |
| kind typeImport | 74770 | 82477 | 10.3% |
| kind typesModule | 5772 | 0 | -100.0% |

real edits, all sources (before 6db9fcb7b, after 963aff844)
| Measure | Before | After | Change |
|---|---|---|---|
| pair-seconds | 198536 | 178661 | -10.0% |
| called pair-seconds | 52309 | 52309 | 0.0% |
| called share | 26.3% | 29.3% | |
| kind barrel | 84848 | 123 | -99.9% |
| kind declared | 11131 | 11266 | 1.2% |
| kind typeImport | 6740 | 6741 | 0.0% |
| kind observed | 41458 | 41471 | 0.0% |
| kind transitive | 20739 | 51282 | 147.3% |
| kind direct | 1302 | 1714 | 31.7% |
| kind helper | 26816 | 60489 | 125.6% |
| kind childProcess | 5504 | 5575 | 1.3% |

real edits, sources at both commits (before 6db9fcb7b, after 963aff844)
| Measure | Before | After | Change |
|---|---|---|---|
| pair-seconds | 193347 | 178661 | -7.6% |
| called pair-seconds | 52309 | 52309 | 0.0% |
| called share | 27.1% | 29.3% | |
| kind barrel | 83693 | 123 | -99.9% |
| kind declared | 11030 | 11266 | 2.1% |
| kind typeImport | 6740 | 6741 | 0.0% |
| kind observed | 41252 | 41471 | 0.5% |
| kind transitive | 19549 | 51282 | 162.3% |
| kind childProcess | 5483 | 5575 | 1.7% |
| kind helper | 24581 | 60489 | 146.1% |
| kind direct | 1021 | 1714 | 67.9% |

called by kind, every source once {
 "before": {
  "direct": "28566 s, 71.9% called",
  "transitive": "353893 s, 29.8% called",
  "barrel": "1270516 s, 31.2% called",
  "typesModule": "5772 s, 0% called",
  "helper": "511181 s, 47% called",
  "setup": "17268 s, 0% called",
  "childProcess": "52600 s, 0% called",
  "observed": "612635 s, 0% called",
  "typeImport": "76114 s, 0% called",
  "declared": "190377 s, 0% called",
  "all": "3118924 s, 24.5% called"
 },
 "after": {
  "direct": "32231 s, 79% called",
  "transitive": "756666 s, 35.1% called",
  "helper": "979007 s, 47.6% called",
  "setup": "17268 s, 0% called",
  "childProcess": "55658 s, 0% called",
  "typeImport": "82477 s, 0.2% called",
  "observed": "603154 s, 0% called",
  "barrel": "3904 s, 19% called",
  "declared": "191925 s, 0% called",
  "all": "2722291 s, 27.8% called"
 }
}
called by kind, real edits {
 "before": {
  "direct": "1302 s, 74.7% called",
  "transitive": "20739 s, 24.4% called",
  "barrel": "84848 s, 39.4% called",
  "typesModule": "0 s, null% called",
  "helper": "26816 s, 48% called",
  "setup": "0 s, null% called",
  "childProcess": "5504 s, 0% called",
  "observed": "41458 s, 0% called",
  "typeImport": "6740 s, 0% called",
  "declared": "11131 s, 0% called",
  "all": "198538 s, 26.3% called"
 },
 "after": {
  "direct": "1714 s, 97.2% called",
  "transitive": "51282 s, 37% called",
  "helper": "60489 s, 52.3% called",
  "setup": "0 s, null% called",
  "childProcess": "5575 s, 0% called",
  "typeImport": "6741 s, 0% called",
  "observed": "41471 s, 0% called",
  "barrel": "123 s, 32.1% called",
  "declared": "11266 s, 0% called",
  "all": "178660 s, 29.3% called"
 }
}

sources only before: 33 (1 real edits); only after: 5
suite: before 1490 files 6205 s; after 1490 files 6205 s
