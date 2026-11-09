/**
 * Fork (2026-11-08): the agents' optional helpers, wired to the server —
 * Wolfram (only while a WOLFRAM_APP_ID is set, read fresh per turn) and
 * YouTube transcripts (always).
 */
import { mistakeViews, openMistakesText, resolveDate } from "../core";
import * as fs from "node:fs";
import { categoryHint, logAttempt } from "./problems.ts";
import { listTrackerProblems, trackerAvailable, trackerFacets, trackerImageFile, trackerProblem, trackerReference, type TrackerProblem } from "./tracker.ts";
import { fieldsMatch, parseArchiveQuery, titleFields } from "./tracker-match.ts";
import { stores } from "./stores.ts";
import { makeCardsFor, planStepsText, problemEditFor, problemListText } from "./teacher-records.ts";
import type { AgentAids } from "../agent/tools/aids.ts";
import { wolframAvailable, wolframLlmQuery } from "./wolfram.ts";
import { fetchTranscript, transcriptMarkdown } from "./youtube.ts";

const MAX_TRANSCRIPT_CHARS = 80_000;

/** A broken problems.json must never stop a turn from building. */
function safeCategoryHint(): string {
	try {
		return categoryHint();
	} catch {
		return "";
	}
}

function safePlanSteps(chatId: string): string {
	try {
		return planStepsText(chatId);
	} catch {
		return "";
	}
}

export function agentAids(chatId?: string): AgentAids {
	return {
		...(chatId
			? {
					openMistakes: () => {
						const chat = stores.chatStore.getChat(chatId);
						return chat ? openMistakesText(mistakeViews(chat.messages, chat.mistakes, chat.tree)) : "No open mistakes.";
					},
					// The problem log is the teacher's and practice's (a session's
					// agents), not the prober's — it gets agentAids() without a chat.
					logProblem: (input) => {
						const { entry, created } = logAttempt({ ...input, chatId });
						const next = resolveDate(entry);
						return `${created ? "Logged" : "Added an attempt to"} "${entry.reference}" (${entry.source}, category ${entry.category}). ${next ? `Re-solve on ${next}.` : "Not scheduled for re-solving."}`;
					},
					problemCategories: safeCategoryHint(),
					...(trackerAvailable() ? { trackerLookup } : {}),
					// Fork (2026-11-09): the learner's records, changed on request.
					problemList: (f) => problemListText(chatId, f),
					problemEdit: (input) => problemEditFor(chatId, input),
					makeCards: (cards) => makeCardsFor(chatId, cards),
					planSteps: safePlanSteps(chatId),
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

/** tracker_problem: by id, else by the title's fields — round, year,
 *  grade, category, day, problem number (src/server/tracker-match.ts). */
function trackerLookup(query: string): { text: string; images?: Array<{ data: string; mimeType: string }> } {
	const q = query.trim();
	let detail = trackerProblem(q);
	if (!detail) {
		const want = parseArchiveQuery(q, trackerFacets().stages);
		if (want.number === undefined)
			return { text: `"${q}" names no problem number. Ask the learner for the round, school year, grade, category and problem number (e.g. "Okružno 2019/2020 4. razred A zadatak 3").` };
		const filter = {
			...(want.stage ? { stage: want.stage } : {}),
			...(want.year?.includes("/") ? { year: want.year } : {}),
			...(want.grade !== undefined ? { grade: want.grade } : {}),
			...(want.category ? { category: want.category } : {}),
		};
		const all: TrackerProblem[] = [];
		for (let offset = 0; ; offset += 500) {
			const page = listTrackerProblems({ ...filter, limit: 500, offset });
			all.push(...page.problems);
			if (!page.problems.length || all.length >= page.total) break;
		}
		const hits = all.filter((p) => fieldsMatch(want, titleFields(p.title, p.stage)));
		if (hits.length > 1)
			return {
				text: `"${q}" matches ${hits.length} archive problems — ask the learner which one, or call again with its trackerId:\n${hits
					.slice(0, 12)
					.map((p) => `- ${p.title} (trackerId: ${p.id})`)
					.join("\n")}${hits.length > 12 ? "\n…" : ""}`,
			};
		if (hits.length === 1) detail = trackerProblem(hits[0]!.id);
	}
	if (!detail) return { text: `No archive problem matches "${q}". Ask the learner for the exact round, school year, grade, category and problem number.` };
	const img = detail.imageId ? trackerImageFile(detail.imageId) : null;
	const text = `${trackerReference(detail)} · branch: ${detail.branch ?? "?"} · tags: ${detail.tags.join(", ")} · trackerId: ${detail.id}${detail.solution ? " · an official solution exists (the learner can open it)" : " · no official solution in the archive"}. The statement is the attached image. Log attempts at it with this trackerId and reference "${trackerReference(detail)}".`;
	return img ? { text, images: [{ data: fs.readFileSync(img.file).toString("base64"), mimeType: img.mime }] } : { text: `${text} (image missing)` };
}
