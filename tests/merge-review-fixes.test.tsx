/** Fork (2026-11-11): regressions from the v0.6.0 merge review. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composePracticeText } from "../components/practice-dock.tsx";
import { hydratePhotos } from "../src/core/native-messages.ts";
import type { LhMessage } from "../src/core/native-messages.ts";

describe("practice submissions keep the fork's tags and final-answer check", () => {
	it("part, elapsed time, text and the app's verdict", () => {
		const s = composePracticeText({ text: "rešenje", final: "\\frac{3}{4}", verdict: "equal", part: "b", elapsedMs: 754_000, photoCount: 0 });
		assert.match(s, /^\(b\) \[elapsed 12:34\]\n/);
		assert.match(s, /rešenje/);
		assert.match(s, /Final answer: \$\\frac\{3\}\{4\}\$ — app check: EQUAL/);
	});
	it("a photo alone still sends something the teacher can read", () => {
		assert.equal(composePracticeText({ text: "", elapsedMs: 5_000, photoCount: 1 }), "[elapsed 0:05]\n(photo of my work)");
	});
	it("an undecided check says so; no final answer, no line", () => {
		assert.match(composePracticeText({ text: "x", final: "y", verdict: "undecided", elapsedMs: 0, photoCount: 0 }), /could not decide/);
		assert.doesNotMatch(composePracticeText({ text: "x", elapsedMs: 0, photoCount: 0 }), /Final answer/);
	});
});

describe("photo bytes reach the model beside upstream's inline answer images", () => {
	it("an answer with an inline channel image and a fork photo gets both", () => {
		const ID = "a".repeat(64);
		const result = {
			id: "r", role: "toolResult", toolCallId: "q", toolName: "explain", isError: false, timestamp: 1,
			content: [{ type: "text", text: "{}" }, { type: "text", text: "Answer images:" }, { type: "image", data: "aW5saW5l", mimeType: "image/png" }],
			details: { kind: "explain", photos: [ID], answeredAt: "t" },
		} as unknown as LhMessage;
		const [hydrated] = hydratePhotos([result], { [ID]: { mimeType: "image/png", data: "cGhvdG8=" } });
		const datas = (hydrated as { content: Array<{ type: string; data?: string }> }).content.filter((c) => c.type === "image").map((c) => c.data);
		assert.deepEqual(datas, ["aW5saW5l", "cGhvdG8="]);
		const [again] = hydratePhotos([hydrated!], { [ID]: { mimeType: "image/png", data: "cGhvdG8=" } });
		assert.equal((again as { content: unknown[] }).content.length, (hydrated as { content: unknown[] }).content.length, "never added twice");
	});
});
