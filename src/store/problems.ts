/**
 * The problem log (fork, 2026-11-08): data/problems.json, read-modify-write
 * with an atomic replace. In the data folder, so the automatic backups carry
 * it. A file this build can't fully read (bad JSON, a wrong shape, another
 * version, malformed entries) is moved aside, never overwritten.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { emptyProblemLog, parseProblemLog, problemLogProblem, type ProblemLog } from "../core/problems.ts";
import { writeFileAtomicSync } from "./atomic-write.ts";

const FILE = () => path.join(PATHS.data, "problems.json");

export function readProblemLog(): ProblemLog {
	let raw: string;
	try {
		raw = fs.readFileSync(FILE(), "utf-8");
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyProblemLog();
		throw e;
	}
	let json: unknown;
	let problem: string | null;
	try {
		json = JSON.parse(raw);
		problem = problemLogProblem(json);
	} catch {
		problem = "invalid JSON";
	}
	if (problem) {
		const aside = FILE().replace(/\.json$/, `.unreadable-${Date.now()}.json`);
		fs.renameSync(FILE(), aside);
		console.warn(`[problems] ${problem}: moved problems.json aside to ${path.basename(aside)}`);
		return emptyProblemLog();
	}
	return parseProblemLog(json);
}

/** One synchronous read/change/write. */
export function updateProblemLog<T>(change: (log: ProblemLog) => T): T {
	const log = readProblemLog();
	const out = change(log);
	fs.mkdirSync(PATHS.data, { recursive: true });
	writeFileAtomicSync(FILE(), JSON.stringify(log, null, "\t"));
	return out;
}
