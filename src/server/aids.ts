/**
 * Fork (2026-11-08): the agents' optional helpers, wired to the server —
 * Wolfram (only while a WOLFRAM_APP_ID is set, read fresh per turn) and
 * YouTube transcripts (always).
 */
import { mistakeViews, openMistakesText, resolveDate } from "../core";
import * as fs from "node:fs";
import { categoryHint, logAttempt } from "./problems.ts";
import { listTrackerProblems, trackerAvailable, trackerImageFile, trackerProblem, trackerReference } from "./tracker.ts";
import { stores } from "./stores.ts";
import type { AgentAids } from "../agent/tools/aids.ts";
import { wolframAvailable, wolframLlmQuery } from "./wolfram.ts";
import { fetchTranscript, transcriptMarkdown } from "./youtube.ts";

const MAX_TRANSCRIPT_CHARS = 80_000;

export function agentAids(chatId?: string): AgentAids {
	return {
		...(chatId
			? {
					openMistakes: () => {
						const chat = stores.chatStore.getChat(chatId);
						return chat ? openMistakesText(mistakeViews(chat.messages, chat.mistakes, chat.tree)) : "No open mistakes.";
					},
				}
			: {}),
		logProblem: (input) => {
			const { entry, created } = logAttempt({ ...input, ...(chatId ? { chatId } : {}) });
			const next = resolveDate(entry);
			return `${created ? "Logged" : "Added an attempt to"} "${entry.reference}" (${entry.source}, category ${entry.category}). ${next ? `Re-solve on ${next}.` : "Not scheduled for re-solving."}`;
		},
		problemCategories: categoryHint(),
		...(trackerAvailable() ? { trackerLookup } : {}),
		...(wolframAvailable() ? { wolfram: (q: string, signal?: AbortSignal) => wolframLlmQuery(q, signal) } : {}),
		youtube: async (url, range, signal) => {
			const tr = await fetchTranscript(url, signal);
			const from = range.fromMinute !== undefined ? range.fromMinute * 60 : -1;
			const to = range.toMinute !== undefined ? range.toMinute * 60 : Infinity;
			const lines = tr.lines.filter((l) => l.t >= from && l.t <= to);
			const total = tr.lines.at(-1)?.t ?? 0;
			if (!lines.length) return `No transcript in that range — the video is about ${Math.round(total / 60)} min long. Ask for a range inside it.`;
			const md = transcriptMarkdown({ ...tr, lines }, MAX_TRANSCRIPT_CHARS);
			return `${md}\n\n(Video length ≈ ${Math.round(total / 60)} min${range.fromMinute !== undefined || range.toMinute !== undefined ? `; shown: ${range.fromMinute ?? 0}–${range.toMinute ?? "end"} min` : ""}.)`;
		},
	};
}

/** tracker_problem: by id, else the best title match ("okružno 2019/2020 4 A zadatak 3"). */
function trackerLookup(query: string): { text: string; images?: Array<{ data: string; mimeType: string }> } {
	const q = query.trim();
	let detail = trackerProblem(q);
	if (!detail) {
		const words = q.toLowerCase().replace(/[^\p{L}\p{N}/]+/gu, " ").split(" ").filter(Boolean);
		const { problems } = listTrackerProblems({ limit: 500, q: words.find((w) => /\d{4}\/\d{4}/.test(w)) });
		const scored = problems
			.map((p) => {
				const t = `${p.title} ${p.stage} ${p.year} ${p.grade ?? ""}${p.category}`.toLowerCase();
				return { p, s: words.filter((w) => t.includes(w)).length };
			})
			.sort((a, b) => b.s - a.s);
		if (scored[0] && scored[0].s >= Math.max(2, Math.ceil(words.length * 0.6))) detail = trackerProblem(scored[0].p.id);
	}
	if (!detail) return { text: `No archive problem matches "${q}". Ask the learner for the exact round, year, grade, category and problem number.` };
	const img = detail.imageId ? trackerImageFile(detail.imageId) : null;
	const text = `${trackerReference(detail)} · branch: ${detail.branch ?? "?"} · tags: ${detail.tags.join(", ")} · trackerId: ${detail.id}${detail.solution ? " · an official solution exists (the learner can open it)" : " · no official solution in the archive"}. The statement is the attached image.`;
	return img ? { text, images: [{ data: fs.readFileSync(img.file).toString("base64"), mimeType: img.mime }] } : { text: `${text} (image missing)` };
}
