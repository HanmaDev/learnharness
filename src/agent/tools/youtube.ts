import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";

/**
 * youtube (fork, 2026-11-08): the transcript of a YouTube video the learner
 * linked, with timestamps — teach from it and cite [mm:ss]. The fetcher is
 * injected by the composition root (server/youtube.ts).
 */
const youtubeInput = Type.Object({
	url: Type.String({ minLength: 5, maxLength: 300, description: "The YouTube link (or 11-character video id)." }),
	fromMinute: Type.Optional(Type.Number({ minimum: 0, description: "Only the part from this minute (long videos)." })),
	toMinute: Type.Optional(Type.Number({ minimum: 0, description: "Only the part up to this minute." })),
});

export type YoutubeFetch = (url: string, range: { fromMinute?: number; toMinute?: number }, signal?: AbortSignal) => Promise<string>;

export function createYoutubeTool(fetchTranscript: YoutubeFetch): AgentTool<typeof youtubeInput> {
	return {
		name: "youtube",
		label: "youtube",
		description:
			"Read the transcript of a YouTube video (captions, auto-generated ones too) as timestamped text. Use it whenever the learner " +
			"links a video or asks about one: teach from what the video actually says and cite moments as [mm:ss]. For long videos read a " +
			"range with fromMinute/toMinute. Videos without captions return an error — say so plainly.",
		parameters: youtubeInput,
		execute: serverExecute("youtube", youtubeInput, async ({ url, fromMinute, toMinute }, { signal }) => fetchTranscript(url, { fromMinute, toMinute }, signal)),
	};
}
