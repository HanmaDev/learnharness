# LearnHarness fork: plan 3, question types and practice (2026-11-07)

Status: **waiting for your approval.** Nothing below is built yet.

## What exists today
- **Teaching questions:**
  - `quiz` (multiple choice, graded in the app);
  - `explain` (free answer, graded by the AI);
  - `ask_user_question` (ungraded).

  They all go through one pipeline: the question box, answer cards, predict/check, and plan progress tags (`nodeId`).
- **Practice:**
  - **`problem`** is one text statement, with a hidden model solution and a mode (recall / discrimination / composition).
  - **The practice box** is a single "Your thinking" field.
  - **`conclude`** grades the problem (outcome, hint rung R0–R5, miss type, retest).
  - **Hints:** the 6-step hint ladder exists, but only the AI starts it, when it reads that you're stuck.
- **Not there yet:**
  - parts, a timer, image paste;
  - attaching files in the practice box;
  - an SQL engine, a code editor, a math library.

## Your decisions
- **Build:** everything (10 items).
- **Phase order:** quick wins → photos → run code → math.
- **Math input:** a visual editor (MathLive).
- **Photos:** both from the PC (paste, drag or attach) and from the phone by QR code.
- **Timer:** the teacher can set it and you can too.

## Design: one new tool, `exercise`
Adding a question type touches about 13 places in the app. So instead of one tool per type, I'll add **one** new teacher tool, `exercise`, with a `format` field:
- It works like `quiz`: same `type` (predict/check) and `nodeId`, so plan progress and the predict → teach → check cycle work unchanged.
- It goes through the same question box, answer cards and grading record.
- `quiz` and `explain` stay exactly as they are.
- Probe-phase questions keep using `quiz`/`explain`. `exercise` is for teaching.

| format | You do | Graded by |
|---|---|---|
| `blanks` | Fill the `{{1}}`, `{{2}}` gaps in code/text (each gap lists accepted answers; optional case-insensitive) | App, per gap |
| `order` | Drag shuffled lines into the right order | App (exact order; partial credit shown) |
| `find-mistake` | Click the wrong line in numbered code or a derivation, and say why | App (the line); AI (the why) |
| `match` | Connect left items to right items | App, per pair |
| `sql` *(phase 3)* | Write a query against a small database the teacher defines | App: your result table vs the reference query's |
| `html` *(phase 3)* | Edit HTML/CSS with a live preview | AI, from your code and its brief |
| `math` *(phase 4)* | Type a formula in a visual editor | App: equal to the answer in any equivalent form |

**Every format gets:**
- "I don't know";
- the confidence slider;
- the "Your thinking" field;
- "Talk to the teacher".

**After you answer:** you see which parts were right, and the teacher's explanation (folded behind "Why", like quizzes). The teacher gets a compact result, for example `{ format: "blanks", correct: false, gaps: [{ given: "WHERE", ok: true }, { given: "ORDER", ok: false, expected: "ORDER BY" }] }`.

## Phase 1: quick wins
**Teaching**
1. **Schema:** the `exercise` tool, with format-specific fields validated up front (gap count matches `{{n}}`, order has 2+ lines, find-mistake line is in range, match pairs are unique).
2. **Pipeline:** wire it into the question pipeline once (QUESTION_TOOLS, kinds, parsers, view, plan tagging, phases, the session markdown export, the answer card).
3. **Question box UI:**
   - `blanks`: inline input boxes inside a code block.
   - `order`: drag handles, plus keyboard (↑/↓ with Alt).
   - `find-mistake`: clickable numbered lines.
   - `match`: click a left item, then a right item; lines connect them.
4. **Grading** functions (pure, unit-tested), and the answer cards for each format.
5. **Teacher instructions:** when each format fits better than multiple choice (code syntax → blanks, procedures/proofs → order, debugging/derivations → find-mistake, vocabulary/mappings → match). Multiple choice stays for conceptual checks.

**Practice**

6. **Hint button:**
   - It sends "next hint please". The practice teacher gives exactly the next rung of its ladder (R1 → R5), and the button shows how many hints you've used.
   - Asking for a hint is recorded, so `conclude` reports the real rung.
7. **Multi-part problems:**
   - `problem` takes optional `parts: [{ label: "a", statement }]`.
   - The practice box shows each part with its own answer field and Submit; answers go in tagged "(b)".
   - `conclude` takes optional per-part outcomes, and the result card shows a row per part.
8. **Timer:**
   - **Setting it:** `problem` takes an optional `timeLimitMin`. You can also switch a timer on, or change the limit, from the practice box.
   - **Display:** the time counts down (it counts up when there's no limit), turns amber in the last minute, and shows "time's up" without blocking you.
   - **Recording:** time spent is sent with each answer, and the result card shows the total time.
   - **Teacher instructions:** use limits for olympiad and competition problems.

## Phase 2: photos of handwritten work
9. **From the PC:** paste (Ctrl+V), drag a photo onto the practice box (and the question box), or use an attach button.
   - The image is saved into the chat, shown as a thumbnail with your answer, and **sent to the teacher as an image** so it reads your actual work.
   - Only images, at most 25 MB; the existing image normaliser keeps it under about 1 MB.
10. **From the phone (QR code):**
    - **How it works:** a "Phone photo" button shows a QR code. The phone opens a one-time page on your Wi-Fi, you take or choose a photo, and it appears in the problem.
    - **Security:**
      - a separate small upload listener starts only while the QR is open;
      - a random one-time code is in the link;
      - one image only;
      - it closes after the upload or 10 minutes;
      - it never exposes the rest of the app.
    - **First use:** Windows will ask once to allow it through the firewall (private network only).
11. **Teacher instructions:** read the photo carefully, quote the exact line where the reasoning breaks, and grade the method, not just the final answer.

## Phase 3: run code in questions
12. **New libraries,** bundled so they work offline: **sql.js** (SQLite as WebAssembly) and **CodeMirror 6** (a code editor with SQL/HTML highlighting).
13. **`sql`:**
    - The teacher gives `schema` + `seed` SQL and a `reference` query.
    - You write a query and press Run (Ctrl+Enter) to see the result table, as often as you like, then Submit.
    - Grading compares result tables: rows and columns, with order mattering only if the reference uses ORDER BY.
    - The database runs in your browser, in memory; nothing touches your files.
14. **`html`:** a CodeMirror editor next to a live sandboxed preview (the same sandbox as `html_preview`). On Submit the teacher gets your code plus a screenshot-free description and grades it against its brief.

## Phase 4: math with checking
15. **New libraries:** **MathLive** (visual formula editor with an on-screen math keyboard) and **Compute Engine** (from the same project, CortexJS): it parses LaTeX and checks equivalence.
16. **`math`:**
    - The teacher gives the answer in LaTeX.
    - You type it visually. The check is symbolic simplification first, then numerical spot checks at random points.
    - Equal forms count as right: `2x\cos(x^2)`, `2\cos(x^2)x`.
    - For things it can't decide (inequalities, sets, proofs), it falls back to the teacher's judgement.
17. **Practice too:** practice problems can ask for a final answer in math format alongside the written solution (or photo).

## Ship
Each phase gets:
- tests (grading, schema validation, rendering, plus the end-to-end flow through the record);
- the typecheck, lint and full test suite on Node 24;
- an independent code review;
- a new installer;
- a commit and push to your fork.

You try each phase before the next starts.

**Size:** phase 1 is the largest; phases 2–4 are each smaller but add a library or a listener.
