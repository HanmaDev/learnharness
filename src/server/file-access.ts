/** Current optional learner-source preferences, wired by the server
 * composition root into the #157 policy seam. Mandatory #421 protection
 * stays in fs-shared; do NOT add a whole data/userData denial here. */
import os from "node:os";
import path from "node:path";
import type { FileAccessPolicy } from "../agent/tools/file-access.ts";
import { readFileAccessSettings } from "../store/settings.ts";
import { agentAccessMode } from "../core/settings-resolution.ts";
import { effectiveSettings } from "./stores.ts";
import { withAliasedFolders } from "./device-paths.ts";

export function expandFolder(folder: string, home: string = os.homedir()): string {
	if (folder === "~") return home;
	if (folder.startsWith("~/")) return path.join(home, folder.slice(2));
	if (!path.isAbsolute(folder)) throw new Error("Invalid file-access folder for this server filesystem");
	return path.resolve(folder);
}

export function fileAccessPolicy(): FileAccessPolicy {
	// Fork (2026-11-12): Bypass reads anywhere (credential denials still apply).
	try { if (agentAccessMode(effectiveSettings()) === "bypass") return { restricted: false, folders: [] }; }
	catch { /* unreadable settings: fall through to the stored boundary */ }
	const result = readFileAccessSettings();
	if (!result.ok) return { restricted: true, folders: [], error: result.error };
	// Fork (sync): each allowed folder also allows its synced twin.
	return { restricted: result.settings.restricted, folders: withAliasedFolders(result.settings.folders.map((folder) => expandFolder(folder))) };
}

/** Safe UI diagnostic, no raw JSON/file contents. A corrupt record must
 * not make the restriction toggle appear safely OFF while reads are blocked. */
export function fileAccessConfigurationError(): string | null {
	const result = readFileAccessSettings();
	return result.ok ? null : result.error;
}
