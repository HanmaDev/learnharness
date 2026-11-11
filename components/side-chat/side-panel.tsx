"use client";
/**
 * Fork (restored 2026-11-11, owner: "our old one was better"): the side-
 * question panel docked on the right of a lesson — topics as tabs, × closes a
 * topic (saved, reopenable under "Zatvorene teme"), + starts a new one. The
 * pre-v0.6.0 look and entry points (header chip, /btw, "Pitaj sa strane")
 * on v0.6.0's durable side-chat service: threads are answered by the private
 * side helper and never reach the teacher, Kartice or notes unless the
 * learner clicks "Sačuvaj u beleške" / "Napravi karticu".
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MessageCircleQuestionIcon, PlusIcon, SquareIcon, XIcon } from "lucide-react";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { BrailleSpinner } from "@/components/braille-spinner";
import { SideKeepButtons } from "@/components/side-keep-buttons";
import type { useSideThread } from "@/components/use-side-thread";
import { cn } from "@/lib/utils";
import type { SideChatThread } from "@/src/core";

type Side = ReturnType<typeof useSideThread>;

/** A topic's tab title: its first question. */
export function sideTopicTitle(thread: SideChatThread): string {
	const first = thread.messages.find((m) => m.role === "user")?.text.trim() ?? "";
	const line = first.split("\n")[0] ?? "";
	return line.length > 40 ? `${line.slice(0, 40)}…` : line || "Pitanje";
}

/** Saved topics: open ones become tabs, closed ones are reopenable. */
export function sideTopics(threads: readonly SideChatThread[]) {
	const asked = threads.filter((t) => t.messages.length > 0).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	return { open: asked.filter((t) => t.open), closed: asked.filter((t) => !t.open) };
}

/** The header chip: opens the panel, shows how many topics are open. */
export function SideChip({ count, onClick, active }: { count: number; onClick: () => void; active: boolean }) {
	return (
		<button
			type="button"
			data-testid="side-chip"
			title="Pitanje sa strane (/btw · Ctrl+J)"
			onClick={onClick}
			className={cn(
				"lh-no-drag flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border/80 px-2 py-0.5 text-xs font-medium uppercase tracking-wide transition-colors hover:border-border hover:text-foreground",
				active ? "bg-accent text-foreground" : "text-muted-foreground",
			)}
		>
			<MessageCircleQuestionIcon className="size-3.5 text-success" aria-hidden />
			Sa strane{count > 0 ? ` ${count}` : ""}
		</button>
	);
}

export function SidePanel({ chatId, side, onClose, onNewTopic }: {
	chatId: string;
	side: Side;
	onClose: () => void;
	/** Start a new topic (the panel's input then asks it). */
	onNewTopic: () => void;
}) {
	const { open, closed } = sideTopics(side.threads);
	const state = side.state;
	// No saved topic selected: the tips + closed topics view (a new topic's
	// input stays live below it).
	const blank = !state || (state.messages.length === 0 && !state.answering);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const threadId = state?.threadId ?? "";
	const selectedRef = useRef(threadId);
	selectedRef.current = threadId;
	const [draft, setDraft] = useState(() => (threadId ? side.draftFor(threadId) : ""));
	useLayoutEffect(() => {
		setDraft(threadId ? side.draftFor(threadId) || state?.failedQuestion || "" : "");
	}, [threadId]);
	useEffect(() => {
		if (state?.failedQuestion && !draft.trim()) setDraft(state.failedQuestion);
	}, [state?.failedQuestion]);
	useEffect(() => {
		// Never steal focus from a field the learner is typing in (a /btw
		// sent from the main input keeps them there).
		const active = document.activeElement as HTMLElement | null;
		if (active && active !== document.body && (active.isContentEditable || active.tagName === "TEXTAREA" || active.tagName === "INPUT") && !active.closest("[data-testid=side-panel]")) return;
		requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
	}, [threadId, state?.pendingPassage]);
	useEffect(() => {
		listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
	}, [state?.messages.length, state?.streamText, threadId]);

	const send = async () => {
		const text = draft.trim();
		if (!state || state.answering || !text) return;
		setError(null);
		const ok = await side.ask(text, false, state.threadId);
		if (ok) {
			setDraft("");
			side.saveDraft(state.threadId, "");
		}
	};
	const closeTopic = async (id: string) => {
		if (busy) return;
		setBusy(id);
		const ok = await side.setTopicOpen(id, false);
		setBusy(null);
		if (!ok) return setError("Tema nije zatvorena — pokušaj ponovo.");
		if (selectedRef.current === id) onNewTopic(); // the topic selected NOW, not at the click
	};
	const reopenTopic = async (id: string) => {
		if (busy) return;
		setBusy(id);
		const ok = await side.setTopicOpen(id, true);
		setBusy(null);
		if (!ok) return setError("Tema nije otvorena — pokušaj ponovo.");
		side.open({ threadId: id, anchor: { kind: "composer" } });
	};
	const passage = state?.pendingPassage;

	return (
		<aside
			className="flex w-[440px] max-w-[45vw] shrink-0 flex-col border-l border-border bg-background font-prose"
			data-testid="side-panel"
			aria-label="Pitanje sa strane"
		>
			<div className="flex flex-col gap-2.5 border-b border-border px-4 pt-3 pb-3">
				<div className="flex items-center justify-between">
					<span className="font-ui text-sm uppercase tracking-widest text-foreground/85">Pitanje sa strane</span>
					<button type="button" aria-label="Zatvori panel" onClick={onClose} className="cursor-pointer rounded p-1 text-muted-foreground hover:text-foreground">
						<XIcon className="size-4" />
					</button>
				</div>
				<div className="flex min-w-0 items-center gap-1.5 overflow-x-auto" data-testid="side-tabs">
					{open.map((t) => (
						<span
							key={t.id}
							className={cn(
								"flex shrink-0 items-center rounded-md border text-sm",
								t.id === state?.threadId ? "border-success/80! bg-success/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground",
							)}
						>
							<button type="button" onClick={() => side.open({ threadId: t.id, anchor: { kind: "composer" } })} className="max-w-44 cursor-pointer truncate px-3 py-1.5" data-testid="side-tab">
								{sideTopicTitle(t)}
							</button>
							<button type="button" aria-label="Zatvori temu" disabled={busy === t.id} onClick={() => void closeTopic(t.id)} className="cursor-pointer py-1.5 pr-2 text-muted-foreground hover:text-foreground">
								<XIcon className="size-3.5" />
							</button>
						</span>
					))}
					<button
						type="button"
						aria-label="Novo pitanje"
						data-testid="side-new"
						onClick={onNewTopic}
						className="shrink-0 cursor-pointer rounded-md border border-border p-2 text-muted-foreground hover:text-foreground"
					>
						<PlusIcon className="size-4" />
					</button>
				</div>
			</div>
			<p className="border-b border-border/60 px-4 py-1.5 text-xs text-muted-foreground">Nastavnik ovo ne vidi · ne ulazi u kartice ni beleške dok ne sačuvaš</p>
			<div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4" data-testid="side-thread">
				{blank && (
					<div className="text-sm text-muted-foreground">
						<p>Postavi pitanje koje nije deo lekcije — odgovor stiže ovde, a lekcija ide dalje.</p>
						<p className="mt-2">
							Savet: u glavnom polju napiši <code className="rounded bg-muted px-1">/btw pitanje</code>, ili označi tekst nastavnika i klikni „Pitaj sa strane”.
						</p>
						{!state && <p className="mt-2">Pitanja sa strane idu uz objašnjenje — mogu kad nastavnik nešto objasni.</p>}
						{closed.length > 0 && (
							<div className="mt-5">
								<p className="mb-1.5 font-ui text-xs uppercase tracking-widest">Zatvorene teme</p>
								<div className="flex flex-wrap gap-1.5">
									{closed.map((t) => (
										<button
											key={t.id}
											type="button"
											data-testid="side-closed-topic"
											disabled={busy === t.id}
											onClick={() => void reopenTopic(t.id)}
											className="cursor-pointer rounded-md border border-border px-2 py-1 text-xs text-foreground/80 hover:bg-accent"
										>
											{sideTopicTitle(t)}
										</button>
									))}
								</div>
							</div>
						)}
					</div>
				)}
				{!blank &&
					state.messages.map((m) => (
						<div key={m.id} className="mb-5 flex min-w-0 items-start gap-3">
							<span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border font-ui text-sm text-muted-foreground" aria-hidden>
								{m.role === "user" ? "V" : "N"}
							</span>
							<div className="min-w-0 flex-1">
								<p className="mb-1 font-ui text-xs uppercase tracking-widest text-muted-foreground">{m.role === "user" ? "Vi" : "Pomoćnik"}</p>
								{m.role === "user" ? (
									<div className="rounded-lg border border-border bg-white/[0.05] px-3 py-2 text-[15px] text-foreground">
										{m.quotes?.map((q, i) => (
											<p key={i} className="mb-1.5 border-l-2 border-success/60! pl-2 text-xs text-muted-foreground">„{q.length > 220 ? `${q.slice(0, 220)}…` : q}”</p>
										))}
										<span className="whitespace-pre-wrap">{m.text}</span>
									</div>
								) : m.error !== undefined ? (
									<div className="rounded-lg border border-error/40! px-3 py-2 text-sm text-error">
										{m.text && <ToolContentResponse className="lh-prose mb-1 block text-foreground/80">{m.text}</ToolContentResponse>}
										Odgovor nije uspeo: {m.error}
									</div>
								) : (
									<>
										<div className="side-answer min-w-0 rounded-lg border border-border px-3 py-2 [&_pre]:whitespace-pre-wrap! [&_pre_code]:whitespace-pre-wrap!">
											<ToolContentResponse className="lh-prose block">{m.text}</ToolContentResponse>
											{m.stopped && <p className="mt-1 font-ui text-xs text-muted-foreground">Zaustavljeno</p>}
										</div>
										{!m.pending && !m.stopped && <div className="mt-2"><SideKeepButtons chatId={chatId} threadId={state.threadId} message={m} /></div>}
									</>
								)}
							</div>
						</div>
					))}
				{!blank && state.answering && (
					<div className="mb-5 flex min-w-0 items-start gap-3" data-testid="side-answering">
						<span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border font-ui text-sm text-muted-foreground" aria-hidden>N</span>
						<div className="min-w-0 flex-1">
							<p className="mb-1 font-ui text-xs uppercase tracking-widest text-muted-foreground">Pomoćnik</p>
							{state.streamText ? (
								<div className="side-answer min-w-0 rounded-lg border border-border px-3 py-2">
									<ToolContentResponse className="lh-prose block">{state.streamText}</ToolContentResponse>
								</div>
							) : (
								<p className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">
									<BrailleSpinner label="Odgovaram" /> Odgovaram…
								</p>
							)}
						</div>
					</div>
				)}
			</div>
			<div className="border-t border-border p-3">
				{(error || state?.error) && <p className="mb-2 text-xs text-error" role="alert">{error ?? state?.error}</p>}
				{passage && (
					<p className="mb-2 flex items-start gap-2 border-l-2 border-success/60! pl-2 text-xs text-muted-foreground" data-testid="side-quote">
						<span className="min-w-0 flex-1">„{passage.text.length > 220 ? `${passage.text.slice(0, 220)}…` : passage.text}”</span>
					</p>
				)}
				<div className="flex items-end gap-2">
					<textarea
						ref={inputRef}
						value={draft}
						disabled={!state}
						onChange={(e) => {
							setDraft(e.target.value);
							if (state) side.saveDraft(state.threadId, e.target.value);
						}}
						onKeyDown={(e) => {
							if (e.key === "Escape") {
								e.preventDefault();
								e.stopPropagation();
								onClose();
								return;
							}
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								e.stopPropagation();
								void send();
							}
						}}
						rows={2}
						placeholder={blank ? "Pitaj nešto sa strane…" : "Nastavi ovu temu…"}
						data-testid="side-input"
						className="min-h-[44px] flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-[15px] text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
					/>
					{state?.answering ? (
						<button
							type="button"
							data-testid="side-stop"
							onClick={side.stop}
							className="flex h-[44px] cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-accent"
						>
							<SquareIcon className="size-3.5" /> Zaustavi
						</button>
					) : (
						<button
							type="button"
							data-testid="side-send"
							disabled={!state || !draft.trim()}
							onClick={() => void send()}
							className="h-[44px] cursor-pointer rounded-md bg-success px-3 text-sm font-medium text-white hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-50"
						>
							Pošalji
						</button>
					)}
				</div>
			</div>
		</aside>
	);
}
