# Wolfram, mistake log, YouTube, placement test — plan (2026-11-08)

Decisions: placement = choice per course (Brza provera / Test znanja / Od nule) · test results: teacher proposes, learner confirms · mistakes analysed automatically · Wolfram checks the teacher's math and the learner's math answers · YouTube by pasting a link and as a course source.

## 1. Wolfram|Alpha

- **Key:** a free Wolfram App ID (developer.wolframalpha.com, 2,000 calls/month), entered in Settings → Providers next to Deepgram. Without it, everything below is simply off.
- **Teacher tool `wolfram`:** query in, result out (plain-text result + the main pods). The teacher prompt says: verify every computed result, derivative, integral, solution of an equation, unit conversion before posing or grading; never show the learner raw Wolfram output as the answer to their own exercise.
- **Grading math exercises:** when the app's own check (MathLive + numeric sampling) can't decide whether the learner's expression equals the expected one, ask Wolfram "is A equal to B" (simplify A−B). The verdict is shown as "provereno Wolfram-om".
- **Usage counter** in Settings (calls this month) so the free limit isn't a surprise.

## 2. Mistake log (Greške)

- **Every wrong graded answer** (quiz, exercise, math; also free recall the teacher marked wrong in a flagged way — no, only app-graded ones in v1) gets a background analysis by the cheap model: error type (pojam / računska / nepažnja / pogrešno čitanje / nedostaje predznanje), what the correct version is, one rule to remember, and the step it belongs to.
- Stored per course (ChatRecord.mistakes), shown in a **Greške** tab on the Kartice/notes side: list by step, filter by type, "rešeno" once the same kind of question is later answered right.
- Each mistake has **Napravi karticu** (a card from the rule) and links to the step's notes.
- The teacher sees a short summary of open mistakes at the start of a session (so it can revisit them), never the full list each turn.

## 3. YouTube transcripts

- **In chat:** paste a YouTube link; the teacher gets a `youtube` tool that fetches the transcript with timestamps (captions, auto-captions too; language preference Serbian → English → any) and teaches from it, citing [mm:ss].
- **As a course source:** "Dodaj YouTube video" next to the existing file import; the transcript becomes a Markdown source (title, channel, link, timestamped text) that goes through the same pipeline as PDFs/notes (knowledge graph, reading by the teacher).
- No API key: transcripts are read from YouTube's public caption tracks; videos without captions say so.

## 4. Placement — three ways to start a course

At the start of a teaching course the learner picks:

- **Brza provera** — today's adaptive probe (unchanged).
- **Test znanja** — a full written test over the whole syllabus: built from the course material / goal, 2–3 questions per topic so **every** topic is covered (typically 20–40), mixed formats (choice, short answer, exercises, math). Shown as one test page you work through at your own pace (save and continue later), graded at the end. The result screen lists each topic with a score and a proposal — **Znam / Ponoviti / Učim od početka** — which you can change before the teacher builds the plan from it.
- **Od nule** — no testing; the teacher plans from the very beginning.

For an existing course, "Test znanja" can also be started later from the plan view to re-check everything learned so far.

## Order of work

1. Wolfram (key, tool, grading) → 2. mistake log → 3. YouTube → 4. placement (biggest). Each: mockup where there is new UI (Greške tab, placement choice + test page + result screen, YouTube source dialog) → build → tests → Codex visual check → reviewer pass. One installer at the end (backup first).
