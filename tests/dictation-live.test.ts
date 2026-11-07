/**
 * Fork: live dictation — the transcript assembler (interim → greyed,
 * utterance end → commit), lesson keyterm extraction, and the settings
 * contract for the user's word list.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTranscriptAssembler, extractKeyterms, MAX_KEYTERMS, normalizeKeyterms } from "../src/core/dictation.ts";
import { parseDictationSettingsBody } from "../src/server/settings-body.ts";
import { resolveSettings, sanitizeUserSettings } from "../src/core/index.ts";
import { createDictationLanguageStore } from "../components/dictation-preference.ts";

const result = (transcript: string, isFinal: boolean, speechFinal = false) => ({
	type: "Results",
	is_final: isFinal,
	speech_final: speechFinal,
	channel: { alternatives: [{ transcript }] },
});

describe("transcript assembler", () => {
	it("interims only preview; a speech_final commits the whole utterance", () => {
		const a = createTranscriptAssembler();
		assert.equal(a.push(result("select the", false)), null);
		assert.equal(a.pending(), "select the");
		assert.equal(a.push(result("Select the names", true)), null, "locked but the speaker is still going");
		assert.equal(a.push(result("from", false)), null);
		assert.equal(a.pending(), "Select the names from");
		assert.equal(a.push(result("from users.", true, true)), "Select the names from users.");
		assert.equal(a.pending(), "", "nothing left greyed after the commit");
	});

	it("UtteranceEnd commits locked segments when no speech_final came", () => {
		const a = createTranscriptAssembler();
		a.push(result("Use colspan", true));
		assert.equal(a.push({ type: "UtteranceEnd" }), "Use colspan");
		assert.equal(a.push({ type: "UtteranceEnd" }), null, "idempotent");
	});

	it("drain commits the locked tail and (when asked) the last hypothesis; reset discards", () => {
		const a = createTranscriptAssembler();
		a.push(result("first part", true));
		a.push(result("and the rest", false));
		assert.equal(a.drain(true), "first part and the rest");
		const b = createTranscriptAssembler();
		b.push(result("gone", true));
		b.reset();
		assert.equal(b.drain(true), null);
	});

	it("ignores malformed and unrelated messages", () => {
		const a = createTranscriptAssembler();
		for (const m of [null, 3, "x", { type: "Metadata" }, { type: "SpeechStarted" }, { type: "Results" }]) {
			assert.equal(a.push(m), null);
		}
		assert.equal(a.pending(), "");
	});
});

describe("keyterms", () => {
	it("normalize: trims, dedupes case-insensitively, drops empty/overlong, caps", () => {
		assert.deepEqual(normalizeKeyterms(["  GROUP   BY ", "group by", "", 5, "x".repeat(41), "tbody"]), ["GROUP BY", "tbody"]);
		assert.equal(normalizeKeyterms(Array.from({ length: 80 }, (_, i) => `term${i}`)).length, MAX_KEYTERMS);
	});

	it("extract: inline-code terms, SQL keywords and HTML tags/attributes — spoken forms, no markup", () => {
		const terms = extractKeyterms([
			"Atribut `colspan` spaja ćelije, a `<tbody>` grupiše redove. Uslov `age > 30` nije termin.",
			"```sql\nSELECT name FROM users WHERE age > 30 GROUP BY name;\n```",
			"```html\n<table border=\"1\"><thead><tr><th rowspan=\"2\">Ime</th></tr></thead></table>\n```",
		]);
		for (const t of ["colspan", "tbody", "SELECT", "WHERE", "GROUP", "table", "thead", "rowspan", "border"]) {
			assert.ok(terms.includes(t), `has ${t} (got ${terms.join(", ")})`);
		}
		assert.ok(!terms.some((t) => t.includes(">") || t.includes("<")), "no markup punctuation");
		assert.ok(!terms.includes("age > 30"), "expressions are not terms");
		assert.ok(!terms.includes("FROM"), "common English words are not spent on hints");
	});
});

describe("dictation word list in settings", () => {
	it("body parser accepts and normalizes a word list, rejects bad shapes", () => {
		assert.deepEqual(parseDictationSettingsBody({ language: "en", keyterms: [" SELECT ", "select", "tbody"] }), {
			ok: true, settings: { language: "en", keyterms: ["SELECT", "tbody"] },
		});
		assert.deepEqual(parseDictationSettingsBody({ language: "en" }), { ok: true, settings: { language: "en" } });
		assert.equal(parseDictationSettingsBody({ keyterms: "SELECT" }).ok, false);
		assert.equal(parseDictationSettingsBody({ keyterms: [1] }).ok, false);
		assert.equal(parseDictationSettingsBody({ keyterms: Array.from({ length: MAX_KEYTERMS + 1 }, (_, i) => `w${i}`) }).ok, false);
	});

	it("records keep the list; old records resolve to an empty list", () => {
		const record = sanitizeUserSettings({ version: 1, dictation: { language: "en", keyterms: ["SELECT", 4] } });
		assert.deepEqual(record?.dictation, { language: "en", keyterms: ["SELECT"] });
		assert.deepEqual(resolveSettings({ version: 1 }).dictation, { language: "en", keyterms: [] });
	});

	it("the store writes language and words together, so neither wipes the other", async () => {
		const bodies: unknown[] = [];
		let stored = { language: "en", keyterms: ["SELECT"] } as Record<string, unknown>;
		const request = (async (url: string, init?: RequestInit) => {
			if (init?.method === "PUT") {
				const body = JSON.parse(String(init.body)) as Record<string, unknown>;
				bodies.push(body);
				stored = body;
				return Response.json({ settings: { version: 1, dictation: stored } });
			}
			return Response.json({ settings: { version: 1, dictation: stored } });
		}) as typeof fetch;
		const store = createDictationLanguageStore(request);
		await store.load();
		assert.deepEqual(store.getKeyterms(), ["SELECT"]);
		assert.equal(await store.save("en-GB"), true);
		assert.deepEqual(bodies.at(-1), { language: "en-GB", keyterms: ["SELECT"] }, "language save carries the words");
		assert.equal(await store.saveKeyterms(["tbody"]), true);
		assert.deepEqual(bodies.at(-1), { language: "en-GB", keyterms: ["tbody"] }, "words save keeps the language");
		assert.equal(await store.saveKeyterms([]), true);
		assert.deepEqual(bodies.at(-1), { language: "en-GB" }, "an empty list keeps the upstream body shape");
	});
});
