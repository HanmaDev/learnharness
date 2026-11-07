import * as fs from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { createHash } from "node:crypto";
import { resolveSourcePath } from "./fs-shared.ts";
import { detectSupportedImageMimeType, detectSupportedImageMimeTypeFromFile, type ResizedImage } from "../image-processing/index.ts";
import { checkImageDimensions, MAX_LEARNER_IMAGE_BYTES } from "./learner-image-dimensions.ts";
import type { ImageSnapshot } from "../../core/contracts.ts";

/** One bounded, upright, metadata-free snapshot; path is provenance, not identity. */
export interface LearnerImage extends ImageSnapshot {
	path: string;
	snapshotId: string;
}

/** Fork: course material ships SVG figures. They are rasterized to PNG with
 *  resvg (static render, scripts never run) and then take the same bounded
 *  normalize path as any raster image. */
function isSvgPath(absolute: string): boolean {
	return path.extname(absolute).toLowerCase() === ".svg";
}

function looksLikeSvg(bytes: Uint8Array): boolean {
	const head = Buffer.from(bytes.subarray(0, 2048)).toString("utf-8").replace(/^﻿/, "").trimStart();
	return /^(<\?xml[\s\S]*?)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head);
}

/** Below this width an SVG renders at 2x so small diagrams stay legible. */
const SVG_MIN_RENDER_WIDTH = 800;

async function rasterizeSvg(bytes: Uint8Array): Promise<Uint8Array> {
	const { Resvg } = await import("@resvg/resvg-js");
	const svg = Buffer.from(bytes).toString("utf-8");
	const probe = new Resvg(svg, { font: { loadSystemFonts: true } });
	const width = probe.width;
	const opts = width > 0 && width < SVG_MIN_RENDER_WIDTH ? { fitTo: { mode: "zoom" as const, value: 2 } } : {};
	const resvg = new Resvg(svg, { ...opts, font: { loadSystemFonts: true }, background: "#ffffff" });
	return resvg.render().asPng();
}

export async function checkLearnerImage(rawPath: string): Promise<string> {
	// Reuse the shared file-access policy, including canonical/symlink checks.
	const absolute = resolveSourcePath(rawPath);
	try {
		const stat = await fs.stat(absolute);
		if (!stat.isFile()) throw new Error("it is not a regular file");
		if (stat.size > MAX_LEARNER_IMAGE_BYTES) throw new Error("image exceeds 25 MiB; provide a smaller image");
		if (!isSvgPath(absolute) && !await detectSupportedImageMimeTypeFromFile(absolute)) throw new Error("not a supported image (jpg, png, gif, webp, bmp, or svg)");
	} catch (error) {
		const reason = (error as NodeJS.ErrnoException).code === "ENOENT" ? "no such file" : error instanceof Error ? error.message : String(error);
		throw new Error(`Cannot open image ${absolute}: ${reason}`);
	}
	return absolute;
}

async function readBounded(absolute: string, signal?: AbortSignal): Promise<Uint8Array> {
	const handle = await fs.open(absolute, "r");
	try {
		if (!(await handle.stat()).isFile()) throw new Error("Image is not a regular file");
		const chunks: Buffer[] = [];
		let length = 0;
		while (true) {
			signal?.throwIfAborted();
			const chunk = Buffer.alloc(Math.min(64 * 1024, MAX_LEARNER_IMAGE_BYTES + 1 - length));
			const { bytesRead } = await handle.read(chunk);
			if (!bytesRead) break;
			length += bytesRead;
			if (length > MAX_LEARNER_IMAGE_BYTES) throw new Error("Image exceeds 25 MiB; provide a smaller image");
			chunks.push(chunk.subarray(0, bytesRead));
		}
		return Buffer.concat(chunks, length);
	} finally { await handle.close(); }
}

async function normalize(bytes: Uint8Array, signal?: AbortSignal): Promise<ResizedImage> {
	signal?.throwIfAborted();
	const worker = new Worker(path.join(process.cwd(), "src/agent/image-processing/learner-image-worker.mjs"));
	try {
		return await new Promise((resolve, reject) => {
			const abort = () => reject(signal?.reason ?? new Error("Operation aborted"));
			const cleanup = () => signal?.removeEventListener("abort", abort);
			worker.once("message", (message: { result?: ResizedImage; error?: string }) => {
				cleanup();
				if (message.result) resolve(message.result);
				else reject(new Error(message.error ?? "Image normalization failed"));
			});
			worker.once("error", (error) => { cleanup(); reject(error); });
			worker.once("exit", (code) => { cleanup(); reject(new Error(`Image normalization worker exited (${code})`)); });
			signal?.addEventListener("abort", abort, { once: true });
			if (signal?.aborted) abort();
			else worker.postMessage({ bytes });
		});
	} finally { await worker.terminate(); }
}

export async function loadLearnerImage(rawPath: string, signal?: AbortSignal): Promise<LearnerImage> {
	signal?.throwIfAborted();
	const absolute = await checkLearnerImage(rawPath);
	let bytes = await readBounded(absolute, signal);
	if (isSvgPath(absolute)) {
		if (!looksLikeSvg(bytes)) throw new Error(`Not a valid SVG image: ${absolute}`);
		try {
			bytes = await rasterizeSvg(bytes);
		} catch (error) {
			throw new Error(`Cannot render SVG ${absolute}: ${error instanceof Error ? error.message : String(error)}`);
		}
		signal?.throwIfAborted();
	}
	const mime = detectSupportedImageMimeType(bytes);
	if (!mime) throw new Error(`Not a supported image: ${absolute}`);
	checkImageDimensions(bytes, mime);
	const stored = await normalize(bytes, signal);
	signal?.throwIfAborted();
	if (stored.mimeType !== "image/png" && stored.mimeType !== "image/jpeg") throw new Error("Unexpected stored image format");
	const snapshotId = createHash("sha256").update(Buffer.from(stored.data, "base64")).digest("hex");
	return { path: absolute, snapshotId, mimeType: stored.mimeType, data: stored.data, width: stored.width, height: stored.height };
}
