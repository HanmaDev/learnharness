/**
 * Kartice (fork, 2026-11-08): the server side of the card views — reads the
 * record, builds the deck (core/cards.ts) and applies the learner's actions.
 */
import {
	buildCards,
	cardForecast,
	cardQueue,
	isCardRating,
	normalizeCardSettings,
	ownState,
	toSerbianLatin,
	type CardState,
	previewRatings,
	type Card,
	type CardForecast,
	type CardQueue,
	type CardRating,
	type CardSettings,
	type ChatRecord,
	type CourseCardsView,
	type CourseDeckSummary,
} from "../core";
import { readSettings } from "../store/settings.ts";
import { stores } from "./stores.ts";
import { draftProblem, draftsToGenerated } from "./card-generation.ts";
import type { CardDraft } from "../core";

export function cardSettings(): CardSettings {
	return normalizeCardSettings(readSettings()?.cards);
}

function courseInput(chat: ChatRecord, settings: CardSettings, now: number) {
	return { messages: chat.messages, cards: chat.cards, tree: chat.tree, settings, examDate: chat.planTarget?.date ?? null, now };
}

export function courseCardsView(chat: ChatRecord, now = Date.now()): CourseCardsView {
	const settings = cardSettings();
	const input = courseInput(chat, settings, now);
	const cards = buildCards(input);
	const queue = cardQueue(cards, chat.cards, settings, now);
	const previews = previewRatings(input, queue.ids);
	return {
		chatId: chat.id,
		title: chat.title,
		enabled: chat.cards?.enabled !== false,
		globalEnabled: settings.enabled,
		settings,
		examDate: input.examDate,
		steps: (chat.tree?.nodes ?? []).map((n) => ({ id: n.id, title: toSerbianLatin(n.title) })),
		cards,
		queue,
		previews,
		forecast: cardForecast(input),
		now,
	};
}

/** The sidebar overview: every teaching course with cards. */
export function cardsOverview(now = Date.now()): { globalEnabled: boolean; settings: CardSettings; decks: CourseDeckSummary[] } {
	const settings = cardSettings();
	const decks: CourseDeckSummary[] = [];
	for (const summary of stores.chatStore.listChats()) {
		const chat = stores.chatStore.getChat(summary.id);
		if (!chat || chat.kind === "practice") continue;
		const input = courseInput(chat, settings, now);
		const cards = buildCards(input);
		if (cards.length === 0) continue;
		const queue = cardQueue(cards, chat.cards, settings, now);
		const forecast = cardForecast(input);
		decks.push({
			chatId: chat.id,
			title: chat.title,
			kind: chat.kind ?? "teach",
			enabled: chat.cards?.enabled !== false,
			total: cards.filter((c) => c.status !== "suspended" && c.status !== "known").length,
			due: queue.dueCount,
			fresh: queue.newCount,
			examDate: input.examDate,
			days: forecast.days,
			untilExam: forecast.untilExam,
		});
	}
	return { globalEnabled: settings.enabled, settings, decks };
}

/** Never valid card ids (object prototype keys). */
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export type CardAction =
	| { op: "review"; cardId: string; rating: CardRating; correct?: boolean }
	| { op: "flags"; cardId: string; suspended?: boolean; known?: boolean; deleted?: boolean }
	| { op: "enabled"; enabled: boolean }
	| { op: "add"; drafts: CardDraft[] };

/** Validate a POST body. */
export function parseCardAction(body: unknown): CardAction | string {
	if (!body || typeof body !== "object") return "Body must be an object";
	const b = body as Record<string, unknown>;
	if (b.op === "review") {
		if (typeof b.cardId !== "string" || !isCardRating(b.rating)) return "review needs { cardId, rating: 1-4 }";
		if (b.correct !== undefined && typeof b.correct !== "boolean") return "correct must be a boolean";
		return { op: "review", cardId: b.cardId, rating: b.rating, ...(typeof b.correct === "boolean" ? { correct: b.correct } : {}) };
	}
	if (b.op === "flags") {
		if (typeof b.cardId !== "string") return "flags needs { cardId }";
		const out: CardAction = { op: "flags", cardId: b.cardId };
		for (const k of ["suspended", "known", "deleted"] as const) {
			if (b[k] === undefined) continue;
			if (typeof b[k] !== "boolean") return `${k} must be a boolean`;
			out[k] = b[k] as boolean;
		}
		return out;
	}
	if (b.op === "enabled") {
		if (typeof b.enabled !== "boolean") return "enabled must be a boolean";
		return { op: "enabled", enabled: b.enabled };
	}
	if (b.op === "add") {
		if (!Array.isArray(b.drafts) || b.drafts.length === 0 || b.drafts.length > 50) return "add needs { drafts: [...] } (1-50)";
		const drafts: CardDraft[] = [];
		for (const d of b.drafts as Array<Record<string, unknown>>) {
			const args = d?.args as Record<string, unknown> | undefined;
			if (!args || typeof args !== "object" || (d.tool !== "quiz" && d.tool !== "explain") || typeof d.nodeId !== "string" || args.nodeId !== d.nodeId) return "each draft needs { nodeId, tool, args }";
			drafts.push({ nodeId: d.nodeId, tool: d.tool, args });
		}
		return { op: "add", drafts };
	}
	return "op must be review | flags | enabled | add";
}

/** Apply an action. Unknown card → false. */
export function applyCardAction(chat: ChatRecord, action: CardAction, now = Date.now()): boolean {
	if (action.op === "enabled") {
		stores.chatStore.updateCards(chat.id, (c) => {
			if (action.enabled) delete c.enabled;
			else c.enabled = false;
		});
		return true;
	}
	if (action.op === "add") {
		const nodeIds = new Set((chat.tree?.nodes ?? []).map((n) => n.id));
		for (const d of action.drafts) {
			const args = d.args;
			const problem = draftProblem(
				{ nodeId: d.nodeId, tool: d.tool, question: String(args.question ?? ""), options: args.options as never, correctAnswer: args.correctAnswer as never, explanation: args.explanation as never },
				nodeIds,
			);
			if (problem) return false;
		}
		const generated = draftsToGenerated(action.drafts, now);
		stores.chatStore.updateCards(chat.id, (c) => {
			c.generated = [...(c.generated ?? []), ...generated];
		});
		return true;
	}
	if (RESERVED_KEYS.has(action.cardId)) return false;
	const exists = buildCards(courseInput(chat, cardSettings(), now)).some((c) => c.id === action.cardId) || ownState(chat.cards, action.cardId) !== undefined;
	if (!exists) return false;
	stores.chatStore.updateCards(chat.id, (c) => {
		const states = (c.states ??= {});
		const state: CardState = ownState(c, action.cardId) ?? (states[action.cardId] = {});
		if (action.op === "review") {
			(state.reviews ??= []).push({ at: new Date(now).toISOString(), rating: action.rating, ...(action.correct !== undefined ? { correct: action.correct } : {}) });
			return;
		}
		for (const k of ["suspended", "known", "deleted"] as const) {
			if (action[k] === undefined) continue;
			if (action[k]) state[k] = true;
			else delete state[k];
		}
	});
	return true;
}
