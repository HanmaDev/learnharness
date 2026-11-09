# Teacher: manage Zadaci, plan problems, make cards — plan (2026-11-09)

Why: in the Funkcije session the learner asked the teacher to delete the scheduled re-solves, put not-yet-done problems on those dates instead, and turn the tricks into cards. The teacher could only log attempts (`log_problem`), so it refused and told the learner to do it by hand. Its final turn also made no tool calls at all (62 `send_to_user` calls before it, none in that 90 s turn), and it said "the display tool doesn't work any more".

Decision (learner, 2026-11-09): cards the teacher makes go straight into the course's deck; the learner can delete or pause them in Kartice.

## 1. Problem log tools (teacher + practice)

- `problem_log_list`: the learner's Zadaci entries, with id, reference, source, category, last outcome and next date. Filters: this course, category, scheduled only, search. This lets the teacher see what is scheduled before changing it.
- `problem_log_edit`: one tool with an `action`. It does what the Zadaci page can do, only when the learner asks:
  - `schedule`: set a date, turn re-solving off, or return it to automatic;
  - `delete`: remove the entry and its attempts;
  - `plan`: add a problem the learner has NOT attempted yet, with a date. It shows in "Za ponovno rešavanje" on that date, with no attempt.
- A planned problem becomes an ordinary entry when its first attempt is logged. Its date then follows the outcome rule.
- Doctrine: the teacher acts on the learner's instructions about Zadaci, lists what it changed, and never deletes on its own initiative.

## 2. Teacher cards (teacher + practice)

- `make_cards`: 1 to 20 cards for this course's deck, each with a front (question or situation), a back (answer or trick) and the plan step it belongs to. They go straight in as new cards, made like "Nova pitanja" cards, and the teacher lists them in chat.
- Doctrine: make cards when the learner asks, or offer them after a trick is learned.

## 3. A turn without tools never happens silently

- Claude Code reports at startup whether the LearnHarness tool bridge connected. If it did not, the turn retries once, then fails with a clear message. It never answers without tools.

## Order

1. Tools 1 and 2, plus doctrine and tests.
2. The bridge check (3), plus a test.
3. Full test suite, then the reviewer subagent.
4. Build, back up, install. I ask before closing the app.
