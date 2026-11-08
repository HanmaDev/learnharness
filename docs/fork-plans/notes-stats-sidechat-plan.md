# Notes, statistics and side chats — plan (draft, 2026-11-08)

Status: draft for the owner's decisions. Nothing is built yet.

## What other forks did (964 forks, 72 with real work)

All checked forks are AGPL-3.0 like upstream, so code can be borrowed as long as this fork stays AGPL.

| Idea | Closest prior work | Verdict |
|---|---|---|
| Topic notes per lesson, by plan node | brunovskyoliver "study notes" (copies the lesson prose in order, no model; sits on a big Tiptap library), BC-GB lesson outline (AI groups plan nodes into sections), 1509Chamma Obsidian export + "Covered / Struggled / Next" recaps | Nobody built it. We build our own; borrow the recap idea. |
| Learning statistics | Upstream PR #272 (active study time, Today / Week / Total, 52-week grid); socrates (weekly bars, gentle streak, calibration, weak spots); bbMisk (per-question learning-event log) | Nobody has the full dashboard. We build it from data we already store (answers, plan_progress, card reviews), plus PR #272's active-time idea. |
| Side chats in a session | Upstream PR #451 (`/btw` or select text → side agent sees the lesson read-only, hides the open question's answer key, thread invisible to the tutor, reopenable pills) | Solved well. Port its design, adapted to our code. |

Other fork features worth a later look (ranked for exam prep): mock exam mode (socrates), mistake log with error analysis (vvcdev), cram mode (bbMisk), weak spots + drill and confidence calibration (socrates), course-material page ranges (vvcdev), warm-up recall at session start (socrates), session recaps (1509Chamma).

## 1. Topic notes

- One notes document per course, with one section per plan step, in plan order.
- Each section holds what was actually taught for that step: explanations, the key definitions, worked examples, code, and the questions with their answers.
- Written by the model from the lesson transcript, after a step is taught (and refreshed when the step gets more teaching later). Not shown to the teacher, so it never changes the lesson.
- In the app: a "Beleške" (notes) view per course with a step list on the left; clicking a step in the plan view jumps to its section. Each card in Kartice links to its step's section.
- On disk: the same content as a `.md` file per course.
- Serbian Latin like everything learner-facing.

Open decisions: who writes the notes, where the file goes, how often it refreshes.

## 2. Learning statistics

- A "Statistika" view: today / this week / this month / all time, per course and in total.
- Numbers: study time, steps finished, questions answered and accuracy, cards reviewed and recall rate, new cards, streak (days in a row with any study).
- Charts: daily bars for the last 30 days, a calendar heat map, accuracy per step (weak spots), confidence vs accuracy (calibration).
- Data: computed from what is already stored (chat answers with time and correctness, plan_progress marks, card reviews). Study time today uses message gaps of 15 min or less; PR #272 measures active window time instead.

Open decisions: how study time is measured, which charts matter.

## 3. Side chats

- A "Pitaj sa strane" (ask on the side) button and `/btw` in the composer, plus "Ask about this" on selected teacher text.
- Opens a side panel thread. A separate agent answers with the current session as read-only context (plan, recent lesson, open question without its answer key).
- The thread is stored apart from the lesson: the teacher never sees it, extraction and the knowledge graph skip it, Kartice and practice ignore it.
- Runs in parallel: the main lesson can keep streaming while the side answer comes in.
- Closed threads stay as small reopenable tabs in the session.

Open decisions: which model answers, whether a side thread can ever be turned into notes or cards.

## Order of work (after approval)

Each feature: plan → mockup (Codex) → approval → build → tests → Codex visual review → reviewer pass → build, backup, install.
