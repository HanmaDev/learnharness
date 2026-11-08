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
}

export function aidTools(aids: AgentAids | undefined): Record<string, AgentTool<any>> {
	return {
		...(aids?.wolfram ? { wolfram: createWolframTool(aids.wolfram) } : {}),
		...(aids?.youtube ? { youtube: createYoutubeTool(aids.youtube) } : {}),
		...(aids?.openMistakes ? { open_mistakes: createOpenMistakesTool(aids.openMistakes) } : {}),
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
