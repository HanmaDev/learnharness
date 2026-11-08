/**
 * Fork (2026-11-08): topic notes windows, side-chat redaction, active study
 * time, learning statistics.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nodeMessages, nodeWindows, notesDocument, notesFileName, noteSteps, staleSteps } from "../src/core/notes.ts";
import { openQuestionCallId, redactOpenQuestion, sideThreadTitle } from "../src/core/side-chat.ts";
import { addStudySeconds, chatIdFromPath, emptyStudyLog, parseStudyLog, type StudyTimeLog } from "../src/core/study-time.ts";
import { dailyStats, rangeDates, statsView, streaks } from "../src/core/stats.ts";
import { parseSideAction } from "../src/server/side-chat.ts";
import { localDate } from "../src/core/plan-progress.ts";
import type { LhMessage } from "../src/core/native-messages.ts";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const T0 = new Date(2026, 10, 2, 10, 0).getTime(); // Monday 2 Nov 10:00 local

let n = 0;
const text = (role: "user" | "assistant", t: string, at = T0): LhMessage =>
	({ id: `m${++n}`, role, content: role === "user" ? t : [{ type: "text", text: t }], timestamp: at }) as unknown as LhMessage;
function call(name: string, args: Record<string, unknown>, at = T0, result?: Record<string, unknown> | "none"): LhMessage[] {
	const id = `c${++n}`;
	const out = [{ id: `m${++n}`, role: "assistant", content: [{ type: "toolCall", id, name, arguments: args }], timestamp: at } as unknown as LhMessage];
	if (result !== "none") out.push({ id: `m${++n}`, role: "toolResult", toolCallId: id, toolName: name, content: [], details: result ?? {}, isError: false, timestamp: at } as unknown as LhMessage);
	return out;
}
const tree = { nodes: [{ id: "a", title: "Прва тема" }, { id: "b", title: "Druga tema" }, { id: "c", title: "Treća" }], edges: [], version: 1 } as never;

describe("topic notes", () => {
	const messages = [
		text("user", "probe chat"),
		...call("plan_init", { mermaid: "x" }),
		text("assistant", "Teaching A: definitions"),
		...call("quiz", { nodeId: "a", question: "QA" }, T0, { answeredAt: new Date(T0).toISOString(), correct: true }),
		text("assistant", "Feedback on A. Now teaching B"),
		...call("quiz", { nodeId: "b", question: "QB1" }, T0, { correct: false }),
		text("assistant", "Feedback B1"),
		...call("explain", { nodeId: "b", question: "QB2" }, T0, { text: "x" }),
		text("assistant", "Feedback B2"),
	];

	it("a step's window runs from the previous step's last question through its own feedback", () => {
		const w = nodeWindows(tree, messages);
		const textOf = (id: string) =>
			nodeMessages(w.get(id)!, messages)
				.map((m) => JSON.stringify((m as { content: unknown }).content))
				.join(" ");
		assert.match(textOf("a"), /Teaching A/);
		assert.match(textOf("a"), /Feedback on A/, "feedback included");
		assert.doesNotMatch(textOf("a"), /probe chat/, "nothing before the plan");
		assert.match(textOf("b"), /Now teaching B/);
		assert.match(textOf("b"), /Feedback B2/);
		assert.doesNotMatch(textOf("b"), /Teaching A/);
		assert.equal(w.has("c"), false, "untaught");
	});

	it("statuses: the current step waits, earlier ones are stale until written; titles in Latin", () => {
		const steps = noteSteps(tree, messages, undefined, "b");
		assert.deepEqual(steps.map((s) => s.status), ["stale", "pending", "untaught"]);
		assert.equal(steps[0]!.title, "Prva tema");
		assert.deepEqual(staleSteps(steps), ["a"]);
		assert.deepEqual(staleSteps(steps, true), ["a", "b"]);
		const lastA = (messages[nodeWindows(tree, messages).get("a")![0]![1]] as { id: string }).id;
		const written = noteSteps(tree, messages, { sections: { a: { markdown: "Beleška A", coveredTo: lastA, updatedAt: "x" } } }, "b");
		assert.equal(written[0]!.status, "written");
		const doc = notesDocument("Veb dizajn", written);
		assert.match(doc, /^# Veb dizajn\n\n## 1\. Prva tema\n\nBeleška A/);
		assert.match(doc, /## 3\. Treća\n\n_Još nije obrađeno\._/);
	});

	it("file names are safe", () => {
		assert.equal(notesFileName("Веб дизајн: CSS/HTML?"), "Veb dizajn CSS HTML.md");
		assert.equal(notesFileName("  ...  "), "Beleske.md");
	});
});

describe("side chats", () => {
	it("hides the answer key of the question the learner is answering now", () => {
		const msgs = [
			...call("quiz", { nodeId: "a", question: "Old", correctAnswer: "x", explanation: "e" }, T0, { correct: true }),
			...call("quiz", { nodeId: "b", question: "Open", correctAnswer: "SECRET", explanation: "WHY", options: [{ label: "o", value: "o" }] }, T0, "none"),
		];
		const open = openQuestionCallId(msgs);
		assert.ok(open);
		const red = JSON.stringify(redactOpenQuestion(msgs));
		assert.doesNotMatch(red, /SECRET|WHY/);
		assert.match(red, /"question":"Open"/);
		assert.match(red, /"correctAnswer":"x"/, "answered questions keep their key");
	});

	it("titles and action parsing", () => {
		assert.equal(sideThreadTitle("  Šta je   CDN?  "), "Šta je CDN?");
		assert.ok(sideThreadTitle("x".repeat(80)).endsWith("…"));
		assert.deepEqual(parseSideAction({ op: "ask", text: "q" }), { op: "ask", text: "q" });
		assert.equal(typeof parseSideAction({ op: "close", threadId: "__proto__" }), "string");
		assert.equal(typeof parseSideAction({ op: "make-card", threadId: "t" }), "string");
	});
});

describe("study time", () => {
	it("adds capped seconds per day and course; parses defensively", () => {
		let log = addStudySeconds(emptyStudyLog(), "2026-11-08", 30, "chat_1");
		log = addStudySeconds(log, "2026-11-08", 500, null);
		log = addStudySeconds(log, "bad", 30, null);
		assert.deepEqual(log.days, { "2026-11-08": { total: 90, chats: { chat_1: 30 } } });
		assert.deepEqual(parseStudyLog({ days: { "2026-11-08": { total: 5, chats: { x: 2, y: -1 } }, nope: {} } }).days, { "2026-11-08": { total: 5, chats: { x: 2 } } });
		assert.equal(chatIdFromPath("/chat/chat_abc"), "chat_abc");
		assert.equal(chatIdFromPath("/cards/chat_abc"), "chat_abc");
		assert.equal(chatIdFromPath("/chat/new"), null);
		assert.equal(chatIdFromPath("/stats"), null);
	});
});

describe("statistics", () => {
	const msgs = [
		...call("quiz", { nodeId: "a", question: "q1" }, T0, { answeredAt: new Date(T0).toISOString(), correct: true }),
		...call("quiz", { nodeId: "a", question: "q2" }, T0, { answeredAt: new Date(T0 + DAY).toISOString(), correct: false }),
		...call("explain", { nodeId: "a", question: "q3" }, T0, { answeredAt: new Date(T0 + DAY).toISOString(), text: "t" }),
		...call("quiz", { nodeId: "a", question: "q4" }, T0, { answeredAt: new Date(T0 + DAY).toISOString(), dismissed: true }),
		...call("plan_progress", { done: ["a"] }, T0 + DAY),
		...call("plan_progress", { done: ["a", "b"] }, T0 + 2 * DAY),
	];
	const cards = { states: { k: { reviews: [{ at: new Date(T0 + 2 * DAY).toISOString(), rating: 1 as const }, { at: new Date(T0 + 2 * DAY + MIN).toISOString(), rating: 3 as const }] } } };
	const study: StudyTimeLog = { version: 1, days: { [localDate(T0)]: { total: 600, chats: { c1: 600 } }, [localDate(T0 + 3 * DAY)]: { total: 30, chats: {} } } };

	it("per day: questions, accuracy, first-time steps, reviews, study time", () => {
		const d = dailyStats([{ id: "c1", messages: msgs, cards }], study);
		const day = (k: number) => d.get(localDate(T0 + k * DAY))!;
		assert.deepEqual([day(0).questions, day(0).correct, day(0).studySec], [1, 1, 600]);
		assert.deepEqual([day(1).questions, day(1).graded, day(1).correct, day(1).steps], [2, 1, 0, 1], "dismissed skipped; free recall ungraded");
		assert.deepEqual([day(2).steps, day(2).reviews, day(2).recalled], [1, 2, 1], "a counted once; b new");
		const only = dailyStats([{ id: "c1", messages: msgs, cards }], study, "c1");
		assert.equal(only.get(localDate(T0 + 3 * DAY)), undefined, "time outside the course is not the course's");
	});

	it("ranges, streaks, the view", () => {
		const d = dailyStats([{ id: "c1", messages: msgs, cards }], study);
		const now = T0 + 2 * DAY + 5 * 60 * MIN; // Wednesday
		assert.deepEqual(rangeDates("week", now, d), [localDate(T0), localDate(T0 + DAY), localDate(T0 + 2 * DAY)], "Monday-based week");
		assert.deepEqual(streaks(d, now), { current: 3, longest: 3, activeDays: 3 }, "30 s on day 4 is not a study day");
		const v = statsView([{ id: "c1", title: "Kurs", messages: msgs, cards }], study, now, null);
		assert.equal(v.last30.length, 30);
		assert.equal(v.year.length, 53 * 7);
		assert.equal(v.ranges.all.questions, 3);
		assert.equal(new Date(v.year.at(-1)!.date).getDay(), 0, "grid ends on Sunday");
	});
});

import { demoteHeadings } from "../src/server/notes.ts";
describe("notes headings", () => {
	it("# and ## become ### outside code fences", () => {
		assert.equal(demoteHeadings("## A\ntext\n# B\n```\n## code\n```\n### C"), "### A\ntext\n### B\n```\n## code\n```\n### C");
	});
});

import { openQuestionSummary } from "../src/core/side-chat.ts";
import { notesMarker, questionKeys } from "../src/core/notes.ts";
describe("review fixes (notes/side)", () => {
	it("the side agent is told the open question, never its key", () => {
		const msgs = call("quiz", { nodeId: "a", question: "Koja boja?", options: [{ label: "Crvena", value: "r" }, { label: "Plava", value: "b" }], correctAnswer: "b", explanation: "jer" }, T0, "none");
		const s = openQuestionSummary(msgs)!;
		assert.match(s, /Koja boja\?/);
		assert.match(s, /Crvena \| Plava/);
		assert.doesNotMatch(s, /jer|"b"/);
	});
	it("the notes writer gets the real answers", () => {
		const msgs = [
			...call("quiz", { nodeId: "a", question: "Koja boja?", options: [{ label: "Crvena", value: "r" }, { label: "Plava", value: "b" }], correctAnswer: "b", explanation: "Nebo je plavo." }),
			...call("explain", { nodeId: "a", question: "Šta je CSS?", correctAnswer: "Jezik za izgled." }),
		];
		const k = questionKeys(msgs);
		assert.match(k, /Tačno: Plava/);
		assert.match(k, /Zašto: Nebo je plavo\./);
		assert.match(k, /Tačan odgovor: Jezik za izgled\./);
		assert.equal(notesMarker("c1"), "<!-- learnharness:c1 -->");
	});
});

import { mistakeViews, openMistakesText, unanalysed, wrongAnswers } from "../src/core/mistakes.ts";
describe("mistake log", () => {
	const msgs = [
		...call("quiz", { nodeId: "a", question: "Q1", correctAnswer: "x" }, T0, { answeredAt: new Date(T0).toISOString(), correct: false }),
		text("assistant", "Ne, tačno je x jer…", T0 + MIN),
		...call("exercise", { nodeId: "b", question: "Q2", format: "blanks" }, T0, { answeredAt: new Date(T0 + MIN).toISOString(), exercise: { result: { graded: true, correct: false } } }),
		...call("quiz", { nodeId: "a", question: "Q3" }, T0, { answeredAt: new Date(T0 + 2 * MIN).toISOString(), correct: true }),
		...call("quiz", { nodeId: "c", question: "Q4" }, T0, { correct: false, dismissed: true }),
		...call("explain", { nodeId: "c", question: "Q5" }, T0, { text: "nešto" }),
	];
	it("only app-graded wrong answers count; feedback is the next teacher message", () => {
		const w = wrongAnswers(msgs);
		assert.deepEqual(w.map((x) => x.args.question), ["Q1", "Q2"]);
		assert.match(w[0]!.feedback, /tačno je x/);
	});
	it("a later right answer on the same step resolves; manual flags win; open list for the teacher", () => {
		const id1 = wrongAnswers(msgs)[0]!.callId;
		const id2 = wrongAnswers(msgs)[1]!.callId;
		const analysis = { type: "pojam" as const, whatWentWrong: "Pomešao A i B.", correctVersion: "x", rule: "Uvek proveri A.", at: "x" };
		const v = mistakeViews(msgs, { [id1]: { analysis }, [id2]: { analysis } }, tree);
		const byQ = (q: string) => v.find((m) => m.question === q)!;
		assert.equal(byQ("Q1").resolved, true, "Q3 on the same step was right later");
		assert.equal(byQ("Q1").resolvedByLaterAnswer, true);
		assert.equal(byQ("Q2").resolved, false);
		assert.equal(mistakeViews(msgs, { [id1]: { analysis, resolved: false } }, tree).find((m) => m.callId === id1)!.resolved, false, "reopened by hand");
		assert.match(openMistakesText(v), /\[b\] Pogrešno razumevanje pojma: Pomešao A i B\. Rule: Uvek proveri A\./);
		assert.deepEqual(unanalysed(msgs, { [id1]: { analysis } }).map((w) => w.callId), [id2]);
		assert.deepEqual(unanalysed(msgs, { [id1]: { analysis }, [id2]: { failures: 3 } }), [], "gives up after 3 failures");
	});
});

import { placementAnswerText, placementDecisionText, placementTestProblems, quizCorrect, startModeText } from "../src/core/placement.ts";
describe("placement", () => {
	const test = {
		title: "Test",
		topics: [
			{ id: "html", title: "HTML", questions: [
				{ id: "q1", kind: "quiz" as const, question: "?", options: [{ label: "A", value: "a" }, { label: "B", value: "b" }, { label: "C", value: "c" }], correctAnswer: "b" },
				{ id: "q2", kind: "short" as const, question: "?", correctAnswer: "odgovor" },
			] },
			{ id: "css", title: "CSS", questions: [{ id: "q3", kind: "math" as const, question: "?", correctAnswer: "2x" }] },
		],
	};
	it("validates authoring", () => {
		assert.deepEqual(placementTestProblems(test), []);
		const bad = { ...test, topics: [{ ...test.topics[0]!, questions: [{ ...test.topics[0]!.questions[0]!, correctAnswer: "z" }, { ...test.topics[0]!.questions[1]!, id: "q1" }] }] };
		const p = placementTestProblems(bad);
		assert.ok(p.some((x) => /correctAnswer must be option/.test(x)));
		assert.ok(p.some((x) => /duplicate question id/.test(x)));
	});
	it("answer and decision texts carry per-topic results", () => {
		assert.equal(quizCorrect(test.topics[0]!.questions[0]!, ["b"]), true);
		const a = JSON.parse(placementAnswerText(test, [{ qid: "q1", value: ["b"], correct: true }, { qid: "q2", value: "nešto" }, { qid: "q3", value: "", dontKnow: true, correct: false }]));
		assert.equal(a.topics[0].autoGraded, "1/1");
		assert.equal(a.topics[1].questions[0].answer, "(ne znam)");
		const d = JSON.parse(placementDecisionText({ topics: [{ id: "html", title: "HTML", score: 90, proposal: "znam" }, { id: "css", title: "CSS", score: 20, proposal: "ucim" }] }, { css: "ponoviti" }));
		assert.deepEqual(d.placementDecisions.map((x: { decision: string }) => x.decision), ["znam", "ponoviti"]);
		assert.equal(d.placementDecisions[1].changedByLearner, "from ucim");
		assert.match(startModeText("test"), /placement_test/);
		assert.match(startModeText("nula"), /probe_done immediately/);
	});
});
