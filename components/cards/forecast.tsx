"use client";
/** Kartice (fork): the due-load bar chart (today amber, later days gray). */

export function forecastSummary(days: readonly number[], untilExam: number | null): string {
	const week = days.slice(0, 7).reduce((a, b) => a + b, 0);
	const parts = [`Danas ${days[0] ?? 0}`, `Sutra ${days[1] ?? 0}`, `Ove nedelje ${week}`];
	if (untilExam !== null) parts.push(`Do ispita ${untilExam} ponavljanja`);
	return parts.join(" · ");
}

export function ForecastChart({ days, now }: { days: readonly number[]; now: number }) {
	const max = Math.max(1, ...days);
	const start = new Date(now);
	return (
		<div className="rounded-lg border border-border bg-white/[0.035] px-6 pt-6 pb-3" data-testid="forecast-chart">
			<div className="flex h-40 items-end gap-3 border-b border-border/70">
				{days.map((n, i) => (
					<div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${n}`}>
						{n > 0 && <span className="font-ui text-[10px] text-muted-foreground">{n}</span>}
						<div
							className={i === 0 ? "w-full rounded-t-sm bg-amber-500" : "w-full rounded-t-sm bg-muted-foreground/40"}
							style={{ height: `${n === 0 ? 0 : Math.max(4, (n / max) * 100)}%` }}
						/>
					</div>
				))}
			</div>
			<div className="mt-2 flex gap-3">
				{days.map((_, i) => {
					const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
					return (
						<span key={i} className="flex-1 text-center font-ui text-base text-muted-foreground">
							{d.getDate()}
						</span>
					);
				})}
			</div>
		</div>
	);
}

/** The one-line load summary, "Danas" in amber. */
export function ForecastSummary({ days, untilExam }: { days: readonly number[]; untilExam: number | null }) {
	const [today, ...rest] = forecastSummary(days, untilExam).split(" · ");
	return (
		<p className="mt-5 text-xl" data-testid="forecast-summary">
			<span className="font-semibold text-amber-400">{today}</span>
			{rest.map((r) => ` · ${r}`).join("")}
		</p>
	);
}
