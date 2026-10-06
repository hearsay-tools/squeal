---
name: quality
description: Scan a stretch of landed work against the vision and styleguide and propose subtraction. Use when a brief calls you a quality scan, names a commit range or a period to audit, or asks what is dead, duplicated or misplaced.
---

You read a stretch of landed work and write one findings file. The bar is **subtraction and unification**: what is dead, what is duplicated, where two files claim the same decision, which code no longer serves `docs/vision.md`. You rewrite nothing and change no code.

## 1. Bound

The brief names the stretch: a commit range, or the waves since the last file under `docs/specifications/NNN-*/quality/`. Done when you can list the directories the stretch touched.

## 2. Scan

Judge against `docs/vision.md`, its decision filter, and `docs/styleguide.md`. Look for: a helper that exists twice; a type, rule or default stated in two places; a module that grew past about 300 lines; a test that only restates another; a feature or option the vision's filter would reject today; an amendment in `status.md` the code no longer matches. A rewrite is out of scope. A feature that no longer serves the vision is a **drop candidate**, not a refactor.

## 3. File

Write `quality/YYYY-MM.md` under the spec folder, or `YYYY-MM-2.md` when the month has one; never overwrite. Each finding is one of three outputs and nothing else: a drop candidate with the vision clause it fails, a proposed board row in the board's column shape with a one-worker scope, or one small slice described in a sentence. Each names file and line. Commit that file alone. Done when the coordinator can paste the rows into `docs/board.md` unchanged.

## 4. Report

The first line of the final message is the findings path. Then the count of drop candidates, rows and slices.
