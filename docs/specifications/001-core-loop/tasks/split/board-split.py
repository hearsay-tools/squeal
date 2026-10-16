#!/usr/bin/env python3
"""Split the board for the 001 split (split-proposal.md, section 6 steps 4 and 5).

Re-runnable only on a board that still has the 001 section: it moves the 001
rows to `../../board-archive.md`, keeps the open ones on the board under
Feature 011 and Feature 003 with their numbers, re-prefixes 001's Later items,
and adds the `## Triage` section from the rows in `triage/gh-*.row`.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
BOARD = ROOT / "docs" / "board.md"
ARCHIVE = ROOT / "docs" / "specifications" / "001-core-loop" / "board-archive.md"
TRIAGE = HERE / "triage"
DATE = "2026-10-17"

OPEN_011 = [338, 341, 342, 346, 358, 359, 364, 366, 373, 379, 380, 381, 383, 391, 397, 431, 433, 435, 436]
OPEN_003 = [365, 402, 425]
OPEN_STATUS = re.compile(r"^\| 001-(\d+)[^|]*\| (planned|running|review)\b")
ROW = re.compile(r"^\| 001-(\d+) ")

lines = BOARD.read_text().split("\n")


def index(heading: str) -> int:
    hits = [i for i, l in enumerate(lines) if l == heading]
    assert len(hits) == 1, (heading, hits)
    return hits[0]


# ---------------------------------------------------------------- status line
i = index("Status values: `planned`, `running`, `review`, `done`, `dropped`.")
lines[i] = ("Status values: `planned`, `running`, `review`, `done`, `dropped`; `proposed` for a triage or research row that "
            "awaits the human's decision and authorizes nothing (`docs/process.md`, Issue triage).")

# ---------------------------------------------------------------- 001 section
i001 = index("## Feature 001: core validation loop")
i002 = index("## Feature 002: Codex adapter")
sec = lines[i001:i002]
open_rows: dict[int, str] = {}
kept: list[str] = []
for l in sec:
    m = ROW.match(l)
    n = int(m.group(1)) if m else None
    if n in OPEN_011 or n in OPEN_003:
        assert OPEN_STATUS.match(l), l[:80]
        assert n not in open_rows, n
        open_rows[n] = l
    else:
        assert not OPEN_STATUS.match(l), f"open 001 row not in the lists: {l[:80]}"
        kept.append(l)
assert sorted(open_rows) == sorted(OPEN_011 + OPEN_003), sorted(set(OPEN_011 + OPEN_003) - set(open_rows))
while kept and kept[-1] == "":
    kept.pop()

archive = [
    "# Board archive: Feature 001 rows",
    "",
    f"Moved verbatim from `docs/board.md` on {DATE} by the 001 split (`split-proposal.md`, section 6 step 4), wave by wave as the board had them. "
    f"The rows open at the split are not here: with their numbers kept they are on the board under `## Feature 011: core` ({', '.join(f'001-{n}' for n in OPEN_011)}) "
    f"and `## Feature 003: node:test runner` ({', '.join(f'001-{n}' for n in OPEN_003)}; decision Q6). "
    "A `001-NNN` number is permanent and resolves here or there; new rows take `011-NN`, `012-NN` or `013-NN`.",
    "",
] + kept + [""]
ARCHIVE.write_text("\n".join(archive))

stub = [
    "## Feature 001: core validation loop (archived)",
    "",
    f"Spec: `specifications/001-core-loop/spec.md`, frozen {DATE} as history; its {sum(1 for l in kept if ROW.match(l))} closed rows are in "
    "`specifications/001-core-loop/board-archive.md`. Its subsystems continue as Feature 011 (core), 012 (Claude Code adapter) and 013 (Vitest runner) below; "
    "the decisions behind the split are in `specifications/001-core-loop/split-proposal.md`.",
    "",
]
lines[i001:i002] = stub

# ---------------------------------------------------------------- 003 gains Q6 rows
i004 = index("## Feature 004: slow suites by policy")
insert = [
    f"### Rows moved from 001 ({DATE}, split proposal Q6; numbers kept)",
    "",
    "| Task | Status | Scope | Done when |",
    "|---|---|---|---|",
] + [open_rows[n] for n in OPEN_003] + [""]
lines[i004:i004] = insert

# ---------------------------------------------------------------- 011, 012, 013 sections
ilater = index("## Later")
new = [
    "## Feature 011: core",
    "",
    "Spec: `specifications/011-core/spec.md`. Sections referenced as C1 to C14; a 001 D-number resolves through the crosswalk at its end. "
    f"The rows below kept their 001 numbers at the split ({DATE}); new rows take `011-NN`, allocated from the board on main by the coordinator who lands them. "
    "A row is a bounded change ticket, never an authorization: it is dispatched only when the human has approved it (split proposal, section 7).",
    "",
    "### Open rows inherited from 001",
    "",
    "| Task | Status | Scope | Done when |",
    "|---|---|---|---|",
] + [open_rows[n] for n in OPEN_011] + [
    "",
    "## Feature 012: Claude Code adapter",
    "",
    "Spec: `specifications/012-claude-code-adapter/spec.md`. Sections referenced as CC1 to CC4; the hook contract is 011 C8. "
    "No row was open at the split; new rows take `012-NN`. Candidates, none authorized: the Later items prefixed 012 and the spec's Known seams.",
    "",
    "## Feature 013: Vitest runner",
    "",
    "Spec: `specifications/013-vitest-runner/spec.md`. Sections referenced as V1 to V10. "
    "No row was open at the split; new rows take `013-NN`. Candidates, none authorized: the spec's Known seams.",
    "",
]
lines[ilater:ilater] = new

# ---------------------------------------------------------------- Later prefixes
LATER = {
    "- 001: a SubagentStop report restarts the subagent": "- 012: a SubagentStop report restarts the subagent",
    "- 001: `squeal` is not on a user's PATH": "- 005 (from 001): `squeal` is not on a user's PATH",
    "- 001: `store.prune` removes": "- 011: `store.prune` removes",
    "- 001: the e2e suite leaves": "- 011: the e2e suite leaves",
    "- Load-sensitive tests seen failing under load only (001's):": "- 011: load-sensitive tests seen failing under load only (001's; `stop.test.ts` is the hook contract's, C8):",
    "- `squeal init` with a harness choice": "- 012 and 005: `squeal init` with a harness choice",
    "- `test/daemon/unused-stop.test.ts` (001-415)": "- 011: `test/daemon/unused-stop.test.ts` (001-415)",
}
ilater = index("## Later")
for old, newp in LATER.items():
    hits = [i for i in range(ilater, len(lines)) if lines[i].startswith(old)]
    assert len(hits) == 1, (old, hits)
    lines[hits[0]] = newp + lines[hits[0]][len(old):]
assert not any(l.startswith("- 001:") for l in lines[ilater:]), "a 001 Later item kept its prefix"

# ---------------------------------------------------------------- Triage
SPEC_OF = {"6": "005", "12": "004"}
rows = []
for f in sorted(TRIAGE.glob("gh-*.row"), key=lambda p: int(p.stem.split("-")[1])):
    n = f.stem.split("-")[1]
    l = f.read_text().rstrip("\n")
    assert l.count("\n") == 0 and l.count("|") == 5, f
    m = re.match(r"^\| (001-43[345]|004-64|005-67) (.*)$", l)
    assert m, l[:60]
    cells = m.group(2).split(" | ")
    assert len(cells) == 4 and cells[1].startswith("planned"), f
    cells[1] = "proposed" + cells[1][len("planned"):]
    spec = SPEC_OF.get(n, "011 (the row says 001)")
    cells[2] = f"Spec {spec}. " + cells[2]
    rows.append(f"| gh-{n} " + " | ".join(cells))
i001 = index("## Feature 001: core validation loop (archived)")
triage = [
    "## Triage",
    "",
    "Issue rows awaiting the human's decision (`docs/process.md`, Issue triage). A row is keyed `gh-<issue>`, status `proposed`, and gets a spec number only when "
    "the human approves it and a coordinator moves it into that spec's section with a number from the board on main. Research and probes stay where the triage "
    "session wrote them, `specifications/<spec>/research/issue-<N>*.md` and `research/probes/issue-<N>*/`; a bare `research/` path in a row is under that spec's folder. "
    f"The rows below landed on {DATE} from the triage branches of 2026-10-16 with their colliding numbers replaced (split proposal Q8).",
    "",
    "| Task | Status | Scope | Done when |",
    "|---|---|---|---|",
] + rows + [""]
lines[i001:i001] = triage

BOARD.write_text("\n".join(lines))
print(f"archive: {len(archive)} lines, {sum(1 for l in kept if ROW.match(l))} closed rows; board: {len(lines)} lines; triage rows: {len(rows)}")
