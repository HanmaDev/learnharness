/**
 * Fork (2026-11-12, OneDrive sync): this computer's path mappings, handed
 * over by the desktop shell (LH_PATH_ALIASES, from its device.json). Course
 * folders live in OneDrive; lessons keep the paths they were written with
 * (e.g. C:\Users\computer\Documents\Ucenje\...), and each computer maps that
 * root to its own synced copy.
 */
import * as path from "node:path";
import { isWithin } from "../agent/tools/file-access.ts";
import type { PathAlias } from "../agent/tools/fs-shared.ts";

export function parsePathAliases(raw: string | undefined): PathAlias[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.flatMap((entry): PathAlias[] => {
			const e = entry as Record<string, unknown>;
			return typeof e?.from === "string" && typeof e?.to === "string" && path.isAbsolute(e.from) && path.isAbsolute(e.to)
				? [{ from: path.resolve(e.from), to: path.resolve(e.to) }]
				: [];
		});
	} catch {
		return [];
	}
}

let cache: { raw: string | undefined; aliases: PathAlias[] } | null = null;
export function devicePathAliases(): PathAlias[] {
	const raw = process.env.LH_PATH_ALIASES;
	if (!cache || cache.raw !== raw) cache = { raw, aliases: parsePathAliases(raw) };
	return cache.aliases;
}

/** File access folders, plus each folder's synced twin: an allowed
 *  Documents\Ucenje also allows OneDrive\Ucenje (where its links lead). */
export function withAliasedFolders(folders: readonly string[], aliases: readonly PathAlias[] = devicePathAliases()): string[] {
	const out = [...folders];
	const ci = process.platform === "win32";
	for (const folder of folders) {
		for (const { from, to } of aliases) {
			let twin: string | null = null;
			if (isWithin(folder, from, ci)) twin = path.join(to, path.relative(from, folder));
			else if (isWithin(from, folder, ci)) twin = to;
			if (twin && !out.some((f) => isWithin(twin!, f, ci) && isWithin(f, twin!, ci))) out.push(twin);
		}
	}
	return out;
}
