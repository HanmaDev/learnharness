import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";

/**
 * html_preview (fork): the teacher renders its OWN HTML/CSS/JS snippet live
 * in the lesson — "show what this markup looks like" without waiting on the
 * demo builder. Instant and model-free, like show_image.
 *
 * The snippet lives in the tool call's arguments (the persisted record), so
 * the card renders it straight from part.input; nothing else is stored. The
 * teacher's result is ONE text line — the page is never re-sent.
 *
 * Safety is the card's: the snippet runs in a sandboxed iframe with
 * allow-scripts and NO allow-same-origin (opaque origin — no app storage,
 * cookies, DOM, or trusted-window API access).
 */

/** Generous but bounded: a teaching snippet, not an app. */
export const HTML_PREVIEW_MAX_CHARS = 60_000;

const htmlPreviewInput = Type.Object({
	html: Type.String({
		minLength: 1,
		maxLength: HTML_PREVIEW_MAX_CHARS,
		description:
			"The HTML to render: a fragment (e.g. just a <table>) or a full document. <style> and <script> are allowed. " +
			"Self-contained — no local files; CDN <script src>/<link> over https work. Rendered exactly as a browser would, " +
			"browser defaults included (add CSS only when styling is the point).",
	}),
	title: Type.Optional(Type.String({ description: "Short title shown on the card." })),
});

export function createHtmlPreviewTool(): AgentTool<typeof htmlPreviewInput> {
	return {
		name: "html_preview",
		label: "html_preview",
		description:
			"Render an HTML/CSS/JS snippet live in the lesson, instantly, in a sandboxed frame — the learner sees the result " +
			"and can toggle to the source. The result only confirms the render; the page is not sent back to you. " +
			"Runtime errors surface on the card. For an interactive instrument that must be designed and tested, use demo instead.",
		parameters: htmlPreviewInput,
		execute: serverExecute("html_preview", htmlPreviewInput, async ({ html, title }) => {
			const label = title?.trim();
			const lines = html.split("\n").length;
			return `Rendered for the learner${label ? `: "${label}"` : ""} (${lines} line${lines === 1 ? "" : "s"} of HTML).`;
		}),
	};
}
