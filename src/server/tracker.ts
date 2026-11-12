/**
 * The competition problem archive, READ-ONLY (fork). Since 2026-11-12 this is
 * the text archive "Takmicenja-matematika-B" (DMS, category B, grades 1–4,
 * 2002/03–2025/26): statements and solutions as Markdown + LaTeX, with area,
 * subareas, difficulty 1–5, type and key idea — built by its own
 * napravi_indeks.py into podaci.json. It replaced the Matematika Tracker
 * archive (statement images only); the names here ("tracker", trackerId) are
 * kept so the learner's log and the routes stay as they were.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getHeadless } from "../agent/subagents/headless.ts";

const FOLDER = "Takmicenja-matematika-B";

/** The archive folder: LH_ARCHIVE_DIR, else OneDrive\Ucenje\…, else Documents\Ucenje\…. */
export function archiveDir(): string | null {
	const home = os.homedir();
	const candidates = [
		process.env.LH_ARCHIVE_DIR,
		process.env.OneDrive && path.join(process.env.OneDrive, "Ucenje", FOLDER),
		path.join(home, "OneDrive", "Ucenje", FOLDER),
		path.join(home, "Documents", "Ucenje", FOLDER),
	].filter((d): d is string => !!d);
	return candidates.find((d) => fs.existsSync(path.join(d, "podaci.json"))) ?? null;
}

/** One problem as napravi_indeks.py writes it. */
interface RawProblem {
	id: string;
	skup: string;
	godina: string;
	nivo: string;
	nivoKey: string;
	naziv: string;
	datum: string | null;
	razred: number;
	broj: number;
	naslov: string;
	oblasti: string[];
	tezina: number;
	tip: string;
	ideja: string;
	resenje: string;
	odgovor: string;
	md: string;
	pdf: { zadaci: string; resenja?: string };
	strZadatka: [number, number] | null;
	strResenja: [number, number] | null;
	tekst: string;
	resenjeTekst: string;
}

let cached: { dir: string; mtime: number; problems: RawProblem[]; byId: Map<string, RawProblem> } | null = null;

function load(): { dir: string; problems: RawProblem[]; byId: Map<string, RawProblem> } | null {
	const dir = archiveDir();
	if (!dir) return null;
	const file = path.join(dir, "podaci.json");
	let mtime = 0;
	try {
		mtime = fs.statSync(file).mtimeMs;
	} catch {
		return null;
	}
	if (cached && cached.dir === dir && cached.mtime === mtime) return cached;
	try {
		const data = JSON.parse(fs.readFileSync(file, "utf8")) as { zadaci?: RawProblem[] };
		const problems = Array.isArray(data.zadaci) ? data.zadaci : [];
		cached = { dir, mtime, problems, byId: new Map(problems.map((p) => [p.id, p])) };
		return cached;
	} catch (e) {
		console.warn(`[archive] cannot read ${file}: ${e instanceof Error ? e.message : e}`);
		return null;
	}
}

export function trackerAvailable(): boolean {
	return load() !== null;
}

const STAGE: Record<string, string> = { opstinsko: "Opštinsko", okruzno: "Okružno", drzavno: "Državno" };
const STAGE_ORDER: Record<string, number> = { opstinsko: 0, okruzno: 1, drzavno: 2 };

export interface TrackerProblem {
	id: string;
	title: string;
	stage: string;
	category: string;
	grade: number | null;
	year: string;
	/** The main area (Algebra, Geometrija, …). */
	branch: string | null;
	/** Subareas and a second main area, if any. */
	tags: string[];
	difficulty: number;
	/** "računski" | "dokaz" */
	kind: string;
	hasSolution: boolean;
	/** false = the solution was written later (AI), not the official one. */
	officialSolution: boolean;
}

export interface TrackerFilter {
	stage?: string;
	category?: string;
	grade?: number;
	branch?: string;
	tag?: string;
	year?: string;
	difficulty?: number;
	kind?: string;
	q?: string;
	limit?: number;
	offset?: number;
}

const titleOf = (p: RawProblem) => `${STAGE[p.nivoKey] ?? p.nivo} ${p.godina} · ${p.razred}. razred · kategorija B · zadatak ${p.broj}`;

const toProblem = (p: RawProblem): TrackerProblem => ({
	id: p.id,
	title: titleOf(p),
	stage: STAGE[p.nivoKey] ?? p.nivo,
	category: "B",
	grade: p.razred,
	year: p.godina,
	branch: p.oblasti[0] ?? null,
	tags: p.oblasti.slice(1),
	difficulty: p.tezina,
	kind: p.tip,
	hasSolution: !!p.resenjeTekst.trim(),
	officialSolution: p.resenje === "zvanično",
});

const fold = (s: string) =>
	s
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/đ/g, "dj");

export function listTrackerProblems(f: TrackerFilter): { problems: TrackerProblem[]; total: number } {
	const a = load();
	if (!a) return { problems: [], total: 0 };
	const q = f.q?.trim() ? fold(f.q.trim()) : "";
	const hits = a.problems.filter(
		(p) =>
			(!f.stage || (STAGE[p.nivoKey] ?? p.nivo) === f.stage) &&
			(!f.category || f.category === "B") &&
			(!f.grade || p.razred === f.grade) &&
			(!f.branch || p.oblasti.includes(f.branch)) &&
			(!f.tag || p.oblasti.includes(f.tag)) &&
			(!f.year || p.godina === f.year) &&
			(!f.difficulty || p.tezina === f.difficulty) &&
			(!f.kind || p.tip === f.kind) &&
			(!q || fold(`${p.naslov} ${titleOf(p)} ${p.ideja} ${p.tekst}`).includes(q)),
	);
	hits.sort((x, y) => (x.godina < y.godina ? 1 : x.godina > y.godina ? -1 : 0) || (STAGE_ORDER[x.nivoKey] ?? 9) - (STAGE_ORDER[y.nivoKey] ?? 9) || x.razred - y.razred || x.broj - y.broj);
	const limit = Math.min(500, Math.max(1, f.limit ?? 200));
	const offset = Math.max(0, f.offset ?? 0);
	return { problems: hits.slice(offset, offset + limit).map(toProblem), total: hits.length };
}

export interface TrackerFacets {
	stages: string[];
	categories: string[];
	grades: number[];
	branches: string[];
	tags: string[];
	years: string[];
	difficulties: number[];
	kinds: string[];
}

const MAIN = ["Algebra", "Analiza", "Geometrija", "Kombinatorika", "Teorija brojeva", "Verovatnoća"];

export function trackerFacets(): TrackerFacets {
	const a = load();
	const empty: TrackerFacets = { stages: [], categories: [], grades: [], branches: [], tags: [], years: [], difficulties: [], kinds: [] };
	if (!a) return empty;
	const uniq = <T,>(xs: T[]) => [...new Set(xs)];
	const branches = uniq(a.problems.map((p) => p.oblasti[0]).filter((b): b is string => !!b));
	const count = new Map<string, number>();
	for (const p of a.problems) for (const t of p.oblasti.slice(1)) if (!MAIN.includes(t)) count.set(t, (count.get(t) ?? 0) + 1);
	return {
		stages: ["Opštinsko", "Okružno", "Državno"].filter((s) => a.problems.some((p) => STAGE[p.nivoKey] === s)),
		categories: ["B"],
		grades: uniq(a.problems.map((p) => p.razred)).sort(),
		branches: MAIN.filter((b) => branches.includes(b)).concat(branches.filter((b) => !MAIN.includes(b))),
		tags: [...count.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([t]) => t),
		years: uniq(a.problems.map((p) => p.godina)).sort().reverse(),
		difficulties: uniq(a.problems.map((p) => p.tezina)).sort(),
		kinds: uniq(a.problems.map((p) => p.tip).filter(Boolean)),
	};
}

export interface TrackerProblemDetail extends TrackerProblem {
	/** The competition's own title, e.g. "Matematika, B kategorija — 2. razred, opštinsko takmičenje, 2022/2023". */
	name: string;
	source: string;
	statement: string;
	solution: string;
	idea: string;
	answer: string;
	/** The original DMS PDF pages (rendered on request): statement, solution. */
	taskPages: { pageStart: number; pageEnd: number } | null;
	solutionPages: { pageStart: number; pageEnd: number } | null;
}

export function trackerProblem(id: string): TrackerProblemDetail | null {
	const p = load()?.byId.get(id);
	if (!p) return null;
	const pages = (r: [number, number] | null, file: string | undefined) => (r && file ? { pageStart: r[0], pageEnd: r[1] } : null);
	return {
		...toProblem(p),
		name: p.naslov,
		source: `DMS · ${p.naziv} ${p.godina}${p.datum ? ` · ${p.datum}` : ""}`,
		statement: p.tekst,
		solution: p.resenjeTekst,
		idea: p.ideja,
		answer: p.odgovor,
		taskPages: pages(p.strZadatka, p.pdf.zadaci),
		solutionPages: pages(p.strResenja, p.pdf.resenja),
	};
}

/** A short reference like "Okružno 2019/2020 · 4. razred · kategorija B · zadatak 3" for the log. */
export function trackerReference(p: TrackerProblem): string {
	return p.title;
}

/** The set's PDF (statement or solution), only if it lies inside the archive folder. */
export function trackerPdfFile(problemId: string, which: "task" | "solution"): string | null {
	const a = load();
	const p = a?.byId.get(problemId);
	const rel = which === "task" ? p?.pdf.zadaci : p?.pdf.resenja;
	if (!a || !rel) return null;
	const base = path.resolve(a.dir);
	const file = path.resolve(base, rel);
	if (!file.startsWith(base + path.sep)) return null;
	return fs.existsSync(file) ? file : null;
}

const pageCache = new Map<string, Buffer>();

/**
 * One page of the original DMS PDF as a PNG — the statement page(s) or the
 * official solution page(s); index 0 = the first one. Rendered in-process
 * (pdfjs + Skia), so figures can be seen without a PDF viewer.
 */
export async function trackerSolutionPage(problemId: string, index: number, which: "task" | "solution" = "solution"): Promise<Buffer | null> {
	const p = trackerProblem(problemId);
	const r = which === "task" ? p?.taskPages : p?.solutionPages;
	if (!p || !r || !Number.isInteger(index) || index < 0) return null;
	const page = r.pageStart + index;
	if (page > r.pageEnd) return null;
	const pdf = trackerPdfFile(problemId, which);
	if (!pdf) return null;
	const key = `${pdf}:${page}`;
	const hit = pageCache.get(key);
	if (hit) return hit;
	const [out] = await getHeadless().renderPdfPages(pdf, [page], { dpi: 140 });
	if (!out) return null;
	pageCache.set(key, out.png);
	if (pageCache.size > 40) pageCache.delete(pageCache.keys().next().value!);
	return out.png;
}
