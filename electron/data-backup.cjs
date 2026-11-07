"use strict";
/**
 * Automatic data snapshots (fork, 2026-11-07, after a real data loss).
 *
 * The learner's chats, graph and settings live in userData/data, and the
 * BYOK keys in userData/auth.json. Both were lost once, with no copy left.
 * This keeps copies OUTSIDE userData (Documents/LearnHarness-rezervne-kopije):
 *   - a snapshot on every start, every few minutes while running, and on quit,
 *     but only when something changed since the last snapshot;
 *   - the newest KEEP snapshots, plus the one holding the most chats ever, so
 *     a run of empty snapshots can never push the last good copy out;
 *   - on start, if data/chats is empty or missing while a snapshot has chats,
 *     that snapshot is restored first (the current state is snapshotted too).
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const KEEP = 40;
const FINGERPRINT = ".fingerprint";
const AUTH_COPY = "auth.json";

function walk(dir, base = dir, out = []) {
	let entries;
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const e of entries) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) walk(full, base, out);
		else if (e.isFile()) out.push(path.relative(base, full));
	}
	return out;
}

/** Content hash of data/ (+ auth.json): changes iff a byte changed. */
function fingerprint(dataDir, authFile) {
	const h = crypto.createHash("sha256");
	for (const rel of walk(dataDir).sort()) {
		h.update(rel.replaceAll("\\", "/"));
		h.update("\0");
		h.update(fs.readFileSync(path.join(dataDir, rel)));
	}
	h.update("\0auth\0");
	if (fs.existsSync(authFile)) h.update(fs.readFileSync(authFile));
	return h.digest("hex");
}

function chatCount(dataDir) {
	try {
		return fs.readdirSync(path.join(dataDir, "chats")).filter((n) => n.endsWith(".json")).length;
	} catch {
		return 0;
	}
}

const stamp = (now) => {
	const d = new Date(now);
	const p = (n, w = 2) => String(n).padStart(w, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
};

/** Snapshot folders, oldest first. A snapshot is the data/ tree itself
 *  (same layout as the launcher's copies), plus auth.json and .fingerprint. */
function listSnapshots(root) {
	let names;
	try {
		names = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
	} catch {
		return [];
	}
	return names
		.filter((n) => /^\d{4}-\d\d-\d\d_/.test(n))
		.sort()
		.map((name) => {
			const dir = path.join(root, name);
			let fp = null;
			try {
				fp = fs.readFileSync(path.join(dir, FINGERPRINT), "utf8").trim();
			} catch {}
			return { name, dir, fingerprint: fp, chats: chatCount(dir) };
		});
}

function prune(root, keep = KEEP) {
	const snaps = listSnapshots(root);
	if (snaps.length <= keep) return;
	// Protect the newest snapshot that has the most chats.
	let best = null;
	for (const s of snaps) if (!best || s.chats >= best.chats) best = s;
	const drop = snaps.slice(0, snaps.length - keep).filter((s) => s !== best);
	for (const s of drop) fs.rmSync(s.dir, { recursive: true, force: true });
}

/** Take a snapshot if anything changed. Returns the folder, or null. */
function backupNow({ dataDir, authFile, root, now = Date.now(), keep = KEEP }) {
	if (!fs.existsSync(dataDir) && !fs.existsSync(authFile)) return null;
	const fp = fingerprint(dataDir, authFile);
	const snaps = listSnapshots(root);
	if (snaps.length && snaps[snaps.length - 1].fingerprint === fp) return null;
	fs.mkdirSync(root, { recursive: true });
	const dir = path.join(root, stamp(now));
	const tmp = `${dir}.partial`;
	if (fs.existsSync(dataDir)) fs.cpSync(dataDir, tmp, { recursive: true });
	else fs.mkdirSync(tmp, { recursive: true });
	if (fs.existsSync(authFile)) fs.copyFileSync(authFile, path.join(tmp, AUTH_COPY));
	fs.writeFileSync(path.join(tmp, FINGERPRINT), fp);
	fs.renameSync(tmp, dir); // a half-written copy never looks like a snapshot
	prune(root, keep);
	return dir;
}

/** If data/ has no chats but a snapshot does, bring the best one back
 *  (most chats, newest among equals). Missing auth.json is restored too. */
function restoreIfEmpty({ dataDir, authFile, root, now = Date.now() }) {
	if (chatCount(dataDir) > 0) return null;
	let best = null;
	for (const s of listSnapshots(root)) if (s.chats > 0 && (!best || s.chats >= best.chats)) best = s;
	if (!best) return null;
	// Keep whatever is there now (settings, an empty chats dir) as a snapshot.
	backupNow({ dataDir, authFile, root, now });
	fs.mkdirSync(dataDir, { recursive: true });
	for (const rel of walk(best.dir)) {
		if (rel === FINGERPRINT || rel === AUTH_COPY) continue;
		const to = path.join(dataDir, rel);
		fs.mkdirSync(path.dirname(to), { recursive: true });
		fs.copyFileSync(path.join(best.dir, rel), to);
	}
	const authCopy = path.join(best.dir, AUTH_COPY);
	if (!fs.existsSync(authFile) && fs.existsSync(authCopy)) fs.copyFileSync(authCopy, authFile);
	return best.dir;
}

module.exports = { backupNow, restoreIfEmpty, listSnapshots, fingerprint, KEEP };
