# Problem log (Zadaci) + Tracker archive — plan (2026-11-08)

Decisions: one log in LearnHarness for every problem from every source · Matematika Tracker is ONLY a read-only problem archive (its attempts/cards/status are never used or changed) · the teacher logs problems through a tool and the learner can add/edit by hand · re-solve dates come from the outcome and can be changed · a new Zadaci page with a sidebar count.

## What a log entry is

| Field | Example |
|---|---|
| Category | **Matematika — škola** · **Matematika — takmičenja** · **Fizika** (the three defaults; you can add, rename or remove your own) |
| Source | Thomas' Calculus · Zbirka 4. razred · EGMO · MONT · Schaum's · URS Predić · Tracker (DMS) · other |
| Reference | "3.4 / 17", "Okružno 2019/20 · 4A · z3", "EGMO 4.12" |
| Branch | Algebra / Analiza / Geometrija / Kombinatorika / Teorija brojeva / Verovatnoća / Fizika / … |
| Course | the session it was worked in (optional) |
| Attempts | each: date, outcome, minutes, note |
| Next re-solve | a date or none |

**Outcomes:** sam, čisto · sam, sporo/nesigurno · uz hint · pročitao rešenje · nerešeno (odustao).

**Re-solve schedule** (from the latest attempt; editable): pročitao rešenje / nerešeno → 3 days · uz hint → 7 days · sam, sporo → 21 days · sam, čisto → none (a clean re-solve retires it). The learner can flag/unflag or set any date.

## How entries get in

- **Teacher tool `log_problem`** (teacher and practice agents): when the learner reports a problem ("rešio sam Thomas 3.4/17 sam za 25 min") or after grading a photographed solution, the teacher records source, reference, branch, outcome, minutes and a one-line note. Re-attempts of the same reference add an attempt to the same entry.
- **By hand** on the Zadaci page: quick add form; every field editable; delete.
- **From the Tracker archive:** "Zabeleži pokušaj" on an archive problem pre-fills source and reference.

## Tracker archive (read-only)

- Read live from `%APPDATA%\rs.matematika.tracker\matematika-tracker.sqlite3` in read-only mode, plus its problem images and the DMS PDFs.
- **Arhiva** tab on the Zadaci page: filter by round (opštinsko … izborno), category (A/B), grade, branch, school year; each problem shows its image; **Rešenje** shows the official solution pages from the DMS PDF (rendered in the app); shows whether it's already in your log.
- "Pošalji u sesiju": open a practice session with that problem attached, or copy it into the current one.

## Zadaci page

- Sidebar entry **Zadaci** with the count due for re-solving today.
- A **category switch** at the top (Sve · Matematika — škola · Matematika — takmičenja · Fizika · your own), applied to every tab and count.
- Tabs: **Za ponovno rešavanje** (due today/overdue, then upcoming) · **Sve** (filter by source / branch / outcome / course, search by reference) · **Arhiva** (Tracker).
- Counts per category, source and branch (solved alone vs with help) at the top.
- Category defaults: Tracker and URS Predić problems → takmičenja; Schaum's → Fizika; the teacher picks from the course (and you can change any entry, or set a default category per course).
- The stats page gets "zadaci rešeni" per day/week/month.

## Order of work

Core (entries, schedule, tests) → teacher tool + doctrine → Zadaci page + sidebar → Tracker archive reader + Arhiva tab + solution pages → stats line → review → build → backup → install. Mockups for the Zadaci page and Arhiva tab first, as usual.
