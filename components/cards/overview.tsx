"use client";
/** Kartice (fork): every course's deck + the combined schedule
 *  (mockup docs/fork-plans/mockups/kartice-overview-v1.png). */
import Link from "next/link";
import { TopBar } from "@/components/top-bar";
import { useState } from "react";
import { Toggle } from "@/components/settings/controls";
import { courseName, examLabel } from "./deck-view";
import { ForecastChart, ForecastSummary } from "./forecast";
import { notifyCardsChanged, saveCardSettings, useCardsOverview } from "./use-cards";

export function CardsOverviewView() {
	const { data, error } = useCardsOverview();
	const setCourse = async (chatId: string, enabled: boolean) => {
		await fetch(`/api/chats/${encodeURIComponent(chatId)}/cards`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ op: "enabled", enabled }),
		});
		notifyCardsChanged();
	};
	const active = data?.decks.filter((d) => d.enabled) ?? [];
	const days = active.reduce<number[]>((acc, d) => acc.map((n, i) => n + (d.days[i] ?? 0)), new Array<number>(14).fill(0));
	const untilExam = active.some((d) => d.untilExam !== null) ? active.reduce((a, d) => a + (d.untilExam ?? 0), 0) : null;
	return (
		<div className="flex h-dvh min-w-0 flex-1 flex-col">
			<TopBar>
				<h1 className="min-w-0 flex-1 truncate font-title text-3xl tracking-tight">Kartice</h1>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto pb-16 font-prose">
				<div className="mx-auto w-full max-w-7xl px-8 pt-8">
					{error && !data && <p className="text-sm text-muted-foreground">Kartice ne mogu da se učitaju ({error}).</p>}
					{data && !data.globalEnabled && (
						<p className="mb-6 rounded-md border border-border px-4 py-3 text-sm text-muted-foreground">Kartice su isključene. Uključi ih dole.</p>
					)}
					{data && data.decks.length === 0 && (
						<p className="text-sm text-muted-foreground">Još nema kartica. Nastaju same od pitanja koja ti nastavnik postavi u kursu.</p>
					)}
					<div className="flex flex-col gap-4">
						{data?.decks.map((d) => {
							const on = d.enabled && data.globalEnabled;
							return (
								<div key={d.chatId} className="flex items-center gap-6 rounded-lg border border-border bg-white/[0.035] px-6 py-6" data-testid="deck-row">
									<div className="min-w-0 flex-1">
										<p className="truncate text-3xl leading-tight text-foreground">{courseName(d.title)}</p>
										<p className="mt-1.5 text-xl text-foreground/80">
											{d.due} za danas · {d.fresh} {d.fresh === 1 ? "nova" : "novih"} · {d.total} ukupno
											{d.examDate && <span className="text-amber-400"> · ispit {examLabel(d.examDate)}</span>}
										</p>
									</div>
									<Link
										href={`/cards/${encodeURIComponent(d.chatId)}`}
										className={
											on
												? "min-w-[136px] rounded-md bg-green-600 px-5 py-2.5 text-center text-xl font-medium text-white hover:bg-green-500"
												: "min-w-[136px] rounded-md border border-border px-5 py-2.5 text-center text-xl text-muted-foreground hover:text-foreground"
										}
									>
										{on ? "Ponavljaj" : "Otvori"}
									</Link>
									<span className="flex w-36 items-center gap-2 text-lg text-foreground">
										<Toggle checked={d.enabled} label={`kartice: ${d.title}`} onChange={(v) => void setCourse(d.chatId, v)} />
										{d.enabled ? "Uključeno" : "Isključeno"}
									</span>
								</div>
							);
						})}
					</div>

					{data && data.decks.length > 0 && (
						<>
							<p className="mt-10 mb-3 font-ui text-base uppercase tracking-widest text-muted-foreground">Raspored</p>
							<ForecastChart days={days} now={Date.now()} />
							<ForecastSummary days={days} untilExam={untilExam} />
						</>
					)}

					{data && (
						<div
							className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-border pt-5 font-ui text-xs uppercase tracking-widest text-muted-foreground"
							data-testid="card-settings"
						>
							<span className="flex items-center gap-2">
								<Toggle checked={data.globalEnabled} label="kartice uključene" onChange={(v) => void saveCardSettings({ ...data.settings, enabled: v })} />
								Kartice {data.globalEnabled ? "uključene" : "isključene"}
							</span>
							<NumberSetting label="Nove kartice dnevno" value={data.settings.newPerDay} onCommit={(v) => void saveCardSettings({ ...data.settings, newPerDay: Math.min(500, Math.max(0, v)) })} />
							<NumberSetting
								label="Najviše ponavljanja dnevno"
								value={data.settings.maxReviewsPerDay}
								onCommit={(v) => void saveCardSettings({ ...data.settings, maxReviewsPerDay: Math.min(5000, Math.max(1, v)) })}
							/>
							<NumberSetting
								label="Cilj pamćenja %"
								value={Math.round(data.settings.retention * 100)}
								onCommit={(v) => void saveCardSettings({ ...data.settings, retention: Math.min(97, Math.max(70, v)) / 100 })}
							/>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

function NumberSetting({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
	const [draft, setDraft] = useState<string | null>(null);
	const commit = () => {
		if (draft === null) return;
		const n = Math.round(Number(draft));
		setDraft(null);
		if (draft.trim() !== "" && Number.isFinite(n) && n !== value) onCommit(n);
	};
	return (
		<label className="flex items-center gap-2">
			{label}:
			<input
				type="number"
				value={draft ?? String(value)}
				aria-label={label}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === "Enter") commit();
					if (e.key === "Escape") setDraft(null);
				}}
				className="h-7 w-16 rounded-sm border border-border bg-background px-2 font-ui text-xs text-foreground outline-none"
			/>
		</label>
	);
}
