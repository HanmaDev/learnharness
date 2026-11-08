import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createWolframTool, type WolframQuery } from "./wolfram.ts";
import { createYoutubeTool, type YoutubeFetch } from "./youtube.ts";

/** Fork (2026-11-08): optional helpers every conversation agent can carry —
 *  Wolfram (only when the learner set an App ID) and YouTube transcripts. */
export interface AgentAids {
	wolfram?: WolframQuery;
	youtube?: YoutubeFetch;
}

export function aidTools(aids: AgentAids | undefined): Record<string, AgentTool<any>> {
	return {
		...(aids?.wolfram ? { wolfram: createWolframTool(aids.wolfram) } : {}),
		...(aids?.youtube ? { youtube: createYoutubeTool(aids.youtube) } : {}),
	};
}
