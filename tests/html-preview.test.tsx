/**
 * Fork: html_preview — the teacher renders its own HTML/CSS/JS live.
 * Tool: one confirmation line, bounded input. Card: sandboxed srcDoc built
 * from the call's arguments, Preview/Code switch.
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createHtmlPreviewTool, HTML_PREVIEW_MAX_CHARS } from "../src/agent/tools/html-preview.ts";
import { HtmlPreviewCard, htmlPreviewDocument } from "../components/artifacts/html-preview-card.tsx";
import { artifactRenderers } from "../components/artifacts/index.ts";

const table = "<table>\n  <tr><th>Ime</th><th>Godine</th></tr>\n  <tr><td>Ana</td><td>17</td></tr>\n</table>";

describe("html_preview tool", () => {
	const tool = createHtmlPreviewTool();

	it("returns one confirmation line naming the title — the page is never echoed back", async () => {
		const result = await tool.execute("t1", { html: table, title: "Prva tabela" }, undefined as never);
		const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
		assert.match(text, /^Rendered for the learner: "Prva tabela" \(4 lines of HTML\)\.$/);
		assert.ok(!text.includes("<table>"), "the snippet is not re-sent");
	});

	it("declares a bounded html field", () => {
		const html = (tool.parameters as unknown as { properties: { html: { maxLength: number; minLength: number } } }).properties.html;
		assert.equal(html.maxLength, HTML_PREVIEW_MAX_CHARS);
		assert.equal(html.minLength, 1);
	});
});

describe("html_preview card", () => {
	const part = (input: unknown, state = "output-available") => ({ type: "tool-html_preview", state, toolCallId: "t1", input, output: undefined });

	it("is registered in the artifact registry", () => {
		assert.equal(artifactRenderers.html_preview, HtmlPreviewCard);
	});

	it("renders the snippet in a scripts-only sandbox (no same-origin) with Preview/Code tabs", () => {
		const html = renderToStaticMarkup(<HtmlPreviewCard part={part({ html: table, title: "Prva tabela" })} />);
		assert.match(html, /data-testid="html-preview-card"/);
		assert.match(html, /sandbox="allow-scripts"/);
		assert.ok(!html.includes("allow-same-origin"), "never same-origin");
		assert.ok(html.includes("Prva tabela"));
		assert.match(html, /data-testid="html-preview-tab-preview"/);
		assert.match(html, /data-testid="html-preview-tab-code"/);
		// srcDoc carries the snippet (attribute-escaped) plus the bridge.
		assert.ok(html.includes("&lt;th&gt;Ime&lt;/th&gt;"), "snippet in srcDoc");
		assert.ok(html.includes("demo-resize"), "auto-size bridge injected");
	});

	it("renders nothing while the call is still streaming, and a notice for an empty call", () => {
		assert.equal(renderToStaticMarkup(<HtmlPreviewCard part={part({ html: "<p>" }, "input-streaming")} />), "");
		assert.match(renderToStaticMarkup(<HtmlPreviewCard part={part({})} />), /html-preview-empty/);
	});

	it("wraps fragments in a UTF-8 document and leaves full documents untouched", () => {
		const doc = htmlPreviewDocument("<p>Ćevapi</p>");
		assert.match(doc, /^<!doctype html>/);
		assert.ok(doc.includes('<meta charset="utf-8">'));
		assert.ok(doc.includes("<body><p>Ćevapi</p></body>"));
		const full = "<!DOCTYPE html><html><body><p>x</p></body></html>";
		assert.equal(htmlPreviewDocument(full), full);
	});
});
