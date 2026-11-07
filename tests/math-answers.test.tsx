/**
 * Fork (2026-11-07): math answers — the equivalence checker, the `math`
 * exercise format, and the practice final-answer field.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Value } from "typebox/value";
import { mathEquivalent, wrapFractions } from "../components/math-check.ts";
import { buildExerciseAnswer, exerciseInputProblems, type ExerciseToolInput } from "../src/core/exercise.ts";
import { compactAnswerForModel } from "../src/core/question-core.ts";
import { problemInputObject } from "../src/agent/tools/practice.ts";
import { QuestionDock } from "../components/question-dock.tsx";
import { AnsweredCard } from "../components/answered-card.tsx";
import { PracticeDock } from "../components/practice-dock.tsx";

const r = String.raw;

describe("math equivalence", () => {
	const cases: Array<[string, string, "equal" | "different" | "undecided"]> = [
		[r`2x\cos(x^2)`, r`2\cos\left(x^2\right)\cdot x`, "equal"],
		[r`2x\cos(x^2)`, r`2x\sin(x^2)`, "different"],
		[r`(x-1)(x+1)`, r`x^2-1`, "equal"],
		[r`\frac{1}{2}`, r`0.5`, "equal"],
		[r`\frac{3}{4}`, r`\frac{6}{8}`, "equal"],
		[r`\frac{\sqrt{x}}{2}`, r`\frac{1}{2}x^{\frac{1}{2}}`, "equal"],
		[r`\frac{1}{2x}`, r`\frac{1}{2}x`, "different"],
		[r`\ln(x^2)`, r`2\ln(x)`, "equal"],
		[r`\sin^2 x+\cos^2 x`, r`1`, "equal"],
		[r`e^{2x}`, r`(e^x)^2`, "equal"],
		[r`3\sqrt{2}`, r`\sqrt{18}`, "equal"],
		[r`\pi`, r`3.14`, "different"],
		[r`x>2`, r`x>2`, "undecided"],
	];
	for (const [answer, given, want] of cases) {
		it(`${given} vs ${answer} → ${want}`, async () => {
			assert.equal(await mathEquivalent(answer, given), want);
		});
	}

	it("accepts any listed alternative; an empty answer is different", async () => {
		assert.equal(await mathEquivalent(r`2`, r`-2`, [r`-2`]), "equal");
		assert.equal(await mathEquivalent(r`2`, "  "), "different");
	});

	it("wraps MathLive's (a)/(b) fractions so implicit multiplication can't steal the denominator", () => {
		assert.equal(wrapFractions("(1)/(2)x"), "((1)/(2))x");
		const nested = wrapFractions("((1)/(2))/(3)");
		assert.equal([...nested].filter((c) => c === "(").length, [...nested].filter((c) => c === ")").length, "balanced");
	});
});

const mathEx: ExerciseToolInput = {
	type: "check", nodeId: "chain", format: "math", question: r`Differentiate $\sin(x^2)$.`, explanation: "Chain rule.", answerLatex: r`2x\cos(x^2)`,
};

describe("math exercise", () => {
	it("validation requires answerLatex", () => {
		assert.deepEqual(exerciseInputProblems(mathEx), []);
		assert.match(exerciseInputProblems({ ...mathEx, answerLatex: "" }).join(), /answerLatex/);
	});

	it("equal/different are graded; undecided goes to the teacher", () => {
		const right = buildExerciseAnswer(mathEx, { response: { format: "math", latex: r`2\cos(x^2)x`, verdict: "equal" } });
		assert.equal(right.correct, true);
		assert.equal(compactAnswerForModel(right).check, "equal");
		const wrong = buildExerciseAnswer(mathEx, { response: { format: "math", latex: r`\cos(x^2)`, verdict: "different" } });
		assert.equal(wrong.correct, false);
		const unsure = buildExerciseAnswer(mathEx, { response: { format: "math", latex: r`x>2`, verdict: "undecided" } });
		assert.equal(unsure.correct, undefined);
		assert.equal(compactAnswerForModel(unsure).graded, false);
	});

	it("renders the math field in the dock and the answer on a wrong card", () => {
		const dock = renderToStaticMarkup(<QuestionDock toolName="exercise" toolCallId="m" input={mathEx as never} expanded onExpand={() => {}} onSubmit={() => {}} />);
		assert.match(dock, /data-testid="exercise-math"/);
		const wrong = buildExerciseAnswer(mathEx, { response: { format: "math", latex: r`\cos(x^2)`, verdict: "different" } });
		const card = renderToStaticMarkup(<AnsweredCard answer={wrong} input={mathEx} />);
		assert.match(card, /Answer:/);
		assert.match(card, /katex/);
	});
});

describe("practice final answer", () => {
	it("problem accepts a hidden finalAnswerLatex; the dock shows the field only then", () => {
		assert.ok(Value.Check(problemInputObject, { statement: "S", mode: "recall", modelSolution: "M", finalAnswerLatex: r`\frac{3}{4}` }));
		const withField = renderToStaticMarkup(<PracticeDock problemCallId="p" input={{ statement: "S", finalAnswerLatex: r`\frac{3}{4}` }} expanded onExpand={() => {}} onSubmit={() => {}} />);
		assert.match(withField, /data-testid="practice-final-answer"/);
		assert.ok(!withField.includes(r`\frac{3}{4}`), "the committed answer never renders");
		const without = renderToStaticMarkup(<PracticeDock problemCallId="p" input={{ statement: "S" }} expanded onExpand={() => {}} onSubmit={() => {}} />);
		assert.ok(!without.includes("practice-final-answer"));
	});
});
