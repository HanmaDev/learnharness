"use client";

import { useSyncExternalStore } from "react";

// The keyboard chain needs a synchronous answer; settings also subscribe
// so the language control locks from connecting until cleanup completes.
let active = false;
const listeners = new Set<() => void>();

export function isDictationActive(): boolean { return active; }

export function setDictationActive(next: boolean): void {
	if (active === next) return;
	active = next;
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => { listeners.delete(listener); };
}

export function useDictationActive(): boolean {
	return useSyncExternalStore(subscribe, isDictationActive, () => false);
}

// ─── the live (greyed) transcript — fork ─────────────────────────────────────
// What Deepgram has heard but not yet committed, and WHICH input shows it:
// the owner is the target's append function (a question field's claim) or
// COMPOSER_GHOST for the page composer. Inputs read it with
// useDictationGhost(owner) and render it after their text (PathInput's
// ghostText — a CSS pseudo-element, never part of the value).
export const COMPOSER_GHOST: unique symbol = Symbol("composer");
let ghost: { owner: unknown; text: string } = { owner: null, text: "" };
const ghostListeners = new Set<() => void>();

export function setDictationGhost(owner: unknown, text: string): void {
	if (ghost.owner === owner && ghost.text === text) return;
	ghost = { owner: text ? owner : null, text };
	for (const listener of ghostListeners) listener();
}

export function clearDictationGhost(): void {
	setDictationGhost(null, "");
}

function subscribeGhost(listener: () => void): () => void {
	ghostListeners.add(listener);
	return () => { ghostListeners.delete(listener); };
}

export function useDictationGhost(owner: unknown): string {
	return useSyncExternalStore(subscribeGhost, () => (ghost.owner === owner ? ghost.text : ""), () => "");
}
