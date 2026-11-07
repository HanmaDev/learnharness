# LearnHarness fork — plan (2026-11-07)

Status: **waiting for your approval.** Nothing below is built yet.

## Audit summary

| Area | What exists | What's missing |
|---|---|---|
| Code in questions | Question text, answer choices and explanations already display markdown and code blocks (`question-dock.tsx`, `answered-card.tsx`) | Tool descriptions and prompts never tell the AI to put SQL/code in code blocks. A code block inside an answer choice has no width limit, and its copy button ends up nested inside the choice button. The collapsed one-line preview shows raw backticks. No tests cover this. |
| Images | `show_image` displays a local jpg/png/gif/webp/bmp. The course `.md` files keep each picture as a `[Slika: C:\...\slike\*.png]` marker (678 images, all present on disk) | The AI is only told to show *your own* photos, never course images. SVG (7 course images) isn't supported. |
| Live HTML | Only `demo` (a slow helper AI that can't read your course) | No way for the teacher to show what its own HTML looks like |
| Dictation | Deepgram nova-3, `language=en`, endpointing 300 ms, finals only, text inserted when you stop | No live text, no vocabulary hints, noise suppression on, each 0.3 s chunk is punctuated on its own (stray periods/capitals), 3 s stop timeout can drop the end |

Claude Code's own dictation can't be reused: it's an undocumented Anthropic endpoint (very likely Deepgram behind it), it doesn't support Serbian, and other apps aren't allowed to use it. Its Deepgram-style settings are the model for the tuning below.

## Your decisions

- Dictation: English only, Deepgram tuned like Claude Code. Teaching stays Serbian (Latin script).
- Live text appears greyed in the text box while you speak.
- Vocabulary hints come from the current lesson automatically, plus your own list in Settings.
- New direct HTML preview tool, **JavaScript allowed** (sandboxed).
- Course images should be shown while teaching.

## Plan

### A. Language
1. `src/agent/models.ts`: add a rule that if you write or dictate in English, the AI still answers in Serbian (Latin). It switches language only when you explicitly ask.

### B. Code formatting in questions
2. Tool schema descriptions (`src/core/question-core.ts`, `src/agent/tools/practice.ts`): every text field says "markdown; put code/SQL/HTML in fenced code blocks with a language tag". The quiz tool example gets a SQL "predict the output" case.
3. Prompts: `shared/40-formatting.md` and `teacher/28-predictions.md` require fenced code with a language tag (```sql) for any code in a question stem, choice, explanation or problem. Short identifiers use inline code.
4. UI: answer choices that contain a code block get full width (`min-w-0 flex-1`), and the copy button no longer sits inside the choice button. The collapsed preview shows a short "[code]" placeholder instead of raw backticks.
5. Tests: render tests with an SQL code fence in a question, a choice, an explanation and a practice problem.

### C. Images while teaching
6. Prompt `teacher/55-images.md` (plus a line in `shared/30-learner-files.md`): when a source file you're teaching from contains `[Slika: <path>]`, show that image with `show_image` at the moment the text discusses it, with a short Serbian caption. Don't describe a picture that could be shown.
7. `show_image` and `read`: add SVG support (served as an image snapshot) and update the tool description to cover course/source images, not only your photos.

### D. New tool: `html_preview` (teacher)
8. Input: `html` (a full snippet, CSS/JS allowed), optional `title` and `height`. Saved as a snapshot like images, so it survives reloads and nothing is re-sent to the AI.
9. Card: the live preview in `<iframe sandbox="allow-scripts" srcDoc>` (opaque origin: no access to the app, files or network-authenticated APIs), with a "Code" toggle that shows the source highlighted, and a reload button. Registered in `components/artifacts/index.ts`.
10. Prompt: use `html_preview` whenever teaching markup or CSS ("show, then explain"). Use `demo` only for interactive instruments that need building and testing.
11. Tests: tool unit test plus card render test.

### E. Dictation (Deepgram, English)
12. URL (`src/core/dictation.ts`): `interim_results=true`, `utterance_end_ms=1000`, `vad_events=true`, `endpointing=300` (same as Claude Code), `keyterm=` for each vocabulary hint, `smart_format=true`.
13. Joining: build the text from finals per utterance and only punctuate/capitalize at real utterance ends (`speech_final` / `UtteranceEnd`). This removes stray mid-sentence periods.
14. Live text: interim words show greyed at the cursor in the composer or answer box (an overlay mirror, since a textarea can't style part of its text) and are replaced as finals arrive. Esc still cancels everything.
15. Mic: turn off `noiseSuppression` and `autoGainControl` (keep echo cancellation). Raise the stop timeout from 3 s to 6 s so the tail isn't lost.
16. Vocabulary: a new "Dictation words" list in Settings next to the language picker. Plus up to ~40 automatic terms from the current chat (code identifiers, HTML tags, SQL keywords, lesson node names), sent as `keyterm` (nova-3 keyterm prompting is English-only, which suits this).
17. Tests: URL builder, transcript joining, keyterm extraction.

### F. Ship
18. `npm run typecheck`, `npm test`, `npm run lint`. Commit to your fork in four commits (B, C+D, E, A). Rebuilding the Windows installer is a separate step: the release script is macOS-only, so it needs a Windows build target.

**Not verifiable by me:** how dictation sounds with your mic (I can't speak into it). You'll need to try it, and I'll tune from what you report.

## Backlog (later)
- Math workflow: Thomas' Calculus (Serbian), Serbian high-school problem books, Serbian National Math Olympiad (category B), with high-volume practice problems.
