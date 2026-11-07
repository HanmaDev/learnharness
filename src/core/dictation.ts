/** Nova-3 monolingual language codes, including documented locale aliases.
 * Source: https://developers.deepgram.com/docs/models-languages-overview
 * Multilingual is a separate mode; its supported language set differs.
 */
const NOVA_3_LANGUAGES = [
	["Afrikaans", ["af", "af-ZA"]],
	["Arabic", ["ar", "ar-AE", "ar-SA", "ar-QA", "ar-KW", "ar-SY", "ar-LB", "ar-PS", "ar-JO", "ar-EG", "ar-SD", "ar-TD", "ar-MA", "ar-DZ", "ar-TN", "ar-IQ", "ar-IR"]],
	["Armenian", ["hy"]],
	["Assamese", ["as", "as-IN"]],
	["Belarusian", ["be"]],
	["Bengali", ["bn"]],
	["Bosnian", ["bs"]],
	["Bulgarian", ["bg"]],
	["Catalan", ["ca"]],
	["Chinese (Cantonese, Traditional)", ["zh-HK"]],
	["Chinese (Mandarin, Simplified)", ["zh", "zh-CN", "zh-Hans"]],
	["Chinese (Mandarin, Traditional)", ["zh-TW", "zh-Hant"]],
	["Croatian", ["hr"]],
	["Czech", ["cs", "cs-CZ"]],
	["Danish", ["da", "da-DK"]],
	["Dutch", ["nl"]],
	["English", ["en", "en-US", "en-AU", "en-GB", "en-IN", "en-NZ"]],
	["Estonian", ["et"]],
	["Finnish", ["fi"]],
	["Flemish", ["nl-BE"]],
	["French", ["fr", "fr-CA"]],
	["Georgian", ["ka", "ka-GE"]],
	["German", ["de"]],
	["German (Switzerland)", ["de-CH"]],
	["Greek", ["el"]],
	["Gujarati", ["gu", "gu-IN"]],
	["Hebrew", ["he"]],
	["Hindi", ["hi"]],
	["Hungarian", ["hu"]],
	["Indonesian", ["id"]],
	["Italian", ["it"]],
	["Japanese", ["ja"]],
	["Kannada", ["kn"]],
	["Kazakh", ["kk", "kk-KZ"]],
	["Korean", ["ko", "ko-KR"]],
	["Latvian", ["lv"]],
	["Lithuanian", ["lt"]],
	["Macedonian", ["mk"]],
	["Malay", ["ms"]],
	["Marathi", ["mr"]],
	["Mongolian", ["mn"]],
	["Nepali", ["ne"]],
	["Norwegian", ["no"]],
	["Pashto", ["ps", "ps-AF"]],
	["Persian", ["fa"]],
	["Polish", ["pl"]],
	["Portuguese", ["pt", "pt-BR", "pt-PT"]],
	["Punjabi", ["pa", "pa-IN"]],
	["Romanian", ["ro"]],
	["Russian", ["ru"]],
	["Serbian", ["sr"]],
	["Slovak", ["sk"]],
	["Slovenian", ["sl"]],
	["Spanish", ["es", "es-419"]],
	["Swedish", ["sv", "sv-SE"]],
	["Tagalog", ["tl"]],
	["Tamil", ["ta"]],
	["Telugu", ["te"]],
	["Thai", ["th", "th-TH"]],
	["Turkish", ["tr", "tr-TR"]],
	["Ukrainian", ["uk"]],
	["Urdu", ["ur"]],
	["Vietnamese", ["vi"]],
] as const;

export type DictationLanguage = "multi" | (typeof NOVA_3_LANGUAGES)[number][1][number];

export const DICTATION_LANGUAGES: readonly { code: DictationLanguage; label: string }[] = [
	{ code: "multi", label: "Multilingual" },
	...NOVA_3_LANGUAGES.flatMap(([name, codes]) =>
		codes.map((code, i) => ({ code, label: i === 0 ? name : `${name} (${code})` })),
	).sort((a, b) => a.label.localeCompare(b.label, "en")),
];

export function isDictationLanguage(value: unknown): value is DictationLanguage {
	return DICTATION_LANGUAGES.some(({ code }) => code === value);
}

/**
 * Fork (Claude Code-style live dictation): interim hypotheses stream back
 * (shown greyed while you speak), Deepgram endpoints after 300 ms of
 * silence and reports an utterance end after 1 s without words — the
 * same timing Claude Code's /voice requests. `keyterm` biases recognition
 * toward lesson vocabulary (nova-3 keyterm prompting; English and multi
 * only — other languages ignore the hints, so none are sent).
 */
export const DICTATION_ENDPOINTING_MS = 300;
export const DICTATION_UTTERANCE_END_MS = 1000;

export function keytermsSupported(language: DictationLanguage): boolean {
	return language === "multi" || language === "en" || language.startsWith("en-");
}

export function deepgramListenUrl(language: DictationLanguage, keyterms: readonly string[] = []): string {
	const terms = keytermsSupported(language) ? normalizeKeyterms(keyterms) : [];
	return "wss://api.deepgram.com/v1/listen" +
		"?model=nova-3&encoding=linear16&sample_rate=16000&channels=1" +
		`&smart_format=true&punctuate=true&endpointing=${DICTATION_ENDPOINTING_MS}` +
		`&interim_results=true&utterance_end_ms=${DICTATION_UTTERANCE_END_MS}&vad_events=true` +
		`&language=${encodeURIComponent(language)}` +
		terms.map((term) => `&keyterm=${encodeURIComponent(term)}`).join("");
}

// ─── vocabulary hints (keyterms) ─────────────────────────────────────────────

/** Deepgram caps keyterm prompting by tokens; this many short terms stays
 *  well inside it. The user's own list goes first, lesson terms fill the rest. */
export const MAX_KEYTERMS = 50;
export const MAX_KEYTERM_LENGTH = 40;

/** Trim, collapse whitespace, drop empties/overlong, de-duplicate
 *  case-insensitively (first spelling wins), cap at MAX_KEYTERMS. */
export function normalizeKeyterms(terms: readonly unknown[], max = MAX_KEYTERMS): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const raw of terms) {
		if (typeof raw !== "string") continue;
		const term = raw.replace(/\s+/g, " ").trim();
		if (!term || term.length > MAX_KEYTERM_LENGTH) continue;
		const key = term.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(term);
		if (out.length >= max) break;
	}
	return out;
}

/** Words Deepgram already knows; hinting them wastes the budget. */
const COMMON = new Set(["the", "and", "for", "with", "this", "that", "from", "true", "false", "null", "div", "span", "html", "body", "head"]);

/**
 * Lesson vocabulary from recent chat text (newest first in `texts`):
 * inline-code spans that look like a term (`colspan`, `<tbody>`,
 * `GROUP BY`), and inside fenced code: ALL-CAPS keywords (SQL) and HTML
 * tag / attribute names. Markup punctuation is stripped — keyterms are
 * what is SPOKEN ("tbody", not "<tbody>").
 */
export function extractKeyterms(texts: readonly string[], max = 30): string[] {
	const found: string[] = [];
	const add = (raw: string) => {
		const term = raw.replace(/^<\/?|\/?>$/g, "").replace(/[()[\]{};,]+$/g, "").trim();
		if (term.length < 3 || term.length > MAX_KEYTERM_LENGTH) return;
		if (!/[A-Za-z]/.test(term) || /^\d/.test(term)) return;
		if (COMMON.has(term.toLowerCase())) return;
		found.push(term);
	};
	for (const text of texts) {
		const fences = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");
		const prose = text.replace(/```[^\n]*\n[\s\S]*?```/g, " ");
		for (const m of prose.matchAll(/`([^`\n]{1,40})`/g)) {
			const span = m[1]!.trim();
			// A term, not an expression: at most three words, no operators.
			const isTag = /^<\/?[a-zA-Z][\w-]*\/?>$/.test(span);
			if (isTag || (span.split(/\s+/).length <= 3 && !/[<>=+*/\\"'`]/.test(span))) add(span);
		}
		for (const code of fences) {
			for (const m of code.matchAll(/\b[A-Z][A-Z_]{2,}\b/g)) add(m[0]);
			for (const m of code.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g)) add(m[1]!);
			for (const m of code.matchAll(/\s([a-zA-Z-]{3,})=/g)) add(m[1]!);
		}
		if (found.length > max * 3) break;
	}
	return normalizeKeyterms(found, max);
}

// ─── live transcript assembly ────────────────────────────────────────────────

/**
 * Deepgram streaming semantics (interim_results=true): each `Results`
 * message is a hypothesis for the CURRENT segment. `is_final` locks the
 * segment; `speech_final` (or a later `UtteranceEnd`) means the speaker
 * paused — the utterance is done. The assembler keeps locked segments of
 * the open utterance plus the live hypothesis:
 *   - `commit`: text to insert into the input NOW (a finished utterance)
 *   - `pending`: everything heard but not yet committed (shown greyed)
 * Pure — the hook feeds messages, the tests feed fixtures.
 */
export interface TranscriptAssembler {
	/** Feed one parsed server message; returns text to commit, if any. */
	push(message: unknown): string | null;
	/** Locked segments + live hypothesis, joined — the greyed preview. */
	pending(): string;
	/** End of stream: commit whatever is locked (the hypothesis included
	 *  only when `includeInterim`). */
	drain(includeInterim?: boolean): string | null;
	reset(): void;
}

export function createTranscriptAssembler(): TranscriptAssembler {
	let locked: string[] = [];
	let interim = "";
	const join = (parts: string[]) => parts.map((p) => p.trim()).filter(Boolean).join(" ");
	const commitLocked = (): string | null => {
		const text = join(locked);
		locked = [];
		return text || null;
	};
	return {
		push(message) {
			if (typeof message !== "object" || message === null) return null;
			const msg = message as { type?: unknown; is_final?: unknown; speech_final?: unknown; channel?: { alternatives?: Array<{ transcript?: unknown }> } };
			if (msg.type === "UtteranceEnd") {
				interim = "";
				return commitLocked();
			}
			if (msg.type !== "Results") return null;
			const raw = msg.channel?.alternatives?.[0]?.transcript;
			const text = typeof raw === "string" ? raw.trim() : "";
			if (msg.is_final === true) {
				interim = "";
				if (text) locked.push(text);
				return msg.speech_final === true ? commitLocked() : null;
			}
			interim = text;
			return null;
		},
		pending() {
			return join([...locked, interim]);
		},
		drain(includeInterim = false) {
			if (includeInterim && interim) locked.push(interim);
			interim = "";
			return commitLocked();
		},
		reset() {
			locked = [];
			interim = "";
		},
	};
}
