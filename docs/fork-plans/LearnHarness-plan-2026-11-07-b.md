# LearnHarness fork: plan 2 (2026-11-07)

Status: **waiting for your approval.** Nothing below is built yet.

## What I found

**Progress and deadline**
- A plan is only the map: nodes and arrows (`plan_init`, one Mermaid block). Each plan belongs to one chat.
- Nothing stores a target date, a time budget or any estimate.
- Nodes are never marked "done". The map shows only *current / visited / upcoming*, worked out from which node the latest question was about. The original author did this on purpose ("there is no done bookkeeping"; the teacher prompt even says "there is no schedule to keep").
- Every message has a timestamp, so study time can be worked out. Nothing does that today.

**Talking to the teacher**
- While a question is waiting, the question box *replaces* the message box (`chat.tsx`).
- The only way out is Esc → "Dismiss". The teacher then sees just `{dismissed: true}`, the chat pauses, and nothing you typed reaches it.
- While the teacher is *writing*, you can already type and press Enter, and it reaches the teacher mid-answer. As soon as it asks a question, you're stuck again.
- No teacher prompt says how to handle "stop, explain this first" or "teach this differently".

## Your decisions
- A node counts as **done when the teacher marks it**, once your checks show you understand it. It can reopen a node later.
- **Deadline:** the teacher asks for it while planning, and you can change it any time in the plan view.
- **One chat per course,** so progress is per chat.
- **Interrupting:** a "Talk to the teacher" box under every question. Sending sets the question aside; the teacher answers you properly, then re-asks it (or a better one) when it fits.

## Plan

### A. Progress, deadline and time left
1. **Done marks.** A new teacher tool, `plan_progress { done?: [nodeIds], reopen?: [nodeIds] }`.
   - "Done" is worked out from these calls in the chat history, the same way upstream works out "current/visited". So it survives map rewrites, and node ids stay permanent.
   - A done node shows a check mark on the map. If it's reopened it goes back to upcoming or visited.
2. **Deadline.**
   - `plan_init` takes an optional `targetDate` (YYYY-MM-DD).
   - You can set or change it from a date field in the plan view.
   - It's stored on the chat (`ChatRecord.planTarget`), so rewriting the map never loses it.
   - When you change it, the teacher is told on its next turn.
3. **Numbers** (pure functions, unit-tested):
   - **Progress** = done ÷ all nodes, e.g. *6 / 15 · 40 %*.
   - **Study time** = time between your messages, counting only gaps under 15 minutes, from when you accepted the plan onward. Breaks and overnight gaps don't count.
   - **Time left ≈** average study time per finished node × nodes left. It shows only once at least one node is done; before that it says "after your first finished node".
   - **With a deadline:** days left, nodes per day needed, and minutes per day needed. If the minutes per day you've actually studied fall short of what's needed, it says *behind pace*.
4. **Where you see it:**
   - **Top bar:** a progress chip next to "Plan", e.g. `▰▰▱▱ 6/15 · ~3 h left · 15 Nov`. Clicking it opens the plan view.
   - **Plan view header:** a progress bar, counts (done / in progress / ahead), study time so far, time left, the target date with an edit field, days left and the pace needed.
   - **Sidebar:** a small `40 %` on chats that have a plan.
5. **Teacher instructions** (`10-planning.md`, `05-method.md`):
   - When building the plan, it asks your target date if you haven't given one.
   - It marks nodes done only when your checks justify it, and reopens them if you struggle later.
   - It tells you your pace honestly ("you're on track", or "at this pace you'd finish around 18 Nov").
   - It never cuts understanding short to hit a date. That keeps upstream's rule and adds the honest pace report.

### B. Talk to the teacher at any time
6. **The question box** gets a **"Talk to the teacher"** button (shortcut `Alt+T`) that opens a message field. Dictation works in it.
   - **Send:** the question is **set aside** and your message goes to the teacher as a normal message, which starts its turn.
   - **Set aside more than once:** if several questions are waiting, all of them are set aside.
7. **What the teacher sees:** for the set-aside question, `{ setAside: true }` with a note: "the learner set this aside to talk to you; their message follows. Answer it fully first, then re-ask this question or a better one when it fits." Then your message.
   - This needs a new input type, `interrupt`, on the existing turn route, checked the same way as answers and dismissals.
8. **The history** shows the question as "Set aside: you talked to the teacher", with your message right below it.
9. **Teacher instructions** (a new `teacher/25-interruptions.md`):
   - **You can stop it any time.** This covers a side question ("what's `<thead>` for?"), a request to stop and explain, and a style change ("slower", "more examples", "explain in English terms").
   - **Side questions:** it answers directly and fully, as a teacher would, and doesn't just reply with another question.
   - **Style requests:** it confirms and keeps to them for the rest of the session.
   - **Afterwards:** it goes back to the plan and re-asks the set-aside question if it's still relevant.
   - **Mid-answer interruptions:** the same rules apply to things you type while it's still writing.
10. **While it's writing:** the message box hint gets clearer: "Type to interrupt the teacher (Enter), or Stop."

### C. Ship
11. Tests:
    - progress, time and pace maths;
    - done/reopen derivation;
    - the deadline route;
    - the interrupt input (validation and what the model sees);
    - the dock button rendering.
12. Typecheck, lint and the full suite on Node 24. Then a new installer, a commit and a push to your fork.

**Not in this round:**
- practice-problem sessions (their box has the same limit; can follow the same pattern later);
- courses that span several chats;
- the math-olympiad workflow (still in the backlog).
