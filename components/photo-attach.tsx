"use client";

import { useCallback, useContext, useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { ImagePlusIcon, Loader2Icon, SmartphoneIcon, XIcon } from "lucide-react";
import { ChatActionsContext } from "@/components/chat-actions-context";
import { useImageSnapshot } from "@/components/artifacts/use-image-snapshot";
import { PhoneUploadDialog } from "@/components/phone-upload";
import { cn } from "@/lib/utils";

/**
 * Fork (2026-11-07): photos of handwritten work. Paste (Ctrl+V), drag onto
 * the area, attach a file, or take one with the phone (QR). Each photo is
 * uploaded to /api/chats/:id/upload-image (normalized + saved as a session
 * snapshot) and the submission carries its snapshot id; the server attaches
 * the image itself for the teacher.
 */

export const MAX_PHOTOS = 4;

/** How many trays currently hold each photo — a removal deletes the
 *  server copy only when no other tray still has it. */
const holders = new Map<string, number>();
const hold = (id: string, delta: number) => {
	const n = (holders.get(id) ?? 0) + delta;
	if (n <= 0) holders.delete(id);
	else holders.set(id, n);
	return n;
};

export interface AttachedPhoto {
	snapshotId: string;
	/** A local preview (object URL) until the snapshot loads. */
	preview?: string;
}

export function usePhotoAttachments() {
	const chatId = useContext(ChatActionsContext)?.chatId;
	const [photos, setPhotos] = useState<AttachedPhoto[]>([]);
	const [uploading, setUploading] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const photosRef = useRef(photos);
	photosRef.current = photos;

	useEffect(() => () => {
		for (const p of photosRef.current) {
			if (p.preview) URL.revokeObjectURL(p.preview);
			hold(p.snapshotId, -1);
		}
	}, []);

	const addSnapshot = useCallback((snapshotId: string, preview?: string) => {
		if (photosRef.current.some((p) => p.snapshotId === snapshotId) || photosRef.current.length >= MAX_PHOTOS) return;
		hold(snapshotId, 1);
		setPhotos((list) => (list.some((p) => p.snapshotId === snapshotId) || list.length >= MAX_PHOTOS ? list : [...list, { snapshotId, preview }]));
	}, []);

	const addFiles = useCallback(
		async (files: readonly File[]) => {
			const images = files.filter((f) => f.type.startsWith("image/"));
			if (images.length === 0) {
				if (files.length > 0) setError("Only images can be attached here.");
				return;
			}
			if (!chatId) {
				setError("Open a chat first.");
				return;
			}
			const room = MAX_PHOTOS - photosRef.current.length;
			if (room <= 0) {
				setError(`At most ${MAX_PHOTOS} photos per answer.`);
				return;
			}
			setError(null);
			for (const file of images.slice(0, room)) {
				setUploading((n) => n + 1);
				try {
					const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/upload-image`, {
						method: "POST",
						headers: { "Content-Type": file.type || "application/octet-stream" },
						body: file,
					});
					const body = (await res.json().catch(() => null)) as { snapshotId?: string; error?: string } | null;
					if (!res.ok || !body?.snapshotId) throw new Error(body?.error ?? `Upload failed (${res.status})`);
					addSnapshot(body.snapshotId, URL.createObjectURL(file));
				} catch (err) {
					setError(err instanceof Error ? err.message : "Upload failed");
				} finally {
					setUploading((n) => n - 1);
				}
			}
		},
		[chatId, addSnapshot],
	);

	/** `discard`: the learner removed it (not sent) — the server drops it if unused. */
	const remove = useCallback((snapshotId: string, discard = false) => {
		if (!photosRef.current.some((p) => p.snapshotId === snapshotId)) return;
		const stillHeld = hold(snapshotId, -1) > 0;
		setPhotos((list) => {
			const gone = list.find((p) => p.snapshotId === snapshotId);
			if (gone?.preview) URL.revokeObjectURL(gone.preview);
			return list.filter((p) => p.snapshotId !== snapshotId);
		});
		if (discard && chatId && !stillHeld) {
			void fetch(`/api/chats/${encodeURIComponent(chatId)}/upload-image?snapshot=${snapshotId}`, { method: "DELETE" }).catch(() => {});
		}
	}, [chatId]);

	const clear = useCallback(() => {
		for (const p of photosRef.current) {
			if (p.preview) URL.revokeObjectURL(p.preview);
			hold(p.snapshotId, -1);
		}
		setPhotos([]);
		setError(null);
	}, []);

	/** Spread onto the area that accepts paste + drop. */
	const areaProps = {
		"data-photo-drop": "",
		onPaste: (e: ClipboardEvent) => {
			const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
			if (files.length === 0) return;
			e.preventDefault();
			void addFiles(files);
		},
		onDragOver: (e: DragEvent) => {
			if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) e.preventDefault();
		},
		onDrop: (e: DragEvent) => {
			const files = Array.from(e.dataTransfer?.files ?? []);
			if (!files.some((f) => f.type.startsWith("image/"))) return; // other files: the path drop zone
			e.preventDefault();
			void addFiles(files);
		},
	};

	return { chatId, photos, ids: photos.map((p) => p.snapshotId), uploading: uploading > 0, error, setError, addFiles, addSnapshot, remove, clear, areaProps };
}

export type PhotoAttachments = ReturnType<typeof usePhotoAttachments>;

/** The thumbnails + Attach / Phone buttons row. */
export function PhotoTray({ attach, disabled = false }: { attach: PhotoAttachments; disabled?: boolean }) {
	const fileRef = useRef<HTMLInputElement>(null);
	const [phoneOpen, setPhoneOpen] = useState(false);
	const full = attach.photos.length >= MAX_PHOTOS;
	return (
		<div data-testid="photo-tray" className="flex flex-wrap items-center gap-1.5 px-1.5 pb-1 text-xs text-muted-foreground">
			{attach.photos.map((p) => (
				<span key={p.snapshotId} className="relative">
					<PhotoThumb snapshotId={p.snapshotId} preview={p.preview} className="size-12" />
					<button
						type="button"
						aria-label="Remove photo"
						data-testid="photo-remove"
						onClick={() => attach.remove(p.snapshotId, true)}
						className="absolute -top-1.5 -right-1.5 rounded-full border bg-card p-0.5 text-muted-foreground hover:text-foreground"
					>
						<XIcon className="size-3" />
					</button>
				</span>
			))}
			{attach.uploading && <Loader2Icon className="size-4 animate-spin" aria-label="Uploading" />}
			<button
				type="button"
				data-testid="photo-attach"
				disabled={disabled || full}
				onClick={() => fileRef.current?.click()}
				className="flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
				title="Attach a photo of your work (or paste / drag one here)"
			>
				<ImagePlusIcon className="size-3.5" />
				Photo
			</button>
			<button
				type="button"
				data-testid="photo-phone"
				disabled={disabled || full || !attach.chatId}
				onClick={() => setPhoneOpen(true)}
				className="flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
				title="Take the photo with your phone (QR code)"
			>
				<SmartphoneIcon className="size-3.5" />
				From phone
			</button>
			{attach.error && <span className="text-error">{attach.error}</span>}
			<input
				ref={fileRef}
				type="file"
				accept="image/*"
				multiple
				hidden
				onChange={(e) => {
					void attach.addFiles(Array.from(e.target.files ?? []));
					e.target.value = "";
				}}
			/>
			{phoneOpen && attach.chatId && (
				<PhoneUploadDialog
					chatId={attach.chatId}
					onClose={() => setPhoneOpen(false)}
					onPhoto={(snapshotId) => {
						attach.addSnapshot(snapshotId);
						setPhoneOpen(false);
					}}
				/>
			)}
		</div>
	);
}

/** One photo thumbnail from a session snapshot (or a local preview). */
export function PhotoThumb({ snapshotId, preview, className }: { snapshotId: string; preview?: string; className?: string }) {
	const { image } = useImageSnapshot(preview ? undefined : snapshotId);
	const src = preview ?? (image ? `data:${image.mimeType};base64,${image.data}` : undefined);
	const [big, setBig] = useState(false);
	return (
		<>
			<button
				type="button"
				data-testid="photo-thumb"
				onClick={() => src && setBig(true)}
				className={cn("block overflow-hidden rounded-md border bg-muted", className)}
				aria-label="Open photo"
			>
				{/* eslint-disable-next-line @next/next/no-img-element -- data:/blob: snapshots, like image-card */}
				{src ? <img src={src} alt="Photo of handwritten work" className="size-full object-cover" /> : <span className="block size-full animate-pulse" />}
			</button>
			{big && src && (
				<div
					role="dialog"
					aria-label="Photo"
					onClick={() => setBig(false)}
					onKeyDown={(e) => { if (e.key === "Escape") setBig(false); }}
					className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-6 backdrop-blur-sm"
				>
					{/* eslint-disable-next-line @next/next/no-img-element -- data:/blob: snapshots, like image-card */}
					<img src={src} alt="Photo of handwritten work" className="max-h-full max-w-full rounded-lg object-contain" />
				</div>
			)}
		</>
	);
}

/** Photos on a transcript card (thinking card, answered card). */
export function PhotoStrip({ ids }: { ids: readonly string[] }) {
	if (ids.length === 0) return null;
	return (
		<div data-testid="photo-strip" className="mt-2 flex flex-wrap gap-2">
			{ids.map((id) => (
				<PhotoThumb key={id} snapshotId={id} className="size-20" />
			))}
		</div>
	);
}
