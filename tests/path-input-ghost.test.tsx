/** Fork: PathInput's live-dictation ghost — a data attribute drawn by CSS
 *  ::after, never part of the editable text. */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PathInput } from "../components/path-input.tsx";

describe("PathInput ghost text", () => {
	it("renders the ghost as data-ghost (space-joined after text), not as content", () => {
		const html = renderToStaticMarkup(<PathInput value="Hello" onValueChange={() => {}} ghostText="world" />);
		assert.match(html, /data-ghost=" world"/);
		assert.match(html, />Hello<\/div>/, "the editable text is only the value");
		assert.match(html, /data-\[ghost\]:after:content-\[attr\(data-ghost\)\]/);
	});

	it("no leading space after trailing whitespace or an empty value; absent when empty", () => {
		assert.match(renderToStaticMarkup(<PathInput value="Hi " onValueChange={() => {}} ghostText="there" />), /data-ghost="there"/);
		assert.match(renderToStaticMarkup(<PathInput value="" onValueChange={() => {}} ghostText="there" />), /data-ghost="there"/);
		assert.ok(!renderToStaticMarkup(<PathInput value="x" onValueChange={() => {}} ghostText="" />).includes("data-ghost="));
	});
});
