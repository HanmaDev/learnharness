/**
 * Fork (2026-11-08): the agents' optional helpers, wired to the server —
 * Wolfram (only while a WOLFRAM_APP_ID is set, read fresh per turn) and
 * YouTube transcripts (always).
 */
import { mistakeViews, openMistakesText } from "../core";
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
