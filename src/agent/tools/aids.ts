import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { serverExecute } from "../tool-execute.ts";
import { createWolframTool, type WolframQuery } from "./wolfram.ts";
import { createYoutubeTool, type YoutubeFetch } from "./youtube.ts";

/** Fork (2026-11-08): optional helpers every conversation agent can carry —
 *  Wolfram (only when the learner set an App ID) and YouTube transcripts. */
export interface AgentAids {
	wolfram?: WolframQuery;
	youtube?: YoutubeFetch;
	/** The course's open mistakes as a short list (teacher only). */
	openMistakes?: () => string;
	/** Fork: the problem log — record an attempt; returns a one-line confirmation. */
	logProblem?: (input: LogProblemInput) => string;
	/** The current category ids/labels, for the tool description. */
	problemCategories?: string;
	/** Fork: look a problem up in the Matematika Tracker archive (statement image). */
	trackerLookup?: (query: string) => { text: string; images?: Array<{ data: string; mimeType: string }> };
}

export interface LogProblemInput {
	source: string;
	reference: string;
	outcome: "clean" | "slow" | "hint" | "read" | "unsolved";
	minutes?: number;
	branch?: string;
	category?: string;
	note?: string;
	trackerId?: string;
}

export function aidTools(aids: AgentAids | undefined): Record<string, AgentTool<any>> {
	return {
		...(aids?.wolfram ? { wolfram: createWolframTool(aids.wolfram) } : {}),
		...(aids?.youtube ? { youtube: createYoutubeTool(aids.youtube) } : {}),
		...(aids?.openMistakes ? { open_mistakes: createOpenMistakesTool(aids.openMistakes) } : {}),
		...(aids?.logProblem ? { log_problem: createLogProblemTool(aids.logProblem, aids.problemCategories ?? "") } : {}),
		...(aids?.trackerLookup ? { tracker_problem: createTrackerTool(aids.trackerLookup) } : {}),
	};
}

const logProblemInput = Type.Object({
	source: Type.String({ minLength: 1, maxLength: 120, description: 'The book or archive: "Thomas\' Calculus", "Zbirka 4. razred", "EGMO", "MONT", "Schaum\'s College Physics", "URS Predić", "DMS arhiva".' }),
	reference: Type.String({ minLength: 1, maxLength: 200, description: 'Where exactly: "3.4 / 17", "EGMO 4.12", "Okružno 2019/2020 · 4. razred · kategorija A · zadatak 3". Keep the same form for re-attempts.' }),
	outcome: Type.Union([Type.Literal("clean"), Type.Literal("slow"), Type.Literal("hint"), Type.Literal("read"), Type.Literal("unsolved")], {
		description: "clean = solved alone, cleanly; slow = alone but slow/shaky; hint = needed a hint; read = read the solution; unsolved = gave up.",
	}),
	minutes: Type.Optional(Type.Number({ minimum: 0, maximum: 1440, description: "Time spent, if the learner said." })),
	branch: Type.Optional(Type.String({ description: "Algebra, Analiza, Geometrija, Kombinatorika, Teorija brojeva, Verovatnoća, Fizika, Ostalo." })),
	category: Type.Optional(Type.String({ description: "A category id (see the description); omit to use the course's default." })),
	note: Type.Optional(Type.String({ maxLength: 500, description: "One line: the key idea or what went wrong." })),
	trackerId: Type.Optional(Type.String({ description: "The Matematika Tracker problem id, for archive problems (from tracker_problem)." })),
});

function createLogProblemTool(log: (i: LogProblemInput) => string, categories: string): AgentTool<typeof logProblemInput> {
	return {
		name: "log_problem",
		label: "log_problem",
		description:
			"Record one attempt at a problem in the learner's problem log (Zadaci): whenever the learner reports a problem they worked " +
			"(\"rešio sam 3.4/17 sam za 25 min\", \"pročitao sam rešenje za EGMO 4.12\") or after you graded their written solution. " +
			"Be honest about the outcome — it decides when the problem comes back for re-solving. " +
			(categories ? `Categories: ${categories}.` : ""),
		parameters: logProblemInput,
		execute: serverExecute("log_problem", logProblemInput, async (input) => log(input)),
	};
}

const trackerInput = Type.Object({
	query: Type.String({ minLength: 1, maxLength: 200, description: 'The problem: its Tracker id, or a title like "Okružno 2019/2020 4. razred A zadatak 3".' }),
});

function createTrackerTool(lookup: (q: string) => { text: string; images?: Array<{ data: string; mimeType: string }> }): AgentTool<typeof trackerInput> {
	return {
		name: "tracker_problem",
		label: "tracker_problem",
		description:
			"Look up a competition problem in the learner's Matematika Tracker archive (DMS: opštinsko … IMO, 2002–2026) and SEE its " +
			"statement (an image). Use it when the learner names an archive problem, so you work on exactly that statement. " +
			"The official solution is not returned — the learner opens it in Zadaci → Arhiva after attempting.",
		parameters: trackerInput,
		execute: serverExecute("tracker_problem", trackerInput, async ({ query }) => lookup(query)),
	};
}

const noInput = Type.Object({});

function createOpenMistakesTool(read: () => string): AgentTool<typeof noInput> {
	return {
		name: "open_mistakes",
		label: "open_mistakes",
		description:
			"The learner's open mistakes in this course (from the mistake log): step, error type, what went wrong, the rule. " +
			"Call it at the start of a session and before reviews; weave the most relevant ones back into your questions. Read-only.",
		parameters: noInput,
		execute: serverExecute("open_mistakes", noInput, async () => read()),
	};
}
