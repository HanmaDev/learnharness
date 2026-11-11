"use client";
/**
 * Fork (topic notes): one course's notes — the plan steps on the left, the
 * notes for each step on the right (mockup docs/fork-plans/mockups/notes-v1.png).
 * Learner-facing text is Serbian Latin.
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileTextIcon, RefreshCwIcon } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { BrailleSpinner } from "@/components/braille-spinner";
import { useLiveJson } from "@/components/live-json";
import { cn } from "@/lib/utils";
import type { NoteStepView } from "@/src/core";

export interface CourseNotesViewData {
	chatId: string;
	courseTitle: string;
	filePath: string;
	steps: NoteStepView[];
	writing: string[];
	error: string | null;
}

const ago = (iso: string | null) => {
	if (!iso) return null;
	const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
	if (min < 1) return "upravo";
	if (min < 60) return `pre ${min} min`;
	const h = Math.round(min / 60);
	if (h < 24) return `pre ${h} h`;
	return `pre ${Math.round(h / 24)} d`;
};

const DOT: Record<NoteStepView["status"], string> = {
	written: "bg-success",
	stale: "bg-muted-foreground/60",
	pending: "bg-warning",
	untaught: "bg-muted-foreground/25",
};

export function NotesView({ chatId }: { chatId: string }) {
	const { data, error, setData } = useLiveJson<CourseNotesViewData>(`/api/chats/${encodeURIComponent(chatId)}/notes`, { chatId });
	const [busy, setBusy] = useState(false);
	const [active, setActive] = useState<string | null>(null);
	const mainRef = useRef<HTMLDivElement>(null);
	const latest = useMemo(() => data?.steps.reduce<string | null>((m, s) => (s.updatedAt && (!m || s.updatedAt > m) ? s.updatedAt : m), null) ?? null, [data]);

	// Deep link: /notes/<id>#step-<nodeId> — once, when the notes first load.
	const jumped = useRef(false);
	useEffect(() => {
		if (!data || jumped.current) return;
		jumped.current = true;
		const id = decodeURIComponent(window.location.hash.replace(/^#step-/, ""));
		if (id && data.steps.some((s) => s.id === id)) {
			setActive(id);
			requestAnimationFrame(() => document.getElementById(`step-${id}`)?.scrollIntoView({ block: "start" }));
		}
	}, [data]);

	const post = async (op: "refresh" | "reveal") => {
		const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/notes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op }) });
		const json = (await res.json().catch(() => null)) as { view?: CourseNotesViewData } | null;
		if (json?.view) setData(json.view);
	};

	const go = (id: string) => {
		setActive(id);
		history.replaceState(null, "", `#step-${encodeURIComponent(id)}`);
		document.getElementById(`step-${id}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
	};

	const written = data?.steps.filter((s) => s.status === "written").length ?? 0;
	const firstWritten = data?.steps.find((s) => s.markdown)?.id ?? data?.steps[0]?.id ?? null;
	const writing = new Set(data?.writing ?? []);
	return (
		<div className="flex h-dvh min-w-0 flex-1 flex-col">
			<TopBar>
				<h1 className="min-w-0 flex-1 truncate font-title text-3xl tracking-tight" data-testid="notes-title">
					Beleške{data ? ` · ${data.courseTitle}` : ""}
				</h1>
				{data && (
					<>
						<span className="hidden shrink-0 items-center gap-2 rounded-full border border-border/80 px-3 py-1 font-ui text-xs uppercase tracking-wide text-muted-foreground lg:flex">
							{data.steps.length} koraka · <b className="font-medium text-success">{written}</b> napisano
							{latest && <> · ažurirano {ago(latest)}</>}
						</span>
						<button
							type="button"
							data-testid="notes-refresh"
							disabled={busy || writing.size > 0}
							onClick={async () => {
								setBusy(true);
								await post("refresh");
								setBusy(false);
							}}
							className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-ui text-xs uppercase tracking-wider text-foreground hover:bg-accent disabled:cursor-wait disabled:opacity-60"
						>
							{writing.size > 0 ? <BrailleSpinner label="Pišem beleške" /> : <RefreshCwIcon className="size-3.5" />}
							{writing.size > 0 ? `Pišem (${writing.size})` : "Ažuriraj beleške"}
						</button>
						<button
							type="button"
							data-testid="notes-reveal"
							title={data.filePath}
							onClick={() => void post("reveal")}
							className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-ui text-xs uppercase tracking-wider text-foreground hover:bg-accent"
						>
							<FileTextIcon className="size-3.5" /> Otvori .md
						</button>
					</>
				)}
			</TopBar>
			{error && !data && <p className="p-8 text-sm text-muted-foreground">Beleške ne mogu da se učitaju ({error}).</p>}
			{data && data.steps.length === 0 && <p className="p-8 font-prose text-base text-muted-foreground">Ovaj kurs još nema plan, pa nema ni beleški.</p>}
			{data && data.steps.length > 0 && (
				<div className="flex min-h-0 flex-1 font-prose">
					<nav className="my-4 ml-4 w-80 shrink-0 divide-y divide-border/60 overflow-y-auto rounded-lg border border-border bg-white/[0.02]" data-testid="notes-steps">
						{data.steps.map((s) => (
							<button
								key={s.id}
								type="button"
								onClick={() => go(s.id)}
								className={cn(
									"flex w-full cursor-pointer items-start gap-2.5 px-4 py-2.5 text-left text-[15px] leading-snug transition-colors hover:bg-accent",
									(active ?? firstWritten) === s.id ? "bg-accent text-foreground" : s.status === "untaught" ? "text-muted-foreground/60" : "text-foreground/85",
								)}
							>
								<span className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[s.status])} aria-hidden />
								<span className="min-w-0 flex-1">
									{s.number}. {s.title}
									{s.status === "pending" && <span className="ml-1.5 font-ui text-[11px] uppercase tracking-wider text-warning">u toku</span>}
									{writing.has(s.id) && <span className="ml-1.5 font-ui text-[11px] uppercase tracking-wider text-muted-foreground">pišem…</span>}
								</span>
							</button>
						))}
					</nav>
					<div ref={mainRef} className="m-4 min-w-0 flex-1 overflow-y-auto rounded-lg border border-border px-8 pt-4 pb-24" data-testid="notes-body">
						{data.error && <p className="mb-4 rounded-md border border-error/40! px-4 py-2 text-sm text-error">Pisanje beleški nije uspelo: {data.error}</p>}
						<div className="w-full max-w-5xl">
							{data.steps.map((s) => (
								<section key={s.id} id={`step-${s.id}`} className="scroll-mt-4 border-b border-border/60 py-6 last:border-b-0">
									<h2 className="mb-3 font-title text-3xl tracking-tight text-foreground">
										{s.number}. {s.title}
									</h2>
									{s.markdown ? (
										<ToolContentResponse className="lh-prose block">{s.markdown}</ToolContentResponse>
									) : (
										<p className="text-base text-muted-foreground">
											{s.status === "untaught"
												? s.done
													? "Označeno kao završeno, ali lekcija za ovaj korak nije sačuvana u ovom chatu — nema iz čega da se napišu beleške."
													: "Još nije obrađeno."
												: s.status === "pending"
													? "Ovaj korak je u toku — klikni „Ažuriraj beleške” da se napišu beleške."
													: writing.has(s.id)
														? "Pišem beleške…"
														: "Još nije napisano — klikni „Ažuriraj beleške”."}
										</p>
									)}
									{s.markdown && s.status === "stale" && !writing.has(s.id) && (
										<p className="mt-3 font-ui text-xs uppercase tracking-wider text-muted-foreground">Ima novog gradiva — klikni „Ažuriraj beleške” da se dopuni.</p>
									)}
									{s.extras.map((e) => (
										<div key={e.id} className="mt-5 rounded-md border border-border bg-white/[0.03] px-4 py-3">
											<p className="mb-1 font-ui text-xs uppercase tracking-widest text-muted-foreground">Dodatno · pitanje sa strane</p>
											<ToolContentResponse className="lh-prose block">{e.markdown}</ToolContentResponse>
										</div>
									))}
								</section>
							))}
							<p className="mt-6 font-ui text-xs text-muted-foreground/70">
								Fajl: {data.filePath} ·{" "}
								<Link href={`/chat/${encodeURIComponent(chatId)}`} className="underline-offset-4 hover:text-foreground hover:underline">
									nazad na lekciju
								</Link>
							</p>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
