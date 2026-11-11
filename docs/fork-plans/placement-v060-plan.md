# Test znanja with code, drawing, photos and diagrams — plan (2026-11-11)

Learner's request: the full placement test (Test znanja, `placement_test`) should use the new v0.6.0 features: C/C++/Python programs, drawing, photos of written work, and diagrams in questions.

## 1. Code questions (new kind `code`)

- The prober or teacher writes a code question:
  - `language` (c / cpp / python);
  - optional `starterCode`;
  - hidden `tests`, in the same contract as the Coding questions plugin: `{ program, args, code }`, with the learner's code in `answer.txt`;
  - `correctAnswer`, the model solution in Markdown.
- Two test sets per code question (learner decision, 2026-11-11):
  - **Public tests** (`publicTests`): runnable from the editor at any time with a "Pokreni primere" button. They show whether the program compiles and runs, plus pass/fail and output on a few example cases. Rerun as often as you like; they don't count.
  - **Hidden tests** (`tests`): run only when the whole test is submitted. Their results go to the grader. The learner never sees their cases during the test.
- The test page shows a code editor with syntax highlighting (CodeMirror, as our exercises already use) for that question.
- Both sets run on the server, from the tests stored with the question in the session (never from the browser):
  - a fresh temporary folder, no shell, a 30 s limit, output capped;
  - the same rules as the plugin, so the same teacher instructions apply (C/C++ through a `python -` script; `python`, never `python3`).
- The grader receives, per code question, the code plus `passed / failed`, the exit code and the test output. It decides the score: tests inform, partial credit is its call.

## 2. Drawing (Drawing pad)

- The Drawing pad is one sheet per session (the "Draw" button in the top bar). It attaches the current drawing to whatever is submitted next.
- The test submission goes through the same prepared path as normal answers, so a drawing open when you submit the test is attached as an image and the grader sees it.
- You label in the drawing which question it answers. The test page gets a hint line about this.

## 3. Photos of written work

- Each test question gets the Photo / "From phone" tray that normal questions have.
- The grader receives every photo as an image, and the answer says which photos belong to which question.

## 4. Diagrams in questions

- Question text renders through the shared Markdown component, which Rich code blocks hooks into, so TikZ, SMILES and ABC figures render in the test.
- Verified in dev. The prompt tells the agent it may use them.

## Doctrine

The placement fragments (prober and teacher) learn:
- the `code` kind: when to use it, the test contract, and this PC's runtimes;
- that a drawing or photos may come with the test;
- that diagrams are allowed.

## Order

1. Core schema plus validation, then the server runner plus API, then the test page (editor, photos, submission path).
2. Doctrine, then tests.
3. Dev check, including a real C++ question run end to end through the runner.
4. Reviewer, then build, back up, install (ask first).
