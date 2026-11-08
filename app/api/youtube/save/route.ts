import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fetchTranscript, transcriptMarkdown, youtubeId } from "@/src/server";

export const dynamic = "force-dynamic";

/** Where saved transcripts go: Documents/Ucenje/Kursevi/YouTube when Ucenje
 *  exists (next to the course material), else Documents/LearnHarness-youtube. */
function youtubeFolder(): string {
	const docs = path.join(os.homedir(), "Documents");
	const ucenje = path.join(docs, "Ucenje");
	return fs.existsSync(ucenje) ? path.join(ucenje, "Kursevi", "YouTube") : path.join(docs, "LearnHarness-youtube");
}

/** A video title as a plain file name: no path separators (/ and \), no "..",
 *  no Windows device characters — a title can never leave the folder. */
function safeName(title: string): string {
	const cleaned = Array.from(title, (ch) => (/[<>:"/|?*]/.test(ch) || ch === "\\" || ch.charCodeAt(0) < 32 ? " " : ch)).join("");
	return (
		cleaned
			.replace(/\.{2,}/g, ".")
			.replace(/\s+/g, " ")
			.trim()
			.replace(/^[. ]+|[. ]+$/g, "")
			.slice(0, 90) || "video"
	);
}

/**
 * Fork (YouTube as a course source): POST { url } → the transcript saved as
 * Markdown in the course folder; returns { fileName, path, markdown } so the
 * client can also extract it into the knowledge graph.
 */
export async function POST(req: Request) {
	const body = (await req.json().catch(() => null)) as { url?: unknown } | null;
	if (typeof body?.url !== "string" || !youtubeId(body.url)) return Response.json({ error: "To nije YouTube link." }, { status: 400 });
	try {
		const tr = await fetchTranscript(body.url, req.signal);
		const markdown = transcriptMarkdown(tr);
		const dir = path.resolve(youtubeFolder());
		fs.mkdirSync(dir, { recursive: true });
		const fileName = `${safeName(tr.title)} [${tr.videoId}].md`;
		const file = path.resolve(dir, fileName);
		if (path.dirname(file) !== dir) return Response.json({ error: "Neispravan naziv fajla." }, { status: 400 });
		fs.writeFileSync(file, markdown, "utf-8");
		return Response.json({ fileName, path: file, markdown, title: tr.title });
	} catch (e) {
		return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
	}
}
