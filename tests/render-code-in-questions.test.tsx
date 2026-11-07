/**
 * Fork: code (SQL/HTML) inside question surfaces must render as a real code
 * block — the learner could not read run-on snippets during SQL practice.
 * Static-markup render, same shim as render-cards.test.tsx.
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QuestionDock, teaserText } from "../components/question-dock.tsx";
import { AnsweredCard } from "../components/answered-card.tsx";
import { buildAnswer, normalizeOptions, resolveCorrect, type QuestionData } from "../src/core/question-core.ts";

const sql = "```sql\nSELECT name\nFROM users\nWHERE age > 30;\n```";

const quiz = {
	question: `What does this return?\n\n${sql}`,
	details: "Table `users` has 3 rows.",
	options: [
		{ label: "```text\nname\n----\nAna\n```", value: "a" },
		{ label: "Every row", value: "b" },
	],
	explanation: `Only rows passing the filter:\n\n${sql}`,
	correctAnswer: "a",
};

function codeBlocks(html: string): number {
	return (html.match(/data-testid="md-code"/g) ?? []).length;
}

describe("code blocks inside questions", () => {
	it("pending dock: the stem's fence and a code option both render as code blocks", () => {
		const html = renderToStaticMarkup(
			<QuestionDock toolName="quiz" toolCallId="c1" input={quiz} expanded onExpand={() => {}} onSubmit={() => {}} />,
		);
		assert.ok(codeBlocks(html) >= 2, `stem + option code blocks (got ${codeBlocks(html)})`);
		assert.ok(html.includes("SELECT"), "the SQL text is present");
		assert.ok(!html.includes("```"), "no raw fence leaks");
		assert.ok(html.includes('data-streamdown="inline-code"'), "inline code in details renders");
	});

	it("pending dock: a code block inside an option button mounts no nested copy button", () => {
		const html = renderToStaticMarkup(
			<QuestionDock toolName="quiz" toolCallId="c2" input={quiz} expanded onExpand={() => {}} onSubmit={() => {}} />,
		);
		// Only the stem's block may carry a copy corner; the option's must not.
		const copies = (html.match(/data-testid="md-copy"/g) ?? []).length;
		assert.equal(copies, 1, "exactly one copy button (the stem's)");
	});

	it("answered card: stem and option code render as blocks (explanation stays tucked behind Why)", () => {
		const options = normalizeOptions(quiz.options);
		const qd: QuestionData = {
			id: "c3",
			kind: "quiz",
			question: quiz.question,
			mode: "single-select",
			options,
			correctIndices: resolveCorrect(quiz.correctAnswer, options).indices,
			explanation: quiz.explanation,
			createdAt: new Date().toISOString(),
		};
		const html = renderToStaticMarkup(<AnsweredCard answer={buildAnswer(qd, { values: ["a"] })} input={quiz} />);
		assert.ok(codeBlocks(html) >= 2, `stem + option (got ${codeBlocks(html)})`);
		assert.ok(!html.includes("```"), "no raw fence leaks");
	});

	it("collapsed teaser: fences collapse to [code], inline backticks drop, math still flattens", () => {
		assert.equal(teaserText(`What does this return?\n\n${sql}`), "What does this return? [code]");
		assert.equal(teaserText("Which `<td>` attribute merges cells?"), "Which <td> attribute merges cells?");
		assert.equal(teaserText("Solve $x^2 = 4$"), "Solve x^2 = 4");
	});
});
