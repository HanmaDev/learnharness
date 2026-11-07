"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { DICTATION_LANGUAGES, keytermsSupported, MAX_KEYTERMS, normalizeKeyterms, type DictationLanguage } from "@/src/core";
import { cn } from "@/lib/utils";
import { MenuShell } from "@/components/menu-shell";
import { Hint } from "@/components/ui/hint";
import { SettingsMenuTrigger, SettingsRow } from "@/components/settings/controls";
import { SearchMenuList } from "@/components/settings/search-menu-list";
import { useDictationActive } from "@/components/dictation-state";
import { useDictationLanguage } from "@/components/dictation-preference";

type LanguagePreference = ReturnType<typeof useDictationLanguage>;

export function DictationLanguageSetting() {
	const preference = useDictationLanguage();
	const active = useDictationActive();
	return <SettingsRow label="Language" testid="row-dictation-language" dimmed={active}>
		<DictationLanguagePicker preference={preference} disabled={active} />
	</SettingsRow>;
}

function DictationLanguagePicker({ preference, disabled }: {
	preference: LanguagePreference;
	disabled: boolean;
}) {
	const { language, saving, error, load, save } = preference;
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const label = DICTATION_LANGUAGES.find((item) => item.code === language)?.label ?? "—";

	useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Element;
			if (target instanceof Element && target.closest('[data-testid="dictation-language-menu"]')) return;
			if (!triggerRef.current?.contains(target)) setOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [open]);
	const closeOnEscape = (event: ReactKeyboardEvent) => {
		if (event.key !== "Escape") return;
		event.preventDefault();
		event.stopPropagation();
		setOpen(false);
		triggerRef.current?.focus();
	};
	const pick = async (code: DictationLanguage) => {
		if (disabled || saving || language === undefined) return;
		if (await save(code)) {
			setOpen(false);
			triggerRef.current?.focus();
		}
	};

	return <>
		<Hint label={error ?? `Dictation language: ${label}`} side="top">
			<SettingsMenuTrigger
				ref={triggerRef}
				value={label}
				data-testid="dictation-language"
				aria-label={`Dictation language: ${label}`}
				aria-expanded={open && !disabled}
				disabled={disabled || saving}
				onKeyDown={(event) => { if (open) closeOnEscape(event); }}
				onClick={() => {
					setOpen((value) => !value);
					if (language === undefined) void load().catch(() => {});
				}}
				className="min-w-20 max-w-[65%]"
			/>
		</Hint>
		{open && !disabled && <MenuShell
			anchorRef={triggerRef}
			testid="dictation-language-menu"
			preferredSide="down"
			menuClass="flex w-72 max-w-[calc(100vw-1rem)] flex-col rounded-xl border border-border bg-card p-2 text-xs shadow-xl"
		>
			<div onKeyDown={(event) => {
				closeOnEscape(event);
				if (event.key === "Enter") {
					// Empty search results must not submit the composer, but a
					// focused option button still needs Enter's native click.
					if (event.target instanceof HTMLInputElement) event.preventDefault();
					event.stopPropagation();
				}
			}}>
				{error && <div role="alert" className="mb-1.5 text-destructive">{error}</div>}
				<SearchMenuList
					items={DICTATION_LANGUAGES}
					itemKey={(item) => item.code}
					searchTerms={(item) => [item.code, item.label]}
					isSelected={(item) => item.code === language}
					onPick={(item) => { void pick(item.code); }}
					disabled={saving || language === undefined}
					searchTestid="dictation-language-search"
					listTestid="dictation-language-list"
					optionTestid={(item) => `dictation-language-${item.code}`}
					ariaLabel="Search dictation languages"
					placeholder="Search languages…"
					empty="No languages match."
					renderItem={(item) => <span className="text-card-foreground">{item.label}</span>}
				/>
			</div>
		</MenuShell>}
	</>;
}

/** Fork: the user's own dictation vocabulary (Deepgram keyterms) — words
 *  Deepgram should expect, sent on every run ahead of the lesson's
 *  automatic terms. One word or short phrase per line (commas also split). */
export function DictationWordsSetting() {
	const { keyterms, saving, error, saveKeyterms, language } = useDictationLanguage();
	const active = useDictationActive();
	const saved = keyterms.join("\n");
	const [draft, setDraft] = useState(saved);
	const [dirty, setDirty] = useState(false);
	useEffect(() => { if (!dirty) setDraft(saved); }, [saved, dirty]);
	const parsed = normalizeKeyterms(draft.split(/[\n,]+/));
	const englishOnly = language !== undefined && !keytermsSupported(language);
	return <div data-testid="row-dictation-words" className={cn("flex flex-col gap-1.5 py-1", active && "opacity-40")}>
		<span className="min-w-0">
			<span className="block font-prose text-(length:--lh-prose-size)">Dictation words</span>
			<span className="block text-xs text-muted-foreground/70">
				Words Deepgram should expect (one per line), e.g. SELECT, colspan, tbody. Lesson terms are added automatically.
				{englishOnly && " Word hints only apply to English and Multilingual."}
			</span>
		</span>
		<textarea
			data-testid="dictation-words"
			aria-label="Dictation words"
			value={draft}
			disabled={active || saving}
			rows={4}
			onChange={(event) => { setDraft(event.target.value); setDirty(true); }}
			className="w-full resize-y rounded-md border border-border bg-transparent px-2 py-1.5 font-mono text-xs outline-none focus:border-primary/50"
			placeholder={"SELECT\nGROUP BY\ncolspan"}
		/>
		<div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
			<span>{error ?? `${parsed.length} / ${MAX_KEYTERMS} words`}</span>
			<button
				type="button"
				data-testid="dictation-words-save"
				disabled={!dirty || saving || active}
				onClick={async () => { if (await saveKeyterms(parsed)) setDirty(false); }}
				className="rounded-md border border-border px-2 py-1 font-medium transition-colors enabled:hover:bg-accent disabled:opacity-50"
			>
				{saving ? "Saving…" : "Save words"}
			</button>
		</div>
	</div>;
}
