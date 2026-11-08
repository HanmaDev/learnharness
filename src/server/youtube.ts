/**
 * YouTube transcripts (fork, 2026-11-08): the caption track of a video as
 * timestamped text, for the teacher (`youtube` tool) and as a course source.
 * No API key: the player response lists the caption tracks (manual and
 * auto-generated); we pick Serbian → Croatian/Bosnian → English → any.
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const TIMEOUT_MS = 20_000;

export interface Transcript {
	videoId: string;
	title: string;
	channel: string;
	url: string;
	language: string;
	auto: boolean;
	/** Seconds from the start, and the line. */
	lines: Array<{ t: number; text: string }>;
}

/** The 11-char video id from any YouTube URL form (or a bare id). */
export function youtubeId(input: string): string | null {
	const s = input.trim();
	if (/^[\w-]{11}$/.test(s)) return s;
	try {
		const u = new URL(s);
		const host = u.hostname.replace(/^www\.|^m\./, "");
		if (host === "youtu.be") return /^[\w-]{11}/.exec(u.pathname.slice(1))?.[0] ?? null;
		if (host === "youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
			const v = u.searchParams.get("v");
			if (v && /^[\w-]{11}$/.test(v)) return v;
			const m = /^\/(?:embed|shorts|live|v)\/([\w-]{11})/.exec(u.pathname);
			return m?.[1] ?? null;
		}
	} catch {
		/* not a URL */
	}
	return null;
}

/** Find YouTube links in free text. */
export function youtubeLinks(text: string): string[] {
	const out = new Set<string>();
	for (const m of text.matchAll(/https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?[^\s)]*|shorts\/[\w-]{11}|live\/[\w-]{11}|embed\/[\w-]{11})|youtu\.be\/[\w-]{11}[^\s)]*)/g)) {
		const id = youtubeId(m[0]);
		if (id) out.add(id);
	}
	return [...out];
}

async function fetchText(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<string> {
	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
	const onAbort = () => ctl.abort();
	signal?.addEventListener("abort", onAbort, { once: true });
	try {
		const res = await fetch(url, { ...init, signal: ctl.signal, headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", ...(init.headers ?? {}) } });
		if (!res.ok) throw new Error(`YouTube ${res.status}`);
		return await res.text();
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", onAbort);
	}
}

interface CaptionTrack {
	baseUrl: string;
	languageCode: string;
	kind?: string;
	name?: { simpleText?: string; runs?: Array<{ text: string }> };
}

const LANG_ORDER = ["sr", "sr-Latn", "hr", "bs", "en"];

function pickTrack(tracks: CaptionTrack[]): CaptionTrack | null {
	if (!tracks.length) return null;
	const score = (t: CaptionTrack) => {
		const i = LANG_ORDER.findIndex((l) => t.languageCode === l || t.languageCode.startsWith(`${l}-`));
		return (i === -1 ? 50 : i) * 2 + (t.kind === "asr" ? 1 : 0);
	};
	return [...tracks].sort((a, b) => score(a) - score(b))[0]!;
}

/** The player response from YouTube's own app API (the mobile clients still
 *  hand out caption URLs that work without a page token), the watch page as
 *  the last resort. */
const CLIENTS = [
	{ client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 30 }, ua: "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip" },
	{ client: { clientName: "IOS", clientVersion: "20.10.4", deviceModel: "iPhone16,2" }, ua: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3 like Mac OS X)" },
];

async function playerResponse(videoId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
	for (const c of CLIENTS) {
		try {
			const body = await fetchText(
				"https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
				{ method: "POST", headers: { "content-type": "application/json", "user-agent": c.ua }, body: JSON.stringify({ context: { client: { ...c.client, hl: "en" } }, videoId }) },
				signal,
			);
			const pr = JSON.parse(body) as Record<string, unknown>;
			const tracks = (pr.captions as { playerCaptionsTracklistRenderer?: { captionTracks?: unknown[] } } | undefined)?.playerCaptionsTracklistRenderer?.captionTracks;
			if ((pr.playabilityStatus as { status?: string } | undefined)?.status === "OK" || tracks?.length) return pr;
		} catch (e) {
			if (signal?.aborted) throw e;
		}
	}
	const html = await fetchText(`https://www.youtube.com/watch?v=${videoId}&hl=en`, { headers: { cookie: "CONSENT=YES+1; SOCS=CAI" } }, signal);
	const m = /ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var\s|<\/script>)/s.exec(html);
	if (!m) throw new Error("YouTube: video nije dostupan.");
	return JSON.parse(m[1]!) as Record<string, unknown>;
}

const decode = (s: string) =>
	s
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

/** Parse the caption track (json3, else the XML formats). */
export function parseCaptions(body: string): Array<{ t: number; text: string }> {
	const out: Array<{ t: number; text: string }> = [];
	const trimmed = body.trim();
	if (trimmed.startsWith("{")) {
		const j = JSON.parse(trimmed) as { events?: Array<{ tStartMs?: number; segs?: Array<{ utf8?: string }> }> };
		for (const e of j.events ?? []) {
			const text = (e.segs ?? []).map((s) => s.utf8 ?? "").join("").replace(/\s+/g, " ").trim();
			if (text) out.push({ t: Math.round((e.tStartMs ?? 0) / 1000), text });
		}
		return out;
	}
	for (const m of trimmed.matchAll(/<(?:text|p)\s+([^>]*)>([\s\S]*?)<\/(?:text|p)>/g)) {
		const attrs = m[1]!;
		const start = /\bstart="([\d.]+)"/.exec(attrs)?.[1];
		const tms = /\bt="(\d+)"/.exec(attrs)?.[1];
		const t = start !== undefined ? Number(start) : tms !== undefined ? Number(tms) / 1000 : 0;
		const text = decode(m[2]!.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
		if (text) out.push({ t: Math.round(t), text });
	}
	return out;
}

export async function fetchTranscript(input: string, signal?: AbortSignal): Promise<Transcript> {
	const videoId = youtubeId(input);
	if (!videoId) throw new Error("To nije YouTube link.");
	const pr = await playerResponse(videoId, signal);
	const details = (pr.videoDetails ?? {}) as { title?: string; author?: string };
	const tracks = ((pr.captions as { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } } | undefined)?.playerCaptionsTracklistRenderer?.captionTracks ?? []) as CaptionTrack[];
	const track = pickTrack(tracks);
	if (!track) throw new Error("Ovaj video nema titlove (ni automatske), pa transkript ne postoji.");
	let lines: Array<{ t: number; text: string }> = [];
	for (const fmt of ["json3", ""]) {
		const base = track.baseUrl.replace(/&fmt=[^&]*/, "");
		const url = fmt ? `${base}&fmt=${fmt}` : base;
		const body = await fetchText(url, {}, signal).catch(() => "");
		if (body.trim()) lines = parseCaptions(body);
		if (lines.length) break;
	}
	if (!lines.length) throw new Error("YouTube nije vratio tekst titlova za ovaj video.");
	return {
		videoId,
		title: details.title ?? videoId,
		channel: details.author ?? "",
		url: `https://www.youtube.com/watch?v=${videoId}`,
		language: track.languageCode,
		auto: track.kind === "asr",
		lines,
	};
}

export const stamp = (t: number) => {
	const h = Math.floor(t / 3600);
	const m = Math.floor((t % 3600) / 60);
	const s = t % 60;
	return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(s).padStart(2, "0")}`;
};

/** The transcript as Markdown, one timestamp per ~30 s paragraph. */
export function transcriptMarkdown(tr: Transcript, maxChars = 200_000): string {
	const paras: string[] = [];
	let cur: string[] = [];
	let start = 0;
	for (const l of tr.lines) {
		if (!cur.length) start = l.t;
		cur.push(l.text);
		if (l.t - start >= 30) {
			paras.push(`[${stamp(start)}] ${cur.join(" ")}`);
			cur = [];
		}
	}
	if (cur.length) paras.push(`[${stamp(start)}] ${cur.join(" ")}`);
	let body = paras.join("\n\n");
	if (body.length > maxChars) body = `${body.slice(0, maxChars)}\n\n…(transkript skraćen)`;
	return [
		`# ${tr.title}`,
		"",
		`Kanal: ${tr.channel} · ${tr.url} · titlovi: ${tr.language}${tr.auto ? " (automatski)" : ""}`,
		"",
		body,
	].join("\n");
}
