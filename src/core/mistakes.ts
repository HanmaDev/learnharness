/**
 * Mistake log (fork, 2026-11-08): every wrong app-graded answer gets a short
 * analysis (error type, what went wrong, the correct version, one rule to
 * remember) written in the background by the cheap model. Stored per course
 * in ChatRecord.mistakes, keyed by the question's tool call id. A mistake is
 * resolved once the learner later answers a question on the same step right
 * (derived), or by hand.
 *
 * Pure: no runtime deps.
 */
import type { PlanTree } from "./contracts/plan.ts";
import type { LhMessage } from "./native-messages.ts";
import { toSerbianLatin } from "./serbian-latin.ts";

export const MISTAKE_TYPES = ["pojam", "racun", "nepaznja", "citanje", "predznanje", "drugo"] as const;
export type MistakeType = (typeof MISTAKE_TYPES)[number];
export const MISTAKE_TYPE_LABELS: Record<MistakeType, string> = {
	pojam: "Pogrešno razumevanje pojma",
	racun: "Računska greška",
	nepaznja: "Nepažnja",
	citanje: "Pogrešno pročitano pitanje",
	predznanje: "Nedostaje predznanje",
	drugo: "Drugo",
};

export interface MistakeAnalysis {
	type: MistakeType;
	/** What went wrong, one or two sentences. */
	whatWentWrong: string;
	/** The correct answer/approach. */
	correctVersion: string;
	/** One rule to remember. */
	rule: string;
	at: string;
}

export interface MistakeState {
	analysis?: MistakeAnalysis;
	/** The analysis failed this many times (stop retrying at 3). */
	failures?: number;
	/** The learner marked it resolved (or reopened it: false). */
	resolved?: boolean;
	/** A card made from the rule. */
	cardId?: string;
}

/** ChatRecord.mistakes — keyed by the question's tool call id. */
export type CourseMistakes = Record<string, MistakeState>;

/** Teaching questions only: probe-phase questions carry no step, so they
 *  could never resolve and would clutter the log forever. */
const QUESTION_TOOLS = new Set(["quiz", "explain", "exercise"]);

export interface WrongAnswer {
	callId: string;
	tool: string;
	nodeId: string | null;
	args: Record<string, unknown>;
	/** The learner's answer (the graded details, compact). */
	answer: Record<string, unknown>;
	/** The teacher's next message (its feedback), plain text. */
	feedback: string;
	at: number;
}

interface Block {
	type?: string;
	id?: string;
	name?: string;
	arguments?: unknown;
	text?: string;
}

function textOf(m: LhMessage): string {
	const c = (m as { content?: unknown }).content;
	if (typeof c === "string") return c;
	if (!Array.isArray(c)) return "";
	return (c as Block[])
		.filter((b) => b.type === "text" && typeof b.text === "string")
		.map((b) => b.text!)
		.join("\n");
}

/** The learner's wrong answers the app graded (quiz, exercise), oldest first. */
export function wrongAnswers(messages: readonly LhMessage[]): WrongAnswer[] {
	const calls = new Map<string, { tool: string; args: Record<string, unknown> }>();
	const out: WrongAnswer[] = [];
	messages.forEach((m, i) => {
		const r = m as { role?: string; content?: unknown; toolCallId?: string; isError?: boolean; details?: unknown; timestamp?: number };
		if (r.role === "assistant" && Array.isArray(r.content)) {
			for (const b of r.content as Block[]) {
				if (b.type === "toolCall" && b.id && QUESTION_TOOLS.has(b.name ?? "")) calls.set(b.id, { tool: b.name!, args: (b.arguments ?? {}) as Record<string, unknown> });
			}
			return;
		}
		if (r.role !== "toolResult" || typeof r.toolCallId !== "string" || r.isError) return;
		const call = calls.get(r.toolCallId);
		if (!call) return;
		const d = (r.details ?? {}) as Record<string, unknown> & { correct?: unknown; dontKnow?: unknown; dismissed?: unknown; setAside?: unknown; answeredAt?: unknown; exercise?: { result?: { graded?: unknown; correct?: unknown } } };
		if (d.dismissed === true || d.setAside === true) return;
		const ex = d.exercise?.result;
		const wrong = d.correct === false || d.dontKnow === true || (ex && ex.graded !== false && ex.correct === false);
		if (!wrong || typeof call.args.nodeId !== "string") return;
		let feedback = "";
		for (let j = i + 1; j < messages.length && j < i + 4; j++) {
			if ((messages[j] as { role?: string }).role === "assistant") {
				feedback = textOf(messages[j]!).slice(0, 2_000);
				if (feedback) break;
			}
		}
		const at = typeof d.answeredAt === "string" ? Date.parse(d.answeredAt) : (r.timestamp ?? 0);
		const { questionText: _q, options: _o, ...answer } = d as Record<string, unknown>;
		out.push({ callId: r.toolCallId, tool: call.tool, nodeId: typeof call.args.nodeId === "string" ? call.args.nodeId : null, args: call.args, answer, feedback, at: Number.isFinite(at) ? at : 0 });
	});
	return out;
}

/** Correct app-graded answers per step, with time — for "resolved". */
function rightAnswersByNode(messages: readonly LhMessage[]): Map<string, number[]> {
	const calls = new Map<string, string | null>();
	const out = new Map<string, number[]>();
	for (const m of messages) {
		const r = m as { role?: string; content?: unknown; toolCallId?: string; details?: unknown; timestamp?: number };
		if (r.role === "assistant" && Array.isArray(r.content)) {
			for (const b of r.content as Block[]) {
				if (b.type === "toolCall" && b.id && QUESTION_TOOLS.has(b.name ?? "")) {
					const n = (b.arguments as { nodeId?: unknown } | undefined)?.nodeId;
					calls.set(b.id, typeof n === "string" ? n : null);
				}
			}
		} else if (r.role === "toolResult" && typeof r.toolCallId === "string") {
			const nodeId = calls.get(r.toolCallId);
			if (!nodeId) continue;
			const d = (r.details ?? {}) as { correct?: unknown; answeredAt?: unknown; exercise?: { result?: { graded?: unknown; correct?: unknown } } };
			const ex = d.exercise?.result;
			if (d.correct === true || (ex && ex.graded !== false && ex.correct === true)) {
				const at = typeof d.answeredAt === "string" ? Date.parse(d.answeredAt) : (r.timestamp ?? 0);
				const list = out.get(nodeId) ?? [];
				list.push(at);
				out.set(nodeId, list);
			}
		}
	}
	return out;
}

export interface MistakeView {
	callId: string;
	nodeId: string | null;
	nodeTitle: string | null;
	question: string;
	at: number;
	analysis: MistakeAnalysis | null;
	/** Waiting for its analysis (or it failed for good). */
	pending: boolean;
	failed: boolean;
	resolved: boolean;
	/** Resolved because a later answer on the same step was right. */
	resolvedByLaterAnswer: boolean;
	cardId: string | null;
}

const own = <T>(rec: Record<string, T> | undefined, k: string): T | undefined => (rec && Object.prototype.hasOwnProperty.call(rec, k) ? rec[k] : undefined);

export function mistakeViews(messages: readonly LhMessage[], mistakes: CourseMistakes | undefined, tree: PlanTree | undefined): MistakeView[] {
	const titles = new Map((tree?.nodes ?? []).map((n) => [n.id, toSerbianLatin(n.title)]));
	const right = rightAnswersByNode(messages);
	return wrongAnswers(messages)
		.map((w) => {
			const s = own(mistakes, w.callId);
			const later = !!w.nodeId && (right.get(w.nodeId) ?? []).some((t) => t > w.at);
			const resolved = s?.resolved ?? later;
			return {
				callId: w.callId,
				nodeId: w.nodeId,
				nodeTitle: w.nodeId ? (titles.get(w.nodeId) ?? null) : null,
				question: toSerbianLatin(typeof w.args.question === "string" ? w.args.question : ""),
				at: w.at,
				analysis: s?.analysis ?? null,
				pending: !s?.analysis && (s?.failures ?? 0) < 3,
				failed: !s?.analysis && (s?.failures ?? 0) >= 3,
				resolved,
				resolvedByLaterAnswer: s?.resolved === undefined && later,
				cardId: s?.cardId ?? null,
			};
		})
		.sort((a, b) => b.at - a.at);
}

/** Wrong answers still waiting for an analysis (oldest first). */
export function unanalysed(messages: readonly LhMessage[], mistakes: CourseMistakes | undefined): WrongAnswer[] {
	return wrongAnswers(messages).filter((w) => {
		const s = own(mistakes, w.callId);
		return !s?.analysis && (s?.failures ?? 0) < 3;
	});
}

/** The short list the teacher reads at the start of a session. */
export function openMistakesText(views: readonly MistakeView[], limit = 12): string {
	const open = views.filter((v) => !v.resolved && v.analysis).slice(0, limit);
	if (!open.length) return "No open mistakes.";
	return open
		.map((v) => `- [${v.nodeId ?? "?"}] ${MISTAKE_TYPE_LABELS[v.analysis!.type]}: ${v.analysis!.whatWentWrong} Rule: ${v.analysis!.rule}`)
		.join("\n");
}
