/**
 * tracker_problem's title lookup (fork, 2026-11-08), pure. Archive titles look
 * like "Okružno 2019/2020 · 4. razred · kategorija A · zadatak 3" or
 * "IMO 2006/2007 · 1. dan · zadatak 2". A query is parsed into the same
 * fields; every field the query names must match, and a tie is never broken
 * by guessing (review finding: word scoring swapped grade and problem number).
 */

export interface ArchiveFields {
	stage?: string;
	/** "2019/2020", or a single year "2019" that either half may match. */
	year?: string;
	grade?: number;
	category?: string;
	day?: number;
	number?: number;
}

const fold = (s: string) =>
	s
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/đ/g, "dj");

/** The fields of an archive title. */
export function titleFields(title: string, stage: string): ArchiveFields {
	const t = fold(title);
	const out: ArchiveFields = { stage };
	const y = /(\d{4})\/(\d{4})/.exec(t);
	if (y) out.year = `${y[1]}/${y[2]}`;
	const g = /(\d)\.\s*razred/.exec(t);
	if (g) out.grade = Number(g[1]);
	const c = /kategorija\s+([ab])\b/.exec(t);
	if (c) out.category = c[1]!.toUpperCase();
	const d = /(\d)\.\s*dan\b/.exec(t);
	if (d) out.day = Number(d[1]);
	const n = /zadatak\s+(\d+)/.exec(t);
	if (n) out.number = Number(n[1]);
	return out;
}

/** The fields a free-text query names. `stages` are the archive's stage names. */
export function parseArchiveQuery(query: string, stages: readonly string[]): ArchiveFields {
	let q = ` ${fold(query).replace(/[·,;:()]+/g, " ").replace(/\s+/g, " ")} `;
	const out: ArchiveFields = {};
	// The longest stage name that occurs as whole words ("Državno A" before "Državno").
	const byLength = [...stages].sort((a, b) => b.length - a.length);
	for (const s of byLength) {
		const f = fold(s);
		const i = q.indexOf(` ${f} `);
		if (i >= 0) {
			out.stage = s;
			q = `${q.slice(0, i)} ${q.slice(i + f.length + 1)}`;
			break;
		}
	}
	const yy = /(\d{4})\s*\/\s*(\d{2,4})/.exec(q);
	if (yy) {
		const a = yy[1]!;
		const b = yy[2]!.length === 2 ? `${a.slice(0, 2)}${yy[2]}` : yy[2]!;
		out.year = `${a}/${b}`;
		q = q.replace(yy[0], " ");
	} else {
		const y1 = /\b(19|20)(\d{2})\b/.exec(q);
		if (y1) {
			out.year = y1[0];
			q = q.replace(y1[0], " ");
		}
	}
	const num = /\b(?:zadatak|zadatka|zad|z|br|problem)\.?\s*(\d+)\b/.exec(q);
	if (num) {
		out.number = Number(num[1]);
		q = q.replace(num[0], " ");
	}
	const day = /\b(\d)\.?\s*dan\b/.exec(q) ?? /\bdan\s*(\d)\b/.exec(q);
	if (day) {
		out.day = Number(day[1]);
		q = q.replace(day[0], " ");
	}
	const gradeCat = /\b(\d)\s*([ab])\b/.exec(q);
	const grade = /\b(\d)\.?\s*razred\w*/.exec(q) ?? /\brazred\w*\s*(\d)\b/.exec(q);
	if (grade) {
		out.grade = Number(grade[1]);
		q = q.replace(grade[0], " ");
	} else if (gradeCat) {
		out.grade = Number(gradeCat[1]);
		out.category = gradeCat[2]!.toUpperCase();
		q = q.replace(gradeCat[0], " ");
	}
	const cat = /\bkategorij\w*\s*([ab])\b/.exec(q) ?? /\b([ab])\s*kategorij\w*/.exec(q) ?? (out.category ? null : /(?:^|\s)([ab])(?=\s|$)/.exec(q));
	if (cat && !out.category) out.category = cat[1]!.toUpperCase();
	return out;
}

/** Does a title's fields satisfy every field the query names? */
export function fieldsMatch(want: ArchiveFields, have: ArchiveFields): boolean {
	if (want.stage && want.stage !== have.stage) return false;
	if (want.year && (!have.year || (want.year.includes("/") ? have.year !== want.year : !have.year.split("/").includes(want.year)))) return false;
	if (want.grade !== undefined && want.grade !== have.grade) return false;
	if (want.category && want.category !== have.category) return false;
	if (want.day !== undefined && want.day !== have.day) return false;
	if (want.number !== undefined && want.number !== have.number) return false;
	return true;
}
