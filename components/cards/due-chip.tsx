"use client";
/** Kartice (fork): "12 za danas" in the course header — opens the deck. */
import Link from "next/link";
import { LayersIcon } from "lucide-react";
import { useCardsOverview } from "./use-cards";

export function CardsDueChip({ chatId }: { chatId: string }) {
	const { data } = useCardsOverview();
	const deck = data?.globalEnabled ? data.decks.find((d) => d.chatId === chatId && d.enabled) : undefined;
	const n = deck ? deck.due + deck.fresh : 0;
	if (!deck || n === 0) return null;
	return (
		<Link
			href={`/cards/${encodeURIComponent(chatId)}`}
			data-testid="cards-due-chip"
			title="Kartice za ponavljanje"
			className="flex shrink-0 items-center gap-1.5 rounded-full border border-border/80 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:border-border hover:text-foreground"
		>
			<LayersIcon className="size-3.5 text-amber-400" aria-hidden />
			<span className="text-amber-400">{n}</span> za danas
		</Link>
	);
}
