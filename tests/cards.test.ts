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
		const p = previewRatings({ messages: msgs, cards: undefined, settings, examDate: "2026-11-05", now }, [built[1]!.id])[built[1]!.id]!;
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

import { toSerbianLatin } from "../src/core/serbian-latin.ts";
describe("Serbian Latin for old Cyrillic records", () => {
	it("transliterates, keeping Latin, code and digraph case right", () => {
		assert.equal(toSerbianLatin("Страни кључ повезивање"), "Strani ključ povezivanje");
		assert.equal(toSerbianLatin("Љубав, ЉУБАВ, Џеп, Њива"), "Ljubav, LJUBAV, Džep, Njiva");
		assert.equal(toSerbianLatin("SELECT * FROM t — Шта"), "SELECT * FROM t — Šta");
		assert.equal(toSerbianLatin("already latin"), "already latin");
	});
});

describe("learn ahead", () => {
	it("a learning card due within 20 min is shown when nothing else is left", () => {
		const msgs = ask("quiz", quiz("a", "L"), T0, { correct: false });
		const id = buildCards({ messages: msgs, cards: undefined, settings, now: T0 }).find(() => true)!.id;
		// Reviewed next day with Ponovo → relearning, back in minutes.
		const cards: CourseCards = { states: { [id]: { reviews: [{ at: new Date(T0 + DAY).toISOString(), rating: 1 }] } } };
		const now = T0 + DAY + 30_000;
		const built = buildCards({ messages: msgs, cards, settings, now });
		assert.equal(built[0]!.status, "learning");
		const q = cardQueue(built, cards, settings, now);
		assert.deepEqual(q.ids, [built[0]!.id], "Ponovo → back within minutes, learned ahead");
		assert.equal(q.nextDue, null);
	});
});

import { draftProblem, draftsToGenerated, toDraft } from "../src/server/card-generation.ts";
describe("AI card drafts", () => {
	const ids = new Set(["css"]);
	const quizDraft = { nodeId: "css", tool: "quiz" as const, question: "Q?", options: [{ label: "a", value: "a" }, { label: "b", value: "b" }, { label: "c", value: "c" }], correctAnswer: "b", explanation: "x" };
	it("validates step, options and the correct answer", () => {
		assert.equal(draftProblem(quizDraft, ids), null);
		assert.match(draftProblem({ ...quizDraft, nodeId: "nope" }, ids)!, /unknown nodeId/);
		assert.match(draftProblem({ ...quizDraft, options: quizDraft.options.slice(0, 2) }, ids)!, /3-5 options/);
		assert.match(draftProblem({ ...quizDraft, correctAnswer: "z" }, ids)!, /does not match/);
		assert.match(draftProblem({ nodeId: "css", tool: "explain", question: "Q", correctAnswer: " " }, ids)!, /correctAnswer/);
	});
	it("kept drafts become generated cards the deck can review", () => {
		const [g] = draftsToGenerated([toDraft(quizDraft)], T0);
		const built = buildCards({ messages: [], cards: { generated: [g!] }, settings, now: T0 + MIN });
		assert.equal(built.length, 1);
		assert.equal(built[0]!.tool, "quiz");
		assert.equal(built[0]!.args.correctAnswer, "b");
		const action = parseCardAction({ op: "add", drafts: [toDraft(quizDraft)] });
		assert.equal(typeof action, "object");
		assert.equal(typeof parseCardAction({ op: "add", drafts: [] }), "string");
	});
});


describe("review fixes (2026-11-08)", () => {
	it("the exam cap brings a card back on the day before the exam", () => {
		// Answered right on 1 Nov, then Lako twice: due far after a 20 Nov exam.
		const msgs = ask("quiz", quiz("a", "X"), T0, { correct: true });
		const id = buildCards({ messages: msgs, cards: undefined, settings, now: T0 }).find(() => true)!.id;
		const cards: CourseCards = { states: { [id]: { reviews: [{ at: new Date(T0 + 3 * DAY).toISOString(), rating: 4 }, { at: new Date(T0 + 10 * DAY).toISOString(), rating: 4 }] } } };
		const at = (d: number, h: number) => new Date(2026, 10, d, h).getTime();
		const dueOn = (now: number) => {
			const built = buildCards({ messages: msgs, cards, settings, examDate: "2026-11-20", now });
			return { due: built[0]!.due!, queued: cardQueue(built, cards, settings, now).ids.includes(id) };
		};
		const d17 = dueOn(at(17, 12));
		assert.equal(new Date(d17.due).getDate(), 19, "capped to the start of the 19th");
		assert.equal(d17.queued, false, "not yet on the 17th");
		assert.equal(dueOn(at(19, 0) + 60_000).queued, true, "due right after midnight on the 19th");
		assert.equal(dueOn(at(19, 23)).queued, true, "still due late on the 19th");
		const f = cardForecast({ messages: msgs, cards, settings, examDate: "2026-11-20", now: at(17, 12) });
		assert.equal(f.untilExam, 1, "the capped review counts");
		assert.equal(examCap("2026-11-20", at(20, 9)), null, "exam day: no cap");
	});

	it("chat answers come back in days, so they don't flood today's queue", () => {
		const msgs = Array.from({ length: 30 }, (_, i) => ask("quiz", quiz("a", `C${i}`), T0, { correct: true })).flat();
		const now = T0 + 2 * 60 * MIN;
		const built = buildCards({ messages: msgs, cards: undefined, settings, now });
		assert.ok(built.every((c) => c.status === "review" && c.due! > now + DAY), "right answers: due in a few days");
		assert.equal(cardQueue(built, undefined, settings, now).ids.length, 0);
		const wrong = buildCards({ messages: ask("quiz", quiz("a", "W"), T0, { correct: false }), cards: undefined, settings, now: T0 + DAY + 2 * 60 * MIN });
		assert.equal(cardQueue(wrong, undefined, settings, T0 + DAY + 2 * 60 * MIN).ids.length, 1, "a wrong one is due the next day");
	});

	it("a right but unsure chat answer (< 50%) comes back sooner", () => {
		const sure = buildCards({ messages: ask("quiz", quiz("a", "S"), T0, { correct: true, confidence: 90 }), cards: undefined, settings, now: T0 + MIN })[0]!;
		const unsure = buildCards({ messages: ask("quiz", quiz("a", "U"), T0, { correct: true, confidence: 30 }), cards: undefined, settings, now: T0 + MIN })[0]!;
		assert.ok(unsure.due! < sure.due!);
	});

	it("prototype keys are never card ids", () => {
		assert.equal(ownStateOf({ states: {} }, "__proto__"), undefined);
		assert.equal(ownStateOf({ states: {} }, "constructor"), undefined);
	});
});

import { ownState as ownStateOf } from "../src/core/cards.ts";
