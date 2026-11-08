/**
 * Fork (2026-11-08): Kartice — cards from the transcript, FSRS replay,
 * today's queue, exam cap, forecast and actions.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildCards,
	cardForecast,
	cardQueue,
	DEFAULT_CARD_SETTINGS,
	examCap,
	formatInterval,
	normalizeCardSettings,
	previewRatings,
	type CourseCards,
} from "../src/core/cards.ts";
import { parseCardAction } from "../src/server/cards.ts";
import type { LhMessage } from "../src/core/native-messages.ts";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const T0 = new Date(2026, 10, 1, 10, 0).getTime(); // local 1 Nov 10:00

let n = 0;
function ask(tool: string, args: Record<string, unknown>, at: number, answer?: Record<string, unknown> | "error"): LhMessage[] {
	const id = `call_${++n}`;
	const out: LhMessage[] = [{ id: `m${n}`, role: "assistant", content: [{ type: "toolCall", id, name: tool, arguments: args }], timestamp: at } as unknown as LhMessage];
	if (answer === "error") out.push({ id: `r${n}`, role: "toolResult", toolCallId: id, toolName: tool, content: [], isError: true, timestamp: at } as unknown as LhMessage);
	else if (answer) out.push({ id: `r${n}`, role: "toolResult", toolCallId: id, toolName: tool, content: [], details: { answeredAt: new Date(at + MIN).toISOString(), ...answer }, isError: false, timestamp: at + MIN } as unknown as LhMessage);
	return out;
}
const quiz = (nodeId: string, q: string) => ({ type: "check", nodeId, question: q, options: [{ label: "a", value: "a" }], correctAnswer: "a", explanation: "x" });
const settings = DEFAULT_CARD_SETTINGS;

describe("cards from the transcript", () => {
	const messages = [
		...ask("quiz", quiz("css", "Q1"), T0, { correct: true }),
		...ask("quiz", quiz("css", "Q2"), T0 + MIN, { correct: false }),
		...ask("explain", { type: "check", nodeId: "http", question: "Q3", correctAnswer: "A" }, T0 + 2 * MIN, { text: "..." }),
		...ask("exercise", { type: "check", nodeId: "sql", format: "sql", question: "Q4" }, T0 + 3 * MIN, { exercise: { result: { graded: true, correct: true } } }),
		...ask("quiz", quiz("css", "rejected"), T0 + 4 * MIN, "error"),
		...ask("quiz", quiz("css", "still open"), T0 + 5 * MIN),
		...ask("plan_progress", { done: ["css"] }, T0 + 6 * MIN, {}),
		...ask("quiz", { ...quiz("css", "Q5"), nodeId: undefined }, T0 + 7 * MIN, { correct: true }),
	];
	const tree = { nodes: [{ id: "css", title: "CSS boje" }], edges: [], version: 1 } as never;

	it("answered, node-tagged questions become cards; rejected/open/untagged don't", () => {
		const cards = buildCards({ messages, cards: undefined, tree, settings, now: T0 + DAY });
		assert.deepEqual(cards.map((c) => c.question), ["Q1", "Q2", "Q3", "Q4"]);
		assert.equal(cards[0]!.nodeTitle, "CSS boje");
	});

	it("the graded chat answer is the first review; free recall stays new", () => {
		const [q1, q2, q3, q4] = buildCards({ messages, cards: undefined, tree, settings, now: T0 + DAY });
		assert.equal(q1!.fromChatAnswer, true);
		assert.equal(q1!.reps, 1);
		assert.notEqual(q1!.status, "new");
		assert.equal(q2!.lapses, 0, "a first Again is not a lapse");
		assert.ok(q2!.due! < q1!.due!, "the wrong one comes back sooner");
		assert.equal(q3!.status, "new");
		assert.equal(q3!.due, null);
		assert.equal(q4!.fromChatAnswer, true);
	});

	it("stored reviews replay on top; suspended, known and deleted are honoured", () => {
		const base = buildCards({ messages, cards: undefined, settings, now: T0 + DAY });
		const id1 = base[0]!.id, id2 = base[1]!.id, id3 = base[2]!.id, id4 = base[3]!.id;
		const cards: CourseCards = {
			states: {
				[id1]: { reviews: [{ at: new Date(T0 + DAY).toISOString(), rating: 3 }] },
				[id2]: { suspended: true },
				[id3]: { known: true },
				[id4]: { deleted: true },
			},
		};
		const built = buildCards({ messages, cards, settings, now: T0 + DAY });
		assert.equal(built.length, 3, "deleted card gone");
		assert.equal(built[0]!.reps, 2);
		assert.ok(built[0]!.due! > base[0]!.due!, "a second Good pushes it further");
		assert.equal(built[1]!.status, "suspended");
		assert.equal(built[2]!.status, "known");
		const q = cardQueue(built, cards, settings, T0 + DAY);
		assert.ok(!q.ids.includes(id2) && !q.ids.includes(id3), "paused/known never queued");
	});

	it("generated cards join the deck as new cards", () => {
		const cards: CourseCards = { generated: [{ id: "g_1", tool: "quiz", nodeId: "css", args: quiz("css", "G1"), createdAt: new Date(T0).toISOString() }] };
		const built = buildCards({ messages, cards, settings, now: T0 + DAY });
		const g = built.find((c) => c.id === "g_1")!;
		assert.equal(g.source, "generated");
		assert.equal(g.status, "new");
	});
});

describe("queue, limits, exam cap, forecast", () => {
	const many = Array.from({ length: 30 }, (_, i) => ask("explain", { type: "check", nodeId: "a", question: `E${i}`, correctAnswer: "x" }, T0 + i * MIN, { text: "t" })).flat();

	it("new cards are limited per day and today's introductions count against it", () => {
		const built = buildCards({ messages: many, cards: undefined, settings, now: T0 + DAY });
		const q = cardQueue(built, undefined, settings, T0 + DAY);
		assert.equal(q.newCount, 20);
		const now = T0 + DAY;
		const states = Object.fromEntries(built.slice(0, 5).map((c) => [c.id, { reviews: [{ at: new Date(now - MIN).toISOString(), rating: 3 as const }] }]));
		const cards: CourseCards = { states };
		const q2 = cardQueue(buildCards({ messages: many, cards, settings, now }), cards, settings, now);
		assert.equal(q2.newCount, 15, "5 introduced today");
		assert.equal(cardQueue(built, undefined, { ...settings, newPerDay: 0 }, now).newCount, 0);
	});

	it("a due learning card comes first; nothing after the day before the exam", () => {
		const msgs = [...ask("quiz", quiz("a", "W"), T0, { correct: false }), ...ask("quiz", quiz("a", "R"), T0, { correct: true })];
		const now = T0 + 2 * DAY;
		const built = buildCards({ messages: msgs, cards: undefined, settings, now });
		const q = cardQueue(built, undefined, settings, now);
		assert.equal(built.find((c) => c.id === q.ids[0])!.question, "W");
		// Exam on 5 Nov: cap = start of 4 Nov.
		const cap = examCap("2026-11-05", now)!;
		assert.equal(new Date(cap).getDate(), 4);
		const p = previewRatings({ messages: msgs, cards: undefined, settings, examDate: "2026-11-05", now }, built[1]!.id)!;
		assert.ok(p[4] <= cap, "even Lako stays before the exam");
		assert.equal(examCap("2026-11-02", now), null, "exam already past: no cap");
	});

	it("forecast counts due cards by day and reviews left until the exam", () => {
		const msgs = [...ask("quiz", quiz("a", "1"), T0, { correct: true }), ...ask("quiz", quiz("a", "2"), T0, { correct: false })];
		const f = cardForecast({ messages: msgs, cards: undefined, settings, examDate: "2026-11-20", now: T0 + DAY }, 7);
		assert.equal(f.days.length, 7);
		assert.equal(f.days.reduce((a, b) => a + b, 0), 2);
		assert.ok(f.untilExam !== null && f.untilExam >= 2);
		assert.equal(cardForecast({ messages: msgs, cards: undefined, settings, now: T0 }).untilExam, null);
	});
});

describe("helpers", () => {
	it("formats intervals in Serbian", () => {
		assert.equal(formatInterval(5 * MIN), "5 min");
		assert.equal(formatInterval(3 * 60 * MIN), "3 h");
		assert.equal(formatInterval(DAY), "1 dan");
		assert.equal(formatInterval(5 * DAY), "5 dana");
		assert.equal(formatInterval(60 * DAY), "2 mes.");
	});

	it("settings are clamped and actions validated", () => {
		assert.deepEqual(normalizeCardSettings({ newPerDay: 9999, retention: 2 }), { ...DEFAULT_CARD_SETTINGS, newPerDay: 500 });
		assert.deepEqual(parseCardAction({ op: "review", cardId: "x", rating: 3 }), { op: "review", cardId: "x", rating: 3 });
		assert.equal(typeof parseCardAction({ op: "review", cardId: "x", rating: 5 }), "string");
		assert.deepEqual(parseCardAction({ op: "flags", cardId: "x", known: true }), { op: "flags", cardId: "x", known: true });
		assert.equal(typeof parseCardAction({ op: "nope" }), "string");
	});
});
