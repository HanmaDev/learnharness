"use client";
/**
 * Fork (placement): how a new teaching course starts — Brza provera (the
 * adaptive probe), Test znanja (a full written test over the syllabus) or
 * Od nule (no testing). The last choice is remembered on this device.
 */
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { START_MODE_LABELS, START_MODES, type StartMode } from "@/src/core";

const KEY = "lh:start-mode";

export function useStartMode(): [StartMode, (m: StartMode) => void] {
	const [mode, setMode] = useState<StartMode>("brza");
	useEffect(() => {
		try {
			const v = window.localStorage.getItem(KEY);
			if (v === "brza" || v === "test" || v === "nula") setMode(v);
		} catch {
			/* storage blocked: default */
		}
	}, []);
	return [
		mode,
		(m) => {
			setMode(m);
			try {
				window.localStorage.setItem(KEY, m);
			} catch {
				/* fine */
			}
		},
	];
}

export function StartModeSelect({ value, onChange }: { value: StartMode; onChange: (m: StartMode) => void }) {
	return (
		<div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-background p-0.5" data-testid="start-mode" title="Kako počinje kurs">
			{START_MODES.map((m) => (
				<button
					key={m}
					type="button"
					data-testid={`start-mode-${m}`}
					onClick={() => onChange(m)}
					className={cn(
						"rounded-sm px-2 py-0.5 text-[11px] uppercase tracking-wider transition-colors",
						value === m ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
					)}
				>
					{START_MODE_LABELS[m]}
				</button>
			))}
		</div>
	);
}
