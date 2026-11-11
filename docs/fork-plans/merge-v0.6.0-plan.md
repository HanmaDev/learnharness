# Merge upstream v0.6.0 — plan (2026-11-11)

Upstream v0.6.0 (amosblomqvist/learnharness): 146 commits since our base v0.5.0, including the plugin system, the Core plugins Flashcards, Coding questions, Drawing pad and Rich code blocks, built-in side questions, themes and SVG figures. A trial merge with our 51 fork commits gives 28 conflicting files.

## Decisions (learner, 2026-11-11)

- **Side questions:** take upstream's side companion and remove ours, with two changes:
  1. **Private:** the teacher never sees side chats. Upstream feeds them into the teacher's history (`sideConversationEntries`, 4 call sites in `chat-handler.ts`); that stops.
  2. **"Save to notes" and "Make card"** on a side answer, ported from ours.

  The 3 existing side threads (Veb dizajn 2, Funkcije 1) are migrated to upstream's `sideChats` format.
- **Flashcards:** keep our Kartice; the Flashcards Core plugin stays off.
- **Enable:** Coding questions, Drawing pad, Rich code blocks.
- **Coding runtimes on this PC** (the plugin installs nothing and runs programs from the app's PATH):
  - Python: `python` = 3.12, already on PATH (`python3` is MSYS2's 3.10).
  - C and C++: `gcc` / `g++` 13.1 (MSYS2 UCRT64), already on the user PATH; checked that both compile and run.
  - `sh` is not on PATH, and the plugin's C++ example uses it.
  - A fork doctrine line tells the teacher: on Windows, drive C/C++ tests with a `python -` script that calls `gcc`/`g++`, or use Git's `C:\Program Files\Git\bin\sh.exe`. Never `python3`.
  - Verified end to end with a real C, C++ and Python question.

## Conflict policy

- Upstream wins on shared infrastructure.
- Every fork feature keeps working: Kartice, Zadaci + Tracker archive, notes, stats + study time, Wolfram, mistakes, YouTube, placement, teacher tools, the recap fold, the startup window, title fix, data backups, etc.
- `dictation.tsx` combines upstream's improvements with our changes.

## Order

1. Merge on a branch and resolve the 28 conflicts.
2. Port the side-chat privacy patch and the save buttons; migrate the threads.
3. Doctrine; typecheck, full test suite (ours and upstream's), plugin tests.
4. Dev check on a copy of the data: all fork pages, the three plugins, side questions, and a C, C++ and Python coding question.
5. Reviewer pass.
6. Build, back up, install (ask before closing the app), enable the three plugins in Settings, verify.
