/**
 * Serbian Cyrillic → Latin (fork, 2026-11-08). The learner reads Latin only;
 * older records hold Cyrillic plan titles and questions, so the card views
 * show them transliterated. Serbian's mapping is one-to-one (Љ/Њ/Џ are two
 * Latin letters: "Lj" in a word, "LJ" when the next letter is upper case).
 */
const MAP: Record<string, string> = {
	а: "a", б: "b", в: "v", г: "g", д: "d", ђ: "đ", е: "e", ж: "ž", з: "z", и: "i", ј: "j", к: "k", л: "l", љ: "lj", м: "m",
	н: "n", њ: "nj", о: "o", п: "p", р: "r", с: "s", т: "t", ћ: "ć", у: "u", ф: "f", х: "h", ц: "c", ч: "č", џ: "dž", ш: "š",
};

const isUpper = (ch: string | undefined) => !!ch && ch !== ch.toLowerCase();

export function toSerbianLatin(text: string): string {
	if (!/[Ѐ-ӿ]/.test(text)) return text;
	let out = "";
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]!;
		const lower = ch.toLowerCase();
		const latin = MAP[lower];
		if (latin === undefined) {
			out += ch;
			continue;
		}
		if (ch === lower) out += latin;
		else if (latin.length === 1 || isUpper(text[i + 1]) || isUpper(text[i - 1])) out += latin.toUpperCase();
		else out += latin[0]!.toUpperCase() + latin.slice(1);
	}
	return out;
}
