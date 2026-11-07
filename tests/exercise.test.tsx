/**
 * Fork (2026-11-07): the `exercise` tool (blanks / order / find-mistake /
 * match) and the practice upgrades (hint button, parts, timer).
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	blankNumbers, buildExerciseAnswer, exerciseInputProblems, exerciseResponseComplete, exerciseShuffle,
	gradeExercise, templateSegments, type ExerciseToolInput,
} from "../src/core/exercise.ts";
import { compactAnswerForModel, questionNeedsReveal } from "../src/core/question-core.ts";
import { parseQuestionInput } from "../src/core/tool-parts.ts";
import { toolQuestionKind, QUESTION_TOOLS } from "../src/core/pending.ts";
import { derivePlanStatusesLh } from "../src/core/contracts/plan.ts";
import { createTree } from "../src/core/plan-tree.ts";
import type { LhMessage } from "../src/core/native-messages.ts";
import { teachExerciseToolFor } from "../src/agent/tools.ts";
import { problemInputObject, concludeInputObject } from "../src/agent/tools/practice.ts";
import { chatStore } from "../src/store/chats.ts";
import { PATHS } from "../config.ts";
import { QuestionDock } from "../components/question-dock.tsx";
import { AnsweredCard } from "../components/answered-card.tsx";
import { PracticeDock, formatClock, hintRequestText, HINT_REQUEST_PREFIX } from "../components/practice-dock.tsx";
import { ConcludeCard, ProblemCard } from "../components/practice-cards.tsx";
import { problemHintCount, problemPosedAt } from "../components/chat.tsx";
import { Value } from "typebox/value";

const base = { type: "check" as const, nodeId: "sql", question: "Complete the query.", explanation: "WHERE filters rows." };
const blanks: ExerciseToolInput = {
	...base, format: "blanks", language: "sql",
	template: "SELECT name\nFROM users\n{{1}} age > 30\n{{2}} name;",
	blanks: [{ accept: ["WHERE"] }, { accept: ["ORDER BY"] }],
};
const order: ExerciseToolInput = { ...base, format: "order", steps: ["SELECT", "FROM", "WHERE", "ORDER BY"] };
const mistake: ExerciseToolInput = { ...base, format: "find-mistake", language: "sql", lines: ["SELECT name", "FROM users", "WHERE age > 30", "GROUP name"], mistakeLine: 4 };
const match: ExerciseToolInput = { ...base, format: "match", pairs: [{ left: "<th>", right: "header cell" }, { left: "<td>", right: "data cell" }, { left: "<tr>", right: "row" }] };

describe("exercise — validation", () => {
	it("accepts well-formed inputs of every format", () => {
		for (const input of [blanks, order, mistake, match]) assert.deepEqual(exerciseInputProblems(input), [], input.format);
	});

	it("rejects authoring errors with fixable messages", () => {
		assert.match(exerciseInputProblems({ ...blanks, blanks: [{ accept: ["WHERE"] }] }).join(), /1 entry but the template has 2 gap/);
		assert.match(exerciseInputProblems({ ...blanks, template: "{{2}} then {{1}}" }).join(), /numbered \{\{1\}\}\.\.\{\{2\}\} in reading order/);
		assert.match(exerciseInputProblems({ ...order, steps: ["a", "a", "b"] }).join(), /distinct/);
		assert.match(exerciseInputProblems({ ...mistake, mistakeLine: 9 }).join(), /outside 1\.\.4/);
		assert.match(exerciseInputProblems({ ...match, pairs: [{ left: "a", right: "x" }, { left: "a", right: "y" }, { left: "b", right: "z" }] }).join(), /left sides must be distinct/);
	});

	it("order and match need at least 3 items (2 would give the answer away)", () => {
		assert.match(exerciseInputProblems({ ...order, steps: ["a", "b"] }).join(), /3–12/);
		assert.match(exerciseInputProblems({ ...match, pairs: match.pairs!.slice(0, 2) }).join(), /3–10/);
	});

	it("template helpers find and split gaps", () => {
		assert.deepEqual(blankNumbers(blanks.template!), [1, 2]);
		assert.deepEqual(templateSegments("a {{1}} b"), [{ text: "a " }, { gap: 0 }, { text: " b" }]);
	});

	it("the shuffle is deterministic and never the identity", () => {
		assert.deepEqual(exerciseShuffle(4, "seed"), exerciseShuffle(4, "seed"));
		for (const seed of ["a", "b", "c", "d", "e", "f"]) {
			const p = exerciseShuffle(3, seed);
			assert.notDeepEqual(p, [0, 1, 2], seed);
			assert.deepEqual([...p].sort(), [0, 1, 2]);
		}
	});
});

describe("exercise — grading", () => {
	it("blanks: per gap, case/whitespace-insensitive by default", () => {
		const r = gradeExercise(blanks, { format: "blanks", values: [" where ", "ORDER  by"] });
		assert.deepEqual(r, { correct: true, score: 1, items: [true, true] });
		const wrong = gradeExercise(blanks, { format: "blanks", values: ["WHERE", "GROUP BY"] });
		assert.deepEqual(wrong.items, [true, false]);
		assert.equal(wrong.score, 0.5);
		const strict = gradeExercise({ ...blanks, blanks: [{ accept: ["WHERE"], caseSensitive: true }, { accept: ["ORDER BY"] }] }, { format: "blanks", values: ["where", "order by"] });
		assert.deepEqual(strict.items, [false, true]);
	});

	it("order, find-mistake, match", () => {
		assert.equal(gradeExercise(order, { format: "order", order: [0, 1, 2, 3] }).correct, true);
		assert.deepEqual(gradeExercise(order, { format: "order", order: [1, 0, 2, 3] }).items, [false, false, true, true]);
		assert.equal(gradeExercise(mistake, { format: "find-mistake", line: 4 }).correct, true);
		assert.equal(gradeExercise(mistake, { format: "find-mistake", line: 3 }).correct, false);
		assert.deepEqual(gradeExercise(match, { format: "match", picks: [0, 2, 1] }).items, [true, false, false]);
	});

	it("completeness gates submit", () => {
		assert.equal(exerciseResponseComplete(blanks, { format: "blanks", values: ["WHERE", ""] }), false);
		assert.equal(exerciseResponseComplete(match, { format: "match", picks: [0, -1, 1] }), false);
		assert.equal(exerciseResponseComplete(mistake, { format: "find-mistake", line: 0 }), false);
		assert.equal(exerciseResponseComplete(order, { format: "order", order: [3, 2, 1, 0] }), true);
	});

	it("the answer record and what the teacher reads", () => {
		const answer = buildExerciseAnswer(blanks, { response: { format: "blanks", values: ["WHERE", "SORT BY"] }, thinking: "not sure", confidence: 70 });
		assert.equal(answer.kind, "exercise");
		assert.equal(answer.correct, false);
		const model = compactAnswerForModel(answer);
		assert.equal(model.kind, "exercise");
		assert.equal(model.format, "blanks");
		assert.equal(model.correct, false);
		assert.equal(model.confidence, 70);
		assert.equal(model.thinking, "not sure");
		assert.deepEqual(model.gaps, [{ given: "WHERE", ok: true }, { given: "SORT BY", ok: false, expected: "ORDER BY" }]);
		const idk = buildExerciseAnswer(blanks, { response: null, dontKnow: true });
		assert.deepEqual(compactAnswerForModel(idk), { kind: "exercise", dontKnow: true });
		const m = compactAnswerForModel(buildExerciseAnswer(mistake, { response: { format: "find-mistake", line: 2 } }));
		assert.equal(m.chosenLine, 2);
		assert.equal(m.mistakeLine, 4);
	});
});

describe("exercise — the pipeline", () => {
	it("is a question tool with its own kind, a reveal-capable check, and a parsed display input", () => {
		assert.ok((QUESTION_TOOLS as readonly string[]).includes("exercise"));
		assert.equal(toolQuestionKind("exercise"), "exercise");
		assert.equal(questionNeedsReveal("exercise", { type: "check" }, "teach"), true);
		assert.equal(questionNeedsReveal("exercise", { type: "predict" }, "teach"), false);
		assert.ok(parseQuestionInput("exercise", blanks));
		assert.equal(parseQuestionInput("exercise", { ...blanks, blanks: [] }), undefined, "invalid → malformed");
	});

	it("moves the plan map like quiz", () => {
		const tree = createTree([{ id: "sql", title: "SQL" }, { id: "joins", title: "Joins" }], []);
		const msgs = [
			{ id: "a1", role: "assistant", content: [{ type: "toolCall", id: "c1", name: "exercise", arguments: { ...blanks, nodeId: "sql" } }] },
			{ id: "a2", role: "assistant", content: [{ type: "toolCall", id: "c2", name: "exercise", arguments: { ...order, nodeId: "joins" } }] },
		] as unknown as LhMessage[];
		const s = derivePlanStatusesLh(tree, msgs);
		assert.equal(s.current, "joins");
		assert.ok(s.visited.has("sql"));
	});

	const created: string[] = [];
	after(() => { for (const id of created) fs.rmSync(path.join(PATHS.chats, `${id}.json`), { force: true }); });
	it("the tool validates authoring and the nodeId against the live map", async () => {
		const chat = chatStore.createChat("exercise tool");
		created.push(chat.id);
		const tool = teachExerciseToolFor({ chatId: chat.id, chatStore });
		const noMap = await tool.execute("x1", blanks);
		assert.match(JSON.stringify(noMap.content), /No plan map exists yet/);
		chatStore.saveTree(chat.id, createTree([{ id: "sql", title: "SQL" }], []));
		const bad = await tool.execute("x2", { ...blanks, blanks: [{ accept: ["WHERE"] }] });
		assert.match(JSON.stringify(bad.content), /template has 2 gap/);
		const ok = await tool.execute("x3", blanks);
		assert.equal(ok.terminate, true, "a valid exercise ends the turn like a question");
	});
});

describe("exercise — rendering", () => {
	const dock = (input: ExerciseToolInput) =>
		renderToStaticMarkup(<QuestionDock toolName="exercise" toolCallId={`t_${input.format}`} input={input as never} expanded onExpand={() => {}} onSubmit={() => {}} />);

	it("each format renders its widget, the confidence slider and the thinking field", () => {
		assert.match(dock(blanks), /data-testid="exercise-gap-2"/);
		assert.match(dock(order), /data-testid="exercise-step-4"/);
		assert.match(dock(mistake), /data-testid="exercise-line-4"/);
		assert.match(dock(match), /data-testid="exercise-right-3"/);
		const html = dock(blanks);
		assert.match(html, /data-testid="exercise-confidence"/);
		assert.match(html, /data-testid="exercise-submit"[^>]*disabled/, "submit waits for every gap");
		assert.match(html, /fill in the blanks/);
	});

	it("I don't know shows the correct answer; details render on the card", () => {
		const idk = buildExerciseAnswer({ ...blanks, details: "Table users" }, { response: null, dontKnow: true });
		const html = renderToStaticMarkup(<AnsweredCard answer={idk} input={{ ...blanks, details: "Table users" }} />);
		assert.match(html, /data-testid="exercise-solution"/);
		assert.match(html, /ORDER BY/);
		assert.match(html, /Table users/);
	});

	it("every interactive field joins the form's own Tab chain", () => {
		const html = dock(blanks);
		assert.equal((html.match(/data-exercise-focus=""/g) ?? []).length, 3, "two gaps + thinking");
	});

	it("a malformed exercise falls back to the malformed card", () => {
		assert.ok(!dock({ ...blanks, blanks: [] }).includes("exercise-form"));
	});

	it("the answered card shows the itemized result and the correct answers", () => {
		const answer = buildExerciseAnswer(blanks, { response: { format: "blanks", values: ["WHERE", "SORT BY"] } });
		const html = renderToStaticMarkup(<AnsweredCard answer={answer} input={blanks} />);
		assert.match(html, /data-testid="exercise-answered"/);
		assert.match(html, /incorrect/);
		assert.match(html, /→ ORDER BY/);
		assert.match(html, /50% right \(1\/2\)/);
		const o = buildExerciseAnswer(order, { response: { format: "order", order: [1, 0, 2, 3] } });
		assert.match(renderToStaticMarkup(<AnsweredCard answer={o} input={order} />), /Correct order/);
	});
});

describe("practice upgrades", () => {
	it("problem and conclude accept parts, a time limit and time spent", () => {
		assert.ok(Value.Check(problemInputObject, {
			statement: "Let f(x)=x^2.", mode: "composition", modelSolution: "(a) 2x (b) 2",
			parts: [{ label: "a", statement: "f'(x)?" }, { label: "b", statement: "f''(x)?" }], timeLimitMin: 20,
		}));
		assert.ok(Value.Check(concludeInputObject, {
			outcome: "solvedWithHints", verdict: "ok", rung: "R1", missClass: null, retest: false,
			parts: [{ label: "a", outcome: "solved" }, { label: "b", outcome: "partial" }], timeSpentMin: 14,
		}));
	});

	it("the dock shows parts, the hint button and the timer controls", () => {
		const html = renderToStaticMarkup(
			<PracticeDock
				problemCallId="p1"
				input={{ statement: "Let f(x)=x^2.", parts: [{ label: "a", statement: "f'(x)?" }, { label: "b", statement: "f''(x)?" }], timeLimitMin: 20 }}
				posedAt={Date.now()}
				hintsUsed={2}
				expanded
				onExpand={() => {}}
				onSubmit={() => {}}
			/>,
		);
		assert.match(html, /data-testid="practice-part-b"/);
		assert.match(html, /Next hint \(2 used\)/);
		assert.match(html, /data-testid="practice-clock"/);
		assert.match(html, /left/);
		assert.match(html, /limit 20 min/);
		assert.match(html, /PART \(a\)/);
	});

	it("hint requests are counted from the record; the pose time is the call's message", () => {
		assert.ok(hintRequestText(3).startsWith(HINT_REQUEST_PREFIX));
		const msgs = [
			{ id: "a", role: "assistant", timestamp: 1234, content: [{ type: "toolCall", id: "p1", name: "problem", arguments: {} }] },
			{ id: "t1", role: "custom", customType: "practice-thinking", details: { problemCallId: "p1", text: hintRequestText(1) } },
			{ id: "t2", role: "custom", customType: "practice-thinking", details: { problemCallId: "p1", text: "my work" } },
			{ id: "t3", role: "custom", customType: "practice-thinking", details: { problemCallId: "p2", text: hintRequestText(1) } },
		] as unknown as LhMessage[];
		assert.equal(problemHintCount(msgs, "p1"), 1);
		assert.equal(problemPosedAt(msgs, "p1"), 1234);
		assert.equal(formatClock(65_000), "1:05");
		assert.equal(formatClock(3_725_000), "1:02:05");
	});

	it("the cards show parts, the limit, per-part outcomes and time", () => {
		const problem = renderToStaticMarkup(<ProblemCard part={{ type: "tool-problem", state: "output-available", toolCallId: "p", input: { statement: "S", parts: [{ label: "a", statement: "A?" }], timeLimitMin: 15 } }} />);
		assert.match(problem, /15 min/);
		assert.match(problem, /\(a\)/);
		const conclude = renderToStaticMarkup(<ConcludeCard part={{ type: "tool-conclude", state: "output-available", toolCallId: "c", input: { outcome: "solved", verdict: "v", parts: [{ label: "a", outcome: "solved" }, { label: "b", outcome: "partial" }], timeSpentMin: 14 }, reveal: "sol" }} />);
		assert.match(conclude, /data-testid="conclude-parts"/);
		assert.match(conclude, /\(b\) partial/);
		assert.match(conclude, /14 min/);
	});
});
