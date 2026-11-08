/**
 * Kartice (fork, 2026-11-08): Anki-style spaced repetition over the
 * questions the teacher asked. See docs/fork-plans/kartice-plan.md.
 *
 * A CARD is either
 *   - a question from the transcript: a teacher `quiz` / `explain` /
 *     `exercise` call tagged with a plan node (id = the tool call id), or
 *   - a generated card ("Nova pitanja"), stored with its own question args.
 * Only the learner's REVIEWS are stored (ChatRecord.cards.states); the
 * schedule is replayed from them with FSRS, so the algorithm settings can
 * change without any migration. The learner's original answer in the chat
 * counts as the first review when the app graded it (quiz / exercise).
 */
import { createEmptyCard, fsrs, Rating, State, type Card as FsrsCard, type FSRS } from "ts-fsrs";
import type { PlanTree } from "./contracts/plan.ts";
import type { LhMessage } from "./native-messages.ts";

export type CardTool = "quiz" | "explain" | "exercise";
/** 1 Ponovo · 2 Teško · 3 Dobro · 4 Lako (FSRS Again/Hard/Good/Easy). */
export type CardRating = 1 | 2 | 3 | 4;
export const CARD_RATINGS: readonly CardRating[] = [1, 2, 3, 4];

export interface CardReview {
	/** ISO time. */
	at: string;
	rating: CardRating;
	/** The app's check of the answer, when it could make one. */
	correct?: boolean;
}

/** What the learner did to one card. */
export interface CardState {
	reviews?: CardReview[];
	/** Paused: never due until resumed. */
	suspended?: boolean;
	/** "Već znam": out of the queue for good (can be undone). */
	known?: boolean;
	/** Removed from the deck (a tombstone, so a transcript card stays gone). */
	deleted?: boolean;
}

/** A card made on request, not asked in the chat. */
export interface GeneratedCard {
	id: string;
	tool: "quiz" | "explain";
	nodeId: string;
	/** The question tool's arguments (same shape as a teacher call). */
	args: Record<string, unknown>;
	createdAt: string;
}

/** ChatRecord.cards — per course. */
export interface CourseCards {
	/** The course's own switch; absent = on. */
	enabled?: boolean;
	states?: Record<string, CardState>;
	generated?: GeneratedCard[];
}

/** Global card settings (Settings → General). */
export interface CardSettings {
	enabled: boolean;
	newPerDay: number;
	maxReviewsPerDay: number;
	/** Target recall probability, 0.7–0.97. */
	retention: number;
}

export const DEFAULT_CARD_SETTINGS: CardSettings = { enabled: true, newPerDay: 20, maxReviewsPerDay: 200, retention: 0.9 };

export type CardStatus = "new" | "learning" | "review" | "suspended" | "known";

export interface Card {
	id: string;
	source: "chat" | "generated";
	tool: CardTool;
	nodeId: string;
	nodeTitle: string | null;
	question: string;
	args: Record<string, unknown>;
	createdAt: number;
	status: CardStatus;
	/** ms; null for a new card. Capped before the exam date. */
	due: number | null;
	reps: number;
	lapses: number;
	/** The last time it was reviewed (chat answer included). */
	lastReview: number | null;
	/** The learner's answer in the chat counted as the first review. */
	fromChatAnswer: boolean;
}

// ─── Building cards from a record ──────────────────────────────────────────

const CARD_TOOLS: readonly CardTool[] = ["quiz", "explain", "exercise"];

interface CallBlock {
	type?: string;
	id?: string;
	name?: string;
	arguments?: unknown;
}

interface ChatAnswer {
	at: number;
	/** The learner's stated confidence (quiz, 0-100), when given. */
	confidence?: number;
	/** Graded by the app (quiz / graded exercise). */
	correct?: boolean;
	skipped: boolean;
}

function answersByCall(messages: readonly LhMessage[]): Map<string, ChatAnswer> {
	const out = new Map<string, ChatAnswer>();
	for (const m of messages) {
		const r = m as { role?: string; toolCallId?: string; isError?: boolean; details?: unknown; timestamp?: number };
		if (r.role !== "toolResult" || typeof r.toolCallId !== "string" || r.isError) continue;
		const d = (r.details ?? {}) as {
			correct?: unknown;
			dontKnow?: unknown;
			dismissed?: unknown;
			setAside?: unknown;
			answeredAt?: unknown;
			confidence?: unknown;
			exercise?: { result?: { graded?: unknown; correct?: unknown } };
		};
		const at = typeof d.answeredAt === "string" ? Date.parse(d.answeredAt) : (r.timestamp ?? 0);
		const skipped = d.dismissed === true || d.setAside === true;
		let correct: boolean | undefined;
		if (typeof d.correct === "boolean") correct = d.correct;
		else if (d.exercise?.result && d.exercise.result.graded !== false && typeof d.exercise.result.correct === "boolean") correct = d.exercise.result.correct;
		if (d.dontKnow === true) correct = false;
		const confidence = typeof d.confidence === "number" && Number.isFinite(d.confidence) ? d.confidence : undefined;
		out.set(r.toolCallId, { at: Number.isFinite(at) ? at : (r.timestamp ?? 0), correct, skipped, ...(confidence !== undefined ? { confidence } : {}) });
	}
	return out;
}

interface RawCard {
	id: string;
	source: Card["source"];
	tool: CardTool;
	nodeId: string;
	args: Record<string, unknown>;
	createdAt: number;
	chatAnswer?: ChatAnswer;
}

/** Every card the course has (deleted ones excluded). */
function rawCards(messages: readonly LhMessage[], cards: CourseCards | undefined): RawCard[] {
	const answers = answersByCall(messages);
	const out: RawCard[] = [];
	for (const m of messages) {
		if ((m as { role?: string }).role !== "assistant") continue;
		const content = (m as { content?: unknown }).content;
		if (!Array.isArray(content)) continue;
		for (const block of content as CallBlock[]) {
			if (block.type !== "toolCall" || !block.id || !CARD_TOOLS.includes(block.name as CardTool)) continue;
			const args = block.arguments && typeof block.arguments === "object" ? (block.arguments as Record<string, unknown>) : {};
			if (typeof args.nodeId !== "string" || typeof args.question !== "string" || !args.question.trim()) continue;
			// Only questions the learner got to: answered (or skipped) ones.
			// A rejected call has an error result; an open one has none yet.
			if (!answers.has(block.id)) continue;
			if (ownState(cards, block.id)?.deleted) continue;
			out.push({
				id: block.id,
				source: "chat",
				tool: block.name as CardTool,
				nodeId: args.nodeId,
				args,
				createdAt: (m as { timestamp?: number }).timestamp ?? 0,
				chatAnswer: answers.get(block.id),
			});
		}
	}
	for (const g of cards?.generated ?? []) {
		if (ownState(cards, g.id)?.deleted) continue;
		out.push({ id: g.id, source: "generated", tool: g.tool, nodeId: g.nodeId, args: g.args, createdAt: Date.parse(g.createdAt) || 0 });
	}
	return out;
}

/** A card's stored state — own keys only (a "__proto__" id is never a card). */
export function ownState(cards: CourseCards | undefined, id: string): CardState | undefined {
	const states = cards?.states;
	return states && Object.prototype.hasOwnProperty.call(states, id) ? states[id] : undefined;
}

// ─── Scheduling ────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60_000;

export function scheduler(settings: CardSettings): FSRS {
	return fsrs({ request_retention: settings.retention, enable_fuzz: false, maximum_interval: 3650 });
}

/** For the chat answer only: no minute-long learning steps, so a question
 *  answered in the chat comes back in days (wrong → tomorrow, right → a few
 *  days), not "due now" for every past question. */
function chatScheduler(settings: CardSettings): FSRS {
	return fsrs({ request_retention: settings.retention, enable_fuzz: false, maximum_interval: 3650, enable_short_term: false });
}

/** Local midnight of a YYYY-MM-DD date, `shift` days later (DST-safe). */
function localMidnight(date: string, shift = 0): number {
	const [y, m, d] = date.split("-").map(Number) as [number, number, number];
	return new Date(y, m - 1, d + shift).getTime();
}

/** The latest moment a card may be due: the start of the day before the
 *  exam. Active until the exam day begins — on the day before, a capped
 *  card is simply due (cap <= now). */
export function examCap(examDate: string | null | undefined, now: number): number | null {
	if (!examDate) return null;
	return now < localMidnight(examDate) ? localMidnight(examDate, -1) : null;
}

/** Start of the exam day (null without a date). */
function examStart(examDate: string | null | undefined): number | null {
	return examDate ? localMidnight(examDate) : null;
}

const capDue = (due: number, cap: number | null) => (cap !== null && due > cap ? cap : due);

/** The chat answer as a rating: wrong → Ponovo, right but unsure (< 50%) → Teško, right → Dobro. */
function chatRating(a: ChatAnswer): Rating.Again | Rating.Hard | Rating.Good {
	if (!a.correct) return Rating.Again;
	return a.confidence !== undefined && a.confidence < 50 ? Rating.Hard : Rating.Good;
}

/** Replay one card's reviews (the chat answer first, when graded). */
function replay(raw: RawCard, state: CardState | undefined, f: FSRS, fChat: FSRS): { card: FsrsCard; reviews: number; last: number | null; fromChat: boolean } {
	let card = createEmptyCard(new Date(raw.createdAt));
	let reviews = 0;
	let last: number | null = null;
	let fromChat = false;
	const a = raw.chatAnswer;
	if (a && !a.skipped && typeof a.correct === "boolean") {
		card = fChat.next(card, new Date(a.at), chatRating(a)).card;
		reviews++;
		last = a.at;
		fromChat = true;
	}
	for (const r of state?.reviews ?? []) {
		const at = Date.parse(r.at);
		if (!Number.isFinite(at)) continue;
		card = f.next(card, new Date(at), r.rating as unknown as Rating.Again).card;
		reviews++;
		last = at;
	}
	return { card, reviews, last, fromChat };
}

export interface BuildCardsInput {
	messages: readonly LhMessage[];
	cards: CourseCards | undefined;
	tree?: PlanTree;
	settings: CardSettings;
	examDate?: string | null;
	now: number;
}

/** All cards of a course with their current schedule. */
export function buildCards({ messages, cards, tree, settings, examDate, now }: BuildCardsInput): Card[] {
	const f = scheduler(settings);
	const fChat = chatScheduler(settings);
	const titles = new Map((tree?.nodes ?? []).map((n) => [n.id, n.title]));
	const cap = examCap(examDate, now);
	return rawCards(messages, cards).map((raw) => {
		const state = ownState(cards, raw.id);
		const { card, reviews, last, fromChat } = replay(raw, state, f, fChat);
		const isNew = reviews === 0;
		let status: CardStatus = isNew ? "new" : card.state === State.Review ? "review" : "learning";
		if (state?.suspended) status = "suspended";
		if (state?.known) status = "known";
		return {
			id: raw.id,
			source: raw.source,
			tool: raw.tool,
			nodeId: raw.nodeId,
			nodeTitle: titles.get(raw.nodeId) ?? null,
			question: String(raw.args.question),
			args: raw.args,
			createdAt: raw.createdAt,
			status,
			due: isNew ? null : capDue(card.due.getTime(), cap),
			reps: reviews,
			lapses: card.lapses,
			lastReview: last,
			fromChatAnswer: fromChat,
		};
	});
}

/** Start of the learner's local day containing `now`. */
export function dayStart(now: number): number {
	const d = new Date(now);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Reviews the learner made today, and how many of them introduced a new card. */
function todayCounts(cards: CourseCards | undefined, built: readonly Card[], now: number) {
	const start = dayStart(now);
	let reviewed = 0;
	let introduced = 0;
	for (const c of built) {
		const rs = ownState(cards, c.id)?.reviews ?? [];
		const today = rs.filter((r) => Date.parse(r.at) >= start);
		reviewed += today.length;
		// Introduced today: its very first review (no graded chat answer) is today.
		if (!c.fromChatAnswer && rs.length && Date.parse(rs[0]!.at) >= start) introduced++;
	}
	return { reviewed, introduced };
}

export interface CardQueue {
	/** Card ids in review order: due learning, due reviews, then new. */
	ids: string[];
	dueCount: number;
	newCount: number;
	reviewedToday: number;
	/** When the next card outside the queue comes due (ms), if any. */
	nextDue: number | null;
}

/** Learning cards this close to due are shown early when nothing else is left. */
export const LEARN_AHEAD_MS = 20 * 60_000;

/** Today's queue. A card is due when its time has come (learning steps are
 *  minutes) or, for review cards, any time today. */
export function cardQueue(built: readonly Card[], cards: CourseCards | undefined, settings: CardSettings, now: number): CardQueue {
	const end = dayStart(now) + DAY;
	const { reviewed, introduced } = todayCounts(cards, built, now);
	const active = built.filter((c) => c.status === "learning" || c.status === "review");
	const due = active
		.filter((c) => c.due !== null && (c.due <= now || (c.status === "review" && c.due < end)))
		.sort((a, b) => (a.status === b.status ? a.due! - b.due! : a.status === "learning" ? -1 : 1));
	const reviewRoom = Math.max(0, settings.maxReviewsPerDay - reviewed);
	const dueIds = due.slice(0, reviewRoom).map((c) => c.id);
	const newRoom = Math.max(0, settings.newPerDay - introduced);
	const fresh = built.filter((c) => c.status === "new").sort((a, b) => a.createdAt - b.createdAt).slice(0, newRoom);
	// Learn ahead (Anki's 20 min): with nothing else left, a learning card
	// due soon is shown now instead of making the learner wait.
	const ahead =
		dueIds.length === 0 && fresh.length === 0
			? active.filter((c) => c.status === "learning" && c.due !== null && c.due <= now + LEARN_AHEAD_MS).sort((a, b) => a.due! - b.due!).map((c) => c.id)
			: [];
	const nextDue = active.filter((c) => c.due !== null && c.due > now && !ahead.includes(c.id)).reduce<number | null>((m, c) => (m === null || c.due! < m ? c.due! : m), null);
	return { ids: [...dueIds, ...ahead, ...fresh.map((c) => c.id)], dueCount: dueIds.length + ahead.length, newCount: fresh.length, reviewedToday: reviewed, nextDue };
}

/** When each rating would bring each card back (for the buttons) — one
 *  transcript pass for all the ids. */
export function previewRatings(
	input: Pick<BuildCardsInput, "messages" | "cards" | "settings" | "examDate" | "now">,
	cardIds: readonly string[],
): Record<string, Record<CardRating, number>> {
	const f = scheduler(input.settings);
	const fChat = chatScheduler(input.settings);
	const want = new Set(cardIds);
	const cap = examCap(input.examDate, input.now);
	const out: Record<string, Record<CardRating, number>> = {};
	for (const r of rawCards(input.messages, input.cards)) {
		if (!want.has(r.id)) continue;
		const { card } = replay(r, ownState(input.cards, r.id), f, fChat);
		const next = f.repeat(card, new Date(input.now));
		const one = {} as Record<CardRating, number>;
		for (const g of CARD_RATINGS) one[g] = capDue(next[g as unknown as Rating.Again].card.due.getTime(), cap);
		out[r.id] = one;
	}
	return out;
}

export interface CardForecast {
	/** Due counts for the next `days` local days (index 0 = today, overdue included). */
	days: number[];
	/** Reviews left until the exam if every answer is "Dobro" (null without an exam date). */
	untilExam: number | null;
}

/** The load ahead: cards by due day, and the reviews needed before the exam. */
export function cardForecast(input: BuildCardsInput, days = 14): CardForecast {
	const { now, settings } = input;
	const built = buildCards(input);
	const today = dayStart(now);
	const counts = new Array<number>(days).fill(0);
	for (const c of built) {
		if (c.status !== "learning" && c.status !== "review") continue;
		const i = Math.max(0, Math.floor((c.due! - today) / DAY));
		if (i < days) counts[i]!++;
	}
	let untilExam: number | null = null;
	const cap = examCap(input.examDate, now);
	const start = examStart(input.examDate);
	if (cap !== null && start !== null) {
		// Simulate "Dobro" on every review before the exam day. A review due
		// after the cap is pulled back to it; once a card has been reviewed
		// on/after the cap, its next one falls after the exam.
		const f = scheduler(settings);
		const fChat = chatScheduler(settings);
		untilExam = 0;
		for (const raw of rawCards(input.messages, input.cards)) {
			const state = ownState(input.cards, raw.id);
			if (state?.suspended || state?.known) continue;
			let { card } = replay(raw, state, f, fChat);
			let at = Math.max(now, capDue(card.due.getTime(), cap));
			for (let guard = 0; at < start && guard < 50; guard++) {
				untilExam++;
				if (at >= cap) break;
				card = f.next(card, new Date(at), Rating.Good).card;
				at = Math.max(at, capDue(card.due.getTime(), cap));
			}
		}
	}
	return { days: counts, untilExam };
}

/** "< 10 min", "3 h", "5 dana", "2 mes." — the button labels (Serbian Latin). */
export function formatInterval(ms: number): string {
	const min = Math.max(1, Math.round(ms / 60_000));
	if (min < 60) return `${min} min`;
	const h = Math.round(min / 60);
	if (h < 24) return `${h} h`;
	const d = Math.round(h / 24);
	if (d < 31) return d === 1 ? "1 dan" : `${d} dana`;
	const mo = Math.round(d / 30);
	if (mo < 12) return `${mo} mes.`;
	return `${(d / 365).toFixed(1)} god.`;
}

/** The app's suggested rating after it checked the answer (null = the learner decides). */
export function suggestedRating(correct: boolean | undefined): CardRating | null {
	if (correct === true) return 3;
	if (correct === false) return 1;
	return null;
}

export function isCardRating(v: unknown): v is CardRating {
	return v === 1 || v === 2 || v === 3 || v === 4;
}

/** Clamp/validate a settings object coming from the UI. */
export function normalizeCardSettings(v: Partial<CardSettings> | undefined): CardSettings {
	const d = DEFAULT_CARD_SETTINGS;
	const int = (x: unknown, lo: number, hi: number, dflt: number) => (typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : dflt);
	return {
		enabled: typeof v?.enabled === "boolean" ? v.enabled : d.enabled,
		newPerDay: int(v?.newPerDay, 0, 500, d.newPerDay),
		maxReviewsPerDay: int(v?.maxReviewsPerDay, 1, 5000, d.maxReviewsPerDay),
		retention: typeof v?.retention === "number" && v.retention >= 0.7 && v.retention <= 0.97 ? v.retention : d.retention,
	};
}

// ─── View shapes (built on the server, read by the browser) ────────────────

export interface CourseCardsView {
	chatId: string;
	title: string;
	/** The course's own switch. */
	enabled: boolean;
	/** The app-wide switch (Settings). */
	globalEnabled: boolean;
	settings: CardSettings;
	examDate: string | null;
	/** The plan's steps (Latin titles), for "Nova pitanja". */
	steps: Array<{ id: string; title: string }>;
	cards: Card[];
	queue: CardQueue;
	/** For each queued card: when each rating would bring it back (ms). */
	previews: Record<string, Record<CardRating, number>>;
	forecast: CardForecast;
	now: number;
}

export interface CourseDeckSummary {
	chatId: string;
	title: string;
	kind: string;
	enabled: boolean;
	total: number;
	due: number;
	fresh: number;
	examDate: string | null;
	/** Due counts for the next 14 days. */
	days: number[];
	untilExam: number | null;
}

/** A card the AI wrote, before the learner keeps it. */
export interface CardDraft {
	nodeId: string;
	tool: "quiz" | "explain";
	args: Record<string, unknown>;
}

