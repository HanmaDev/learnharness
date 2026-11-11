"use client";
/**
 * Fork (mistake log): the Greške tab — every wrong answer with its analysis
 * (error type, what went wrong, the correct version, the rule), newest first.
 * Open ones on top; a later right answer on the same step resolves one.
 */
import Link from "next/link";
import { useState } from "react";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { BrailleSpinner } from "@/components/braille-spinner";
import { useLiveJson } from "@/components/live-json";
import { cn } from "@/lib/utils";
import { MISTAKE_TYPE_LABELS, type MistakeView } from "@/src/core";

interface MistakesData {
	chatId: string;
	mistakes: MistakeView[];
	analysing: boolean;
}

export function MistakesTab({ chatId }: { chatId: string }) {
	const { data, setData } = useLiveJson<MistakesData>(`/api/chats/${encodeURIComponent(chatId)}/mistakes`, { chatId, debounceMs: 800 });
	const [show, setShow] = useState<"open" | "all">("open");
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const act = async (body: object, key: string) => {
		if (busy) return;
		setBusy(key);
		const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/mistakes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
		const json = (await res?.json().catch(() => null)) as (MistakesData & { error?: string }) | null;
		if (json?.mistakes) setData(json);
		setError(res?.ok ? null : (json?.error ?? "Nije uspelo."));
		setBusy(null);
	};
	if (!data) return null;
	const open = data.mistakes.filter((m) => !m.resolved);
	const rows = show === "open" ? open : data.mistakes;
	const failed = data.mistakes.some((m) => m.failed);
	return (
		<div className="mt-6" data-testid="mistakes-tab">
			<div className="flex flex-wrap items-center gap-3">
				{(["open", "all"] as const).map((id) => (
					<button
						key={id}
						type="button"
						onClick={() => setShow(id)}
						className={cn(
							"h-10 cursor-pointer rounded-md border px-3 font-ui text-sm uppercase tracking-wider",
							show === id ? "border-success! text-success" : "border-border text-muted-foreground hover:text-foreground",
						)}
					>
						{id === "open" ? "Otvorene" : "Sve"} <b className="ml-1 font-medium text-warning">{id === "open" ? open.length : data.mistakes.length}</b>
					</button>
				))}
				{data.analysing && (
					<span className="flex items-center gap-2 text-sm text-muted-foreground">
						<BrailleSpinner label="Analiziram greške" /> Analiziram greške…
					</span>
				)}
				{failed && !data.analysing && (
					<button type="button" onClick={() => void act({ op: "analyse" }, "analyse")} className="h-10 cursor-pointer rounded-md border border-border px-3 font-ui text-sm uppercase tracking-wider text-foreground hover:bg-accent">
						Ponovi analizu
					</button>
				)}
			</div>

			{error && <p className="mt-3 text-sm text-error">{error}</p>}
			{rows.length === 0 && (
				<p className="mt-8 text-base text-muted-foreground">{show === "open" ? "Nema otvorenih grešaka." : "Još nema grešaka u ovom kursu."}</p>
			)}
			<div className="mt-4 flex flex-col gap-4">
				{rows.map((m) => (
					<article key={m.callId} className={cn("rounded-lg border border-border bg-white/[0.035] px-6 py-5", m.resolved && "opacity-60")} data-testid="mistake">
						<div className="flex flex-wrap items-center gap-2 font-ui text-xs uppercase tracking-widest text-muted-foreground">
							{m.nodeTitle && (
								<Link href={`/notes/${encodeURIComponent(chatId)}#step-${encodeURIComponent(m.nodeId ?? "")}`} className="underline-offset-4 hover:text-foreground hover:underline">
									{m.nodeTitle}
								</Link>
							)}
							{m.analysis && <span className="rounded bg-error/15 px-1.5 py-0.5 text-error">{MISTAKE_TYPE_LABELS[m.analysis.type]}</span>}
							{m.resolved && <span className="rounded bg-success/15 px-1.5 py-0.5 text-success">{m.resolvedByLaterAnswer ? "Rešeno — kasnije tačno" : "Rešeno"}</span>}
							<span className="ml-auto normal-case tracking-normal">{m.at ? new Date(m.at).toLocaleDateString("sr-Latn") : ""}</span>
						</div>
						<ToolContentResponse className="lh-prose mt-2 block text-lg">{m.question}</ToolContentResponse>
						{m.analysis ? (
							<dl className="mt-3 grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2 text-base">
								<dt className="font-ui text-xs uppercase tracking-widest text-muted-foreground">Šta nije u redu</dt>
								<dd className="min-w-0 text-foreground/90"><ToolContentResponse className="lh-prose block">{m.analysis.whatWentWrong}</ToolContentResponse></dd>
								<dt className="font-ui text-xs uppercase tracking-widest text-muted-foreground">Tačno</dt>
								<dd className="min-w-0 text-success"><ToolContentResponse className="lh-prose block">{m.analysis.correctVersion}</ToolContentResponse></dd>
								<dt className="font-ui text-xs uppercase tracking-widest text-muted-foreground">Pravilo</dt>
								<dd className="min-w-0 font-semibold text-foreground"><ToolContentResponse className="lh-prose block">{m.analysis.rule}</ToolContentResponse></dd>
							</dl>
						) : (
							<p className="mt-3 text-sm text-muted-foreground">{m.failed ? "Analiza nije uspela — klikni „Ponovi analizu”." : "Čeka analizu…"}</p>
						)}
						<div className="mt-4 flex gap-2">
							<button
								type="button"
								disabled={!m.analysis || !!m.cardId || busy === `card:${m.callId}`}
								onClick={() => void act({ op: "make-card", callId: m.callId }, `card:${m.callId}`)}
								className="cursor-pointer rounded-md border border-border px-3 py-1.5 font-ui text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-60"
							>
								{m.cardId ? "Kartica napravljena" : "Napravi karticu"}
							</button>
							<button
								type="button"
								disabled={busy === `res:${m.callId}`}
								onClick={() => void act({ op: m.resolved ? "reopen" : "resolve", callId: m.callId }, `res:${m.callId}`)}
								className="cursor-pointer rounded-md border border-border px-3 py-1.5 font-ui text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground"
							>
								{m.resolved ? "Vrati u otvorene" : "Označi kao rešeno"}
							</button>
						</div>
					</article>
				))}
			</div>
		</div>
	);
}
