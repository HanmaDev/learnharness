/**
 * Matematika Tracker as a READ-ONLY problem archive (fork, 2026-11-08): the
 * DMS competition problems (images), their tags, and the official solution
 * pages in the DMS PDFs. Nothing here ever writes to the Tracker — none of its
 * attempts, cards or statuses are used (the learner's log is LearnHarness's).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getHeadless } from "../agent/subagents/headless.ts";

const ROOT = () => path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "rs.matematika.tracker");
const DB = () => path.join(ROOT(), "matematika-tracker.sqlite3");
const MANAGED = () => path.join(ROOT(), "managed");

type Row = Record<string, unknown>;
interface Db {
	all(sql: string, ...params: unknown[]): Row[];
	get(sql: string, ...params: unknown[]): Row | undefined;
}

let cached: { db: Db; mtime: number } | null = null;

/** node:sqlite, read-only (sees the WAL too). Reopened when the file changes. */
function open(): Db | null {
	const file = DB();
	let mtime = 0;
	try {
		mtime = fs.statSync(file).mtimeMs;
		const wal = `${file}-wal`;
		if (fs.existsSync(wal)) mtime = Math.max(mtime, fs.statSync(wal).mtimeMs);
	} catch {
		return null;
	}
	if (cached && cached.mtime === mtime) return cached.db;
	try {
		// getBuiltinModule: the bundler leaves it alone (a require/import of
		// node:sqlite gets rewritten by Turbopack and fails at runtime).
		const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as unknown as { DatabaseSync: new (p: string, o: { readOnly: boolean }) => { prepare(sql: string): { all(...p: unknown[]): Row[]; get(...p: unknown[]): Row | undefined } } };
		const raw = new DatabaseSync(file, { readOnly: true });
		const db: Db = { all: (sql, ...p) => raw.prepare(sql).all(...p), get: (sql, ...p) => raw.prepare(sql).get(...p) };
		cached = { db, mtime };
		return db;
	} catch (e) {
		console.warn(`[tracker] cannot open the archive: ${e instanceof Error ? e.message : e}`);
		return null;
	}
}

export function trackerAvailable(): boolean {
	return open() !== null;
}

export interface TrackerProblem {
	id: string;
	title: string;
	stage: string;
	category: string;
	grade: number | null;
	year: string;
	branch: string | null;
	imageId: string | null;
	hasSolution: boolean;
}

export interface TrackerFilter {
	stage?: string;
	category?: string;
	grade?: number;
	branch?: string;
	year?: string;
	q?: string;
	limit?: number;
	offset?: number;
}

const BASE = `
	SELECT p.id, p.title, coalesce(p.source_stage,'') AS stage, coalesce(p.source_category,'') AS category,
	       p.source_grade AS grade, coalesce(p.source_school_year,'') AS year, b.name AS branch,
	       (SELECT a.id FROM attachments a WHERE a.owner_type='problem' AND a.owner_id=p.id AND a.deleted_at IS NULL ORDER BY a.created_at LIMIT 1) AS imageId,
	       (SELECT count(*) FROM dms_problem_imports d WHERE d.problem_id=p.id AND d.solution_document_id IS NOT NULL) AS hasSolution
	FROM problems p LEFT JOIN branches b ON b.id = p.branch_id
	WHERE p.deleted_at IS NULL`;

const toProblem = (r: Row): TrackerProblem => ({
	id: String(r.id),
	title: String(r.title ?? ""),
	stage: String(r.stage ?? ""),
	category: String(r.category ?? ""),
	grade: r.grade === null || r.grade === undefined ? null : Number(r.grade),
	year: String(r.year ?? ""),
	branch: r.branch ? String(r.branch) : null,
	imageId: r.imageId ? String(r.imageId) : null,
	hasSolution: Number(r.hasSolution) > 0,
});

export function listTrackerProblems(f: TrackerFilter): { problems: TrackerProblem[]; total: number } {
	const db = open();
	if (!db) return { problems: [], total: 0 };
	const where: string[] = [];
	const params: unknown[] = [];
	if (f.stage) (where.push("p.source_stage = ?"), params.push(f.stage));
	if (f.category !== undefined && f.category !== "") (where.push("p.source_category = ?"), params.push(f.category));
	if (f.grade) (where.push("p.source_grade = ?"), params.push(f.grade));
	if (f.branch) (where.push("b.name = ?"), params.push(f.branch));
	if (f.year) (where.push("p.source_school_year = ?"), params.push(f.year));
	if (f.q?.trim()) (where.push("p.title LIKE ?"), params.push(`%${f.q.trim()}%`));
	const cond = where.length ? ` AND ${where.join(" AND ")}` : "";
	const limit = Math.min(500, Math.max(1, f.limit ?? 200));
	const offset = Math.max(0, f.offset ?? 0);
	const total = Number(db.get(`SELECT count(*) AS n FROM problems p LEFT JOIN branches b ON b.id=p.branch_id WHERE p.deleted_at IS NULL${cond}`, ...params)?.n ?? 0);
	const rows = db.all(`${BASE}${cond} ORDER BY p.source_school_year DESC, p.source_stage, p.source_category, p.source_grade, p.title LIMIT ? OFFSET ?`, ...params, limit, offset);
	return { problems: rows.map(toProblem), total };
}

export function trackerFacets(): { stages: string[]; categories: string[]; grades: number[]; branches: string[]; years: string[] } {
	const db = open();
	if (!db) return { stages: [], categories: [], grades: [], branches: [], years: [] };
	const col = (sql: string) => db.all(sql).map((r) => r.v).filter((v) => v !== null && v !== "");
	return {
		stages: col("SELECT DISTINCT source_stage AS v FROM problems WHERE deleted_at IS NULL ORDER BY 1").map(String),
		categories: col("SELECT DISTINCT source_category AS v FROM problems WHERE deleted_at IS NULL ORDER BY 1").map(String),
		grades: col("SELECT DISTINCT source_grade AS v FROM problems WHERE deleted_at IS NULL ORDER BY 1").map(Number),
		branches: col("SELECT name AS v FROM branches WHERE deleted_at IS NULL ORDER BY position, name").map(String),
		years: col("SELECT DISTINCT source_school_year AS v FROM problems WHERE deleted_at IS NULL ORDER BY 1 DESC").map(String),
	};
}

export interface TrackerProblemDetail extends TrackerProblem {
	source: string;
	tags: string[];
	/** The official solution: a DMS PDF and its pages. */
	solution: { documentId: string; pageStart: number; pageEnd: number } | null;
	task: { documentId: string; pageStart: number; pageEnd: number } | null;
}

export function trackerProblem(id: string): TrackerProblemDetail | null {
	const db = open();
	if (!db) return null;
	const r = db.get(`${BASE} AND p.id = ?`, id);
	if (!r) return null;
	const imp = db.get("SELECT task_document_id, task_page_start, task_page_end, solution_document_id, solution_page_start, solution_page_end FROM dms_problem_imports WHERE problem_id = ? LIMIT 1", id);
	const extra = db.get("SELECT coalesce(source_title,'') AS source FROM problems WHERE id = ?", id);
	const tags = db.all("SELECT tag FROM problem_tags WHERE problem_id = ? ORDER BY position", id).map((t) => String(t.tag));
	const range = (doc: unknown, a: unknown, b: unknown) => (doc ? { documentId: String(doc), pageStart: Number(a) || 1, pageEnd: Number(b) || Number(a) || 1 } : null);
	return {
		...toProblem(r),
		source: String(extra?.source ?? ""),
		tags,
		task: range(imp?.task_document_id, imp?.task_page_start, imp?.task_page_end),
		solution: range(imp?.solution_document_id, imp?.solution_page_start, imp?.solution_page_end),
	};
}

/** A managed file's path, only if it really lies inside the Tracker's managed folder. */
function managedFile(stored: unknown, sub: "attachments" | "sources"): string | null {
	if (typeof stored !== "string" || !stored) return null;
	const resolved = path.resolve(stored.replace(/\//g, path.sep));
	const base = path.resolve(MANAGED(), sub);
	if (!resolved.startsWith(base + path.sep)) return null;
	return fs.existsSync(resolved) ? resolved : null;
}

export function trackerImageFile(attachmentId: string): { file: string; mime: string } | null {
	const db = open();
	const r = db?.get("SELECT managed_path, mime_type FROM attachments WHERE id = ? AND deleted_at IS NULL", attachmentId);
	const file = managedFile(r?.managed_path, "attachments");
	return file ? { file, mime: String(r?.mime_type ?? "image/png") } : null;
}

export function trackerPdfFile(documentId: string): string | null {
	const db = open();
	const r = db?.get("SELECT managed_path FROM dms_source_documents WHERE id = ?", documentId);
	return managedFile(r?.managed_path, "sources");
}

/** A short reference like "Okružno 2019/2020 · 4A · zadatak 3" for the log. */
export function trackerReference(p: TrackerProblem): string {
	return p.title || [p.stage, p.year, p.grade ? `${p.grade}${p.category}` : p.category].filter(Boolean).join(" · ");
}

const pageCache = new Map<string, Buffer>();

/**
 * One page of a problem's official solution as a PNG (index 0 = its first
 * solution page), rendered from the DMS PDF in-process (pdfjs + Skia) — the
 * app shows exactly the solution pages, no PDF viewer needed.
 */
export async function trackerSolutionPage(problemId: string, index: number): Promise<Buffer | null> {
	const p = trackerProblem(problemId);
	if (!p?.solution || !Number.isInteger(index) || index < 0) return null;
	const page = p.solution.pageStart + index;
	if (page > p.solution.pageEnd) return null;
	const pdf = trackerPdfFile(p.solution.documentId);
	if (!pdf) return null;
	const key = `${p.solution.documentId}:${page}`;
	const hit = pageCache.get(key);
	if (hit) return hit;
	const [out] = await getHeadless().renderPdfPages(pdf, [page], { dpi: 140 });
	if (!out) return null;
	pageCache.set(key, out.png);
	if (pageCache.size > 40) pageCache.delete(pageCache.keys().next().value!);
	return out.png;
}
