"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircleIcon, SendIcon, XIcon } from "lucide-react";
import { PathInput } from "@/components/path-input";
import { PhotoTray, usePhotoAttachments } from "@/components/photo-attach";
import { finishDictation, joinDictation, useDictationTarget } from "@/components/dictation";
import { useDictationGhost } from "@/components/dictation-state";
import { cn } from "@/lib/utils";

/**
 * Fork (2026-11-07): "Talk to the teacher" — the way out of a waiting
 * question that keeps your words. Sending sets every waiting question aside
 * (the teacher reads why) and delivers the message as a normal turn; the
 * teacher answers, then re-asks when it fits. Alt+T toggles it while a
 * question waits (open or collapsed). While open it owns dictation (the form
 * and the reading-thinking field release it).
 * Fork (2026-11-11): images ride along (paste, drop, Photo, From phone), and
 * the collapsed question bar opens it directly (`showOpener` false then:
 * the bar carries the button, the question stays closed). The draft (words,
 * images) survives the dock remounting after a refused send (`draftKey`).
 */
const talkDrafts = new Map<string, { text: string; photos: string[] }>();

/** A kept talk draft for this question (the panel reopens with it). */
export const hasTalkDraft = (key: string | undefined) => !!key && talkDrafts.has(key);

export function TalkToTeacher({
	active,
	open,
	onOpenChange,
	onTalk,
	disabled = false,
	dictationClaim = true,
	showOpener = true,
	draftKey,
}: {
	/** Arms the Alt+T shortcut. */
	active: boolean;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Resolves false when the send was refused — the text stays. */
	onTalk: (text: string, photos: string[]) => Promise<boolean> | boolean | void;
	disabled?: boolean;
	/** Show the "Talk to the teacher instead" link while closed (the open
	 *  question). The collapsed bar has its own button. */
	showOpener?: boolean;
	/** Whether the open field may claim dictation. */
	dictationClaim?: boolean;
	/** Keeps the draft across a remount (the waiting question's key). */
	draftKey?: string;
}) {
	const kept = draftKey ? talkDrafts.get(draftKey) : undefined;
	const [text, setText] = useState(kept?.text ?? "");
	const textRef = useRef(kept?.text ?? "");
	const inputRef = useRef<HTMLDivElement>(null);
	const sendingRef = useRef(false);
	const attach = usePhotoAttachments();
	const restored = useRef(false);
	useEffect(() => {
		if (restored.current) return;
		restored.current = true;
		for (const id of kept?.photos ?? []) attach.addSnapshot(id);
		// eslint-disable-next-line -- restore once, on mount
	}, []);
	const photoKey = attach.ids.join(",");
	useEffect(() => {
		if (!draftKey || !restored.current) return;
		const photos = photoKey ? photoKey.split(",") : [];
		if (!text && photos.length === 0) talkDrafts.delete(draftKey);
		else talkDrafts.set(draftKey, { text, photos });
	}, [draftKey, text, photoKey]);

	const append = useCallback((t: string) => {
		const v = joinDictation(textRef.current, t);
		textRef.current = v;
		setText(v);
	}, []);
	useDictationTarget(append, open && dictationClaim);
	const ghost = useDictationGhost(append);

	useEffect(() => {
		if (open) inputRef.current?.focus();
	}, [open]);

	useEffect(() => {
		if (!active) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "t" || e.key === "T" || e.code === "KeyT")) {
				e.preventDefault();
				e.stopPropagation();
				onOpenChange(!open);
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [active, open, onOpenChange]);

	const send = async () => {
		if (sendingRef.current || disabled) return;
		sendingRef.current = true;
		try {
			await finishDictation(); // a spoken tail lands before we read the field
			const message = textRef.current.trim();
			const photos = attach.ids;
			if (!message && photos.length === 0) return;
			if (attach.uploading) return;
			const ok = await onTalk(message, photos);
			if (ok === false) return; // refused: keep the words and images, stay open
			if (draftKey) talkDrafts.delete(draftKey);
			textRef.current = "";
			setText("");
			attach.clear();
			onOpenChange(false);
		} finally {
			sendingRef.current = false;
		}
	};

	if (!open) {
		if (!showOpener) return null;
		return (
			<div className="flex justify-start px-1 pb-1">
				<button
					type="button"
					data-testid="talk-to-teacher-open"
					onClick={() => onOpenChange(true)}
					className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				>
					<MessageCircleIcon className="size-3.5" />
					Talk to the teacher instead
					<kbd className="rounded border border-border/70 px-1 font-mono text-[10px] text-muted-foreground/80">Alt+T</kbd>
				</button>
			</div>
		);
	}

	return (
		<div {...attach.areaProps} data-talk-to-teacher="" data-testid="talk-to-teacher" className="mx-1 mb-1 rounded-xl border border-primary/40 bg-card/80 px-3 py-2">
			<div className="flex items-center justify-between pb-1">
				<span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Talk to the teacher</span>
				<button
					type="button"
					aria-label="Back to the question"
					data-testid="talk-to-teacher-close"
					onClick={() => onOpenChange(false)}
					className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				>
					<XIcon className="size-3.5" />
				</button>
			</div>
			<PathInput
				ref={inputRef}
				value={text}
				ghostText={ghost}
				onValueChange={(v) => {
					textRef.current = v;
					setText(v);
				}}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						// Back to the question — never the window's abort chain.
						e.preventDefault();
						e.stopPropagation();
						onOpenChange(false);
						return;
					}
					if (e.key === "Enter" && !e.shiftKey) {
						e.preventDefault();
						void send();
					}
				}}
				placeholder="Stop, ask, or tell the teacher how to teach (paste images too). The question waits; it'll come back."
				className="field-sizing-content lh-input max-h-40 min-h-10 w-full resize-none bg-transparent px-1 py-1.5 outline-none"
			/>
			<PhotoTray attach={attach} disabled={disabled} />
			<div className="flex items-center justify-between pt-1 text-xs text-muted-foreground/80">
				<span>Enter sends · Shift+Enter new line · Esc back to the question</span>
				<button
					type="button"
					data-testid="talk-to-teacher-send"
					disabled={disabled || attach.uploading || (text.trim().length === 0 && attach.ids.length === 0)}
					onClick={() => void send()}
					className={cn(
						"flex items-center gap-1 rounded-md border border-border px-2 py-1 font-medium text-foreground transition-colors",
						"enabled:hover:bg-accent disabled:opacity-50",
					)}
				>
					<SendIcon className="size-3.5" />
					Send
				</button>
			</div>
		</div>
	);
}
