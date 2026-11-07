/**
 * Fork (2026-11-07): automatic data snapshots + restoring an emptied data dir.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { after, describe, it } from "node:test";

const { backupNow, restoreIfEmpty, listSnapshots } = createRequire(import.meta.url)("../electron/data-backup.cjs") as {
	backupNow(o: { dataDir: string; authFile: string; root: string; now?: number; keep?: number }): string | null;
	restoreIfEmpty(o: { dataDir: string; authFile: string; root: string; now?: number }): string | null;
	listSnapshots(root: string): Array<{ name: string; dir: string; chats: number }>;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lh-backup-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function setup(name: string) {
	const base = path.join(tmp, name);
	const dataDir = path.join(base, "userData", "data");
	const authFile = path.join(base, "userData", "auth.json");
	const root = path.join(base, "backups");
	fs.mkdirSync(path.join(dataDir, "chats"), { recursive: true });
	return { dataDir, authFile, root };
}
const T = Date.UTC(2026, 10, 7, 12);

describe("data backups", () => {
	it("snapshots data and auth.json, and skips when nothing changed", () => {
		const o = setup("a");
		fs.writeFileSync(path.join(o.dataDir, "chats", "c1.json"), "{}");
		fs.writeFileSync(path.join(o.dataDir, "settings.json"), "{}");
		fs.writeFileSync(o.authFile, '{"DEEPGRAM_API_KEY":"x"}');
		const first = backupNow({ ...o, now: T })!;
		assert.ok(fs.existsSync(path.join(first, "chats", "c1.json")));
		assert.ok(fs.existsSync(path.join(first, "auth.json")));
		assert.equal(backupNow({ ...o, now: T + 1000 }), null, "unchanged → no new snapshot");
		fs.writeFileSync(path.join(o.dataDir, "chats", "c1.json"), '{"m":1}');
		assert.ok(backupNow({ ...o, now: T + 2000 }), "changed → new snapshot");
		assert.equal(listSnapshots(o.root).length, 2);
	});

	it("pruning keeps the newest N and always the snapshot with the most chats", () => {
		const o = setup("b");
		for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(o.dataDir, "chats", `c${i}.json`), "{}");
		backupNow({ ...o, now: T, keep: 2 });
		fs.rmSync(path.join(o.dataDir, "chats"), { recursive: true });
		for (let i = 0; i < 4; i++) {
			fs.writeFileSync(path.join(o.dataDir, "settings.json"), `{"v":${i}}`);
			backupNow({ ...o, now: T + (i + 1) * 1000, keep: 2 });
		}
		const snaps = listSnapshots(o.root);
		assert.equal(snaps.length, 3, "2 newest + the 3-chat one");
		assert.equal(snaps[0]!.chats, 3);
	});

	it("an emptied data dir is restored from the best snapshot, keys included", () => {
		const o = setup("c");
		fs.writeFileSync(path.join(o.dataDir, "chats", "c1.json"), '{"keep":true}');
		fs.writeFileSync(o.authFile, '{"DEEPGRAM_API_KEY":"x"}');
		backupNow({ ...o, now: T });
		fs.rmSync(path.join(o.dataDir, "chats", "c1.json"));
		fs.rmSync(o.authFile);
		const from = restoreIfEmpty({ ...o, now: T + 1000 });
		assert.ok(from);
		assert.equal(fs.readFileSync(path.join(o.dataDir, "chats", "c1.json"), "utf8"), '{"keep":true}');
		assert.ok(fs.existsSync(o.authFile), "auth.json back");
		assert.ok(!fs.existsSync(path.join(o.dataDir, ".fingerprint")));
		assert.equal(restoreIfEmpty({ ...o, now: T + 2000 }), null, "chats present → nothing to do");
	});

	it("nothing to restore when no snapshot has chats", () => {
		const o = setup("d");
		assert.equal(restoreIfEmpty(o), null);
	});
});
