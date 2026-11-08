import { notFound } from "next/navigation";
import { DeckView, type DeckTab } from "@/components/cards/deck-view";
import { getChat } from "@/src/server";

export const dynamic = "force-dynamic";

/** Fork (Kartice): one course's deck — /cards/<chatId>?tab=review|all|schedule. */
export default async function DeckPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
	const [{ id }, { tab }] = await Promise.all([params, searchParams]);
	if (!getChat(id)) notFound();
	const initialTab: DeckTab = tab === "all" || tab === "schedule" || tab === "mistakes" ? tab : "review";
	return <DeckView key={id} chatId={id} initialTab={initialTab} />;
}
