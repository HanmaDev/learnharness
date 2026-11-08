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
