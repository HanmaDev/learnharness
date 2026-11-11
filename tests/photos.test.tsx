/**
 * Fork (2026-11-07): photos of handwritten work — the record/model path,
 * the upload normalizer, and the one-time phone upload listener.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createCanvas } from "@napi-rs/canvas";
import { inputAppends, parseChatInput, ChatInputError } from "../src/core/input-events.ts";
import { hydratePhotos, newThinkingMessage, toLlmMessages, type LhMessage } from "../src/core/native-messages.ts";
import { compactAnswerForModel } from "../src/core/question-core.ts";
import { normalizeImageBytes } from "../src/agent/tools/learner-image.ts";
import { lanAddress, phoneUploadStatus, startPhoneUpload, cancelPhoneUpload, uploadPage } from "../src/server/phone-upload.ts";
import { chatStore } from "../src/store/chats.ts";
import { PATHS } from "../config.ts";
import { PracticeDock } from "../components/practice-dock.tsx";
import { PhotoStrip } from "../components/photo-attach.tsx";

const ID = "a".repeat(64);
const snap = { mimeType: "image/png" as const, data: "iVBORw0KGgo=", width: 1, height: 1 };

function png(w = 40, h = 30): Buffer {
	const c = createCanvas(w, h);
	const ctx = c.getContext("2d");
	ctx.fillStyle = "#3366ff";
	ctx.fillRect(0, 0, w, h);
	return c.toBuffer("image/png");
}

const problemCall = (id: string): LhMessage =>
	({
		id: `a_${id}`, role: "assistant", stopReason: "toolUse", timestamp: 1,
		content: [{ type: "toolCall", id, name: "problem", arguments: { statement: "S", mode: "recall", modelSolution: "M" } }],
	}) as unknown as LhMessage;
const problemAck = (id: string): LhMessage =>
	({ id: `r_${id}`, role: "toolResult", toolCallId: id, toolName: "problem", content: [{ type: "text", text: "ok" }], isError: false, timestamp: 2 }) as unknown as LhMessage;

describe("photos — record and model path", () => {
	it("thinking input accepts photo ids (text optional) and rejects bad ids", () => {
		assert.deepEqual(parseChatInput({ type: "thinking", problemCallId: "p", text: "", photos: [ID] }), { type: "thinking", problemCallId: "p", text: "", photos: [ID] });
		assert.throws(() => parseChatInput({ type: "thinking", problemCallId: "p", text: "x", photos: ["nope"] }), ChatInputError);
		assert.throws(() => parseChatInput({ type: "thinking", problemCallId: "p", text: "", photos: [] }), ChatInputError, "nothing to submit");
	});

	it("the record keeps ids only; the agent's hydrated copy sends the image to the model", () => {
		const record = { messages: [problemCall("p1"), problemAck("p1")], imageSnapshots: { [ID]: snap } };
		const [marker] = inputAppends(record, { type: "thinking", problemCallId: "p1", text: "my work", photos: [ID] });
		const details = (marker as { details: { images: Array<{ snapshotId: string; data?: string }> } }).details;
		assert.deepEqual(details.images, [{ snapshotId: ID }], "no bytes in the record (review fix)");
		const [hydrated] = hydratePhotos([marker!], record.imageSnapshots);
		const wire = toLlmMessages([hydrated] as never) as Array<{ content: Array<{ type: string; data?: string }> }>;
		assert.ok(wire.at(-1)!.content.some((c) => c.type === "image" && c.data === snap.data), "image content on the wire");
		assert.match(JSON.stringify(wire), /1 photo of handwritten work attached/);
	});

	it("a photo id the record doesn't hold is refused (attach again)", () => {
		const record = { messages: [problemCall("p1"), problemAck("p1")], imageSnapshots: {} };
		assert.throws(() => inputAppends(record, { type: "thinking", problemCallId: "p1", text: "x", photos: [ID] }), /attach it again/);
	});

	it("answer photos: ids in the record, image content only in the hydrated agent copy", () => {
		const quiz = {
			id: "a_q", role: "assistant", stopReason: "toolUse", timestamp: 1,
			content: [{ type: "toolCall", id: "q", name: "ask_user_question", arguments: { question: "Show your work" } }],
		} as unknown as LhMessage;
		const answer = { kind: "ask" as const, questionText: "Show your work", dontKnow: false, answers: [], text: "see photo", photos: [ID], answeredAt: "t" };
		const [result] = inputAppends({ messages: [quiz], imageSnapshots: { [ID]: snap } }, { type: "answer", toolCallId: "q", answer });
		const stored = (result as { content: Array<{ type: string; text?: string }> }).content;
		assert.ok(!stored.some((c) => c.type === "image"), "no bytes in the record");
		const [hydrated] = hydratePhotos([result!], { [ID]: snap });
		const content = (hydrated as { content: Array<{ type: string; text?: string }> }).content;
		assert.ok(content.some((c) => c.type === "image"));
		assert.equal(JSON.parse(content[0]!.text!).photosAttached, 1);
		assert.equal(compactAnswerForModel(answer).photosAttached, 1);
	});

	it("answers saved before v0.6.0 (photo ids under `images`) still reach the model", () => {
		const legacy = {
			id: "r_old", role: "toolResult", toolCallId: "q", toolName: "ask_user_question", isError: false, timestamp: 1,
			content: [{ type: "text", text: "{}" }],
			details: { kind: "ask", questionText: "Q", dontKnow: false, answers: [], text: "", images: [ID], answeredAt: "t" },
		} as unknown as LhMessage;
		const [hydrated] = hydratePhotos([legacy], { [ID]: snap });
		assert.ok((hydrated as { content: Array<{ type: string }> }).content.some((c) => c.type === "image"));
	});

	it("thinking may carry v0.6.0 inline images and fork photos together", () => {
		const inline = { type: "image" as const, data: "aW5saW5l", mimeType: "image/png" };
		const marker = newThinkingMessage("p1", "both", [inline, { snapshotId: ID }]);
		assert.match(String(marker.content), /1 photo of handwritten work attached/, "the note counts fork photos only");
		const [hydrated] = hydratePhotos([marker], { [ID]: snap });
		const wire = toLlmMessages([hydrated] as never) as Array<{ content: Array<{ type: string; data?: string }> }>;
		const datas = wire.at(-1)!.content.filter((c) => c.type === "image").map((c) => c.data);
		assert.deepEqual(datas, [inline.data, snap.data]);
	});

	it("the client's optimistic marker holds ids only", () => {
		const m = newThinkingMessage("p", "x", [{ snapshotId: ID }]);
		assert.deepEqual((m.details as { images: unknown }).images, [{ snapshotId: ID }]);
		assert.equal(toLlmMessages([m] as never).flatMap((w) => (w as { content: Array<{ type: string }> }).content).filter((c) => c.type === "image").length, 0);
	});
});

describe("photos — the upload normalizer", () => {
	it("normalizes uploaded bytes into a snapshot", async () => {
		const image = await normalizeImageBytes(png());
		assert.equal(image.mimeType, "image/png");
		assert.equal(image.width, 40);
		assert.match(image.snapshotId, /^[a-f0-9]{64}$/);
		await assert.rejects(normalizeImageBytes(new TextEncoder().encode("not an image")), /not a supported image/);
	});
});

const created: string[] = [];
after(() => { for (const id of created) fs.rmSync(path.join(PATHS.chats, `${id}.json`), { force: true }); });

describe("photos — the phone upload listener", { skip: lanAddress() ? false : "no LAN address on this machine" }, () => {
	it("serves the page, accepts one photo, saves it to the chat, then refuses", async () => {
		const chat = chatStore.createChat("phone upload");
		created.push(chat.id);
		const { token, url, qrSvg } = await startPhoneUpload(chat.id);
		assert.match(url, /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+\/u\/[a-f0-9]{32}$/);
		assert.match(qrSvg, /<svg/);
		const page = await fetch(url);
		assert.equal(page.status, 200);
		assert.match(await page.text(), /Send a photo to LearnHarness/);
		const wrong = await fetch(url.replace(token, "0".repeat(32)));
		assert.equal(wrong.status, 403);
		assert.equal((await phoneUploadStatus(token, chat.id)).state, "waiting");
		const up = await fetch(url, { method: "POST", headers: { "Content-Type": "image/png" }, body: new Uint8Array(png()) });
		assert.equal(up.status, 200);
		const done = await phoneUploadStatus(token, chat.id);
		assert.equal(done.state, "done");
		assert.ok(chatStore.getChat(chat.id)!.imageSnapshots?.[done.snapshotId!], "saved as a session snapshot");
		await assert.rejects(fetch(url), "the listener closed after one photo");
		assert.equal((await phoneUploadStatus(token, "another-chat")).state, "expired", "bound to its chat");
	});

	it("cancel closes the listener", async () => {
		const chat = chatStore.createChat("phone cancel");
		created.push(chat.id);
		const { token, url } = await startPhoneUpload(chat.id);
		cancelPhoneUpload(token, chat.id);
		await assert.rejects(fetch(url));
		assert.equal((await phoneUploadStatus(token, chat.id)).state, "expired");
	});

	it("the page posts back to its own one-time path only", () => {
		const html = uploadPage("f".repeat(32));
		assert.match(html, /fetch\('\/u\/f{32}'/);
		assert.ok(!/https?:\/\//.test(html), "no external resources");
	});
});

describe("photos — rendering", () => {
	it("the practice box offers Photo and From phone", () => {
		const html = renderToStaticMarkup(<PracticeDock problemCallId="p" input={{ statement: "S" }} expanded onExpand={() => {}} onSubmit={() => {}} />);
		assert.match(html, /data-testid="photo-attach"/);
		assert.match(html, /data-testid="photo-phone"/);
		assert.match(html, /data-photo-drop=""/);
	});

	it("transcript cards show attached photos", () => {
		assert.equal((renderToStaticMarkup(<PhotoStrip ids={[ID, "b".repeat(64)]} />).match(/data-testid="photo-thumb"/g) ?? []).length, 2);
	});
});
