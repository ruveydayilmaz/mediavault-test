/**
 * Best-effort parse of a date string into an ISO date (YYYY-MM-DD). Returns
 * null if unparseable. Shared by the tvtime/* importer modules — kept here
 * rather than duplicated since it's genuinely just a date-parsing utility,
 * not tied to any particular import category's shape.
 */
export function parseFlexibleDate(raw: string | null): string | null {
	if (!raw) return null;
	const parsed = new Date(raw);
	if (isNaN(parsed.getTime())) return null;
	return parsed.toISOString().slice(0, 10);
}

/**
 * Normalizes a title for matching/searching: unifies smart quotes to plain
 * ones, drops punctuation TMDB and TV Time disagree on (colons, dashes,
 * em/en dashes), collapses whitespace, and lowercases. Two titles that
 * differ only in this kind of formatting noise (TV Time's "Spider-Man:
 * Homecoming" vs. however a search index tokenizes it) normalize to the
 * same string.
 */
export function normalizeTitle(title: string): string {
	return title
		.normalize("NFKD")
		.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
		.replace(/[\u201C\u201D\u201E\u201F]/g, '"')
		.replace(/['"]/g, "")
		.replace(/&/g, " and ")
		.replace(/[:\-–—_,.!?()[\]{}]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

/** If `title` has a colon/dash-separated subtitle ("Spider-Man: Homecoming"), returns the part before it ("Spider-Man"). Null if there's no such split. */
export function stripSubtitle(title: string): string | null {
	const match = title.match(/^(.+?)\s*[:\-–—]\s+.+$/);
	return match ? match[1].trim() : null;
}

/**
 * ISO-3166-1 alpha-2 country codes TV Time/GDPR exports commonly embed as a
 * parenthesized disambiguator (`"Life on Mars (KR)"`). Not exhaustive of
 * every country on Earth, but covers the codes that actually show up in
 * practice (production countries for film/TV) — good enough to positively
 * classify a bare 2-3-letter uppercase token as "this is a country code" and
 * not, say, an acronym that happens to be part of the title.
 */
const KNOWN_COUNTRY_CODES = new Set([
	"US", "UK", "GB", "KR", "JP", "CN", "TW", "HK", "IN", "FR", "DE", "ES", "IT",
	"BR", "MX", "CA", "AU", "NZ", "TH", "RU", "SE", "NO", "DK", "FI", "NL", "BE",
	"PL", "TR", "PH", "ID", "VN", "AR", "PT", "GR", "CZ", "IE", "AT", "CH", "ZA",
	"EG", "SA", "AE", "IL", "SG", "MY", "CO", "CL", "PE", "IS", "HU", "RO", "UA",
]);

/** Full language names (as they appear written out in parentheses, e.g. "(Korean)") mapped to an ISO 639-1 code, used as a secondary metadata hint alongside country. */
const KNOWN_LANGUAGE_NAMES: Record<string, string> = {
	english: "en", korean: "ko", japanese: "ja", mandarin: "zh", cantonese: "zh",
	chinese: "zh", spanish: "es", french: "fr", german: "de", italian: "it",
	portuguese: "pt", russian: "ru", thai: "th", hindi: "hi", arabic: "ar",
	turkish: "tr", dutch: "nl", swedish: "sv", norwegian: "no", danish: "da",
	polish: "pl", vietnamese: "vi", indonesian: "id", filipino: "tl", tagalog: "tl",
	hebrew: "he", greek: "el", finnish: "fi", czech: "cs", hungarian: "hu",
	romanian: "ro", ukrainian: "uk",
};

/** Everything a title's trailing parenthesized group(s) can tell us before searching TMDB. */
export interface TitleMetadata {
	/** The title with every recognized/classified trailing parenthetical stripped off. */
	title: string;
	year: number | null;
	/** ISO-3166-1 alpha-2 country code, upper-cased, if a parenthetical looked like one (e.g. "(KR)"). */
	country: string | null;
	/** ISO 639-1 language code, if a parenthetical spelled out a recognized language name (e.g. "(Korean)"). */
	language: string | null;
	/**
	 * A parenthetical that didn't classify as a year, country, or language —
	 * e.g. "(First Sequence)", "(Nanatsu no Taizai)" — kept as a probable
	 * alternate/original title, since TV Time uses this pattern both for
	 * literal alternate titles and for disambiguating a subtitle. Fed back
	 * into matching as an extra query/comparison candidate rather than
	 * discarded.
	 */
	alternateTitle: string | null;
}

/**
 * Extracts every trailing `(...)` group from an imported title and classifies
 * each one as a release year, a country code, a language name, or (when none
 * of those apply) a probable alternate/original title — then returns the
 * cleaned base title alongside whatever hints were found. Handles multiple
 * trailing groups (`"Ashes to Crown (2026) (KR)"`) by peeling them off the
 * end one at a time; stops as soon as a `(...)` group doesn't look like
 * metadata, since at that point it's more likely part of the title itself
 * (e.g. "The Human Centipede (First Sequence)" — a single group, kept as an
 * alternate-title hint rather than treated as noise).
 */
export function extractTitleMetadata(rawTitle: string): TitleMetadata {
	let title = rawTitle.trim();
	let year: number | null = null;
	let country: string | null = null;
	let language: string | null = null;
	let alternateTitle: string | null = null;

	// Peel off trailing "(...)" groups one at a time, classifying each. Cap
	// the number of groups considered — real titles never have more than a
	// couple of trailing disambiguators, and this guards against pathological
	// input looping forever.
	for (let i = 0; i < 4; i++) {
		const match = title.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
		if (!match) break;
		const [, rest, raw] = match;
		const content = raw.trim();

		if (/^\d{4}$/.test(content)) {
			const asNum = Number(content);
			if (asNum >= 1900 && asNum <= 2100 && year === null) {
				year = asNum;
				title = rest.trim();
				continue;
			}
		}

		if (/^[A-Za-z]{2,3}$/.test(content) && KNOWN_COUNTRY_CODES.has(content.toUpperCase()) && country === null) {
			country = content.toUpperCase();
			title = rest.trim();
			continue;
		}

		const languageCode = KNOWN_LANGUAGE_NAMES[content.toLowerCase()];
		if (languageCode && language === null) {
			language = languageCode;
			title = rest.trim();
			continue;
		}

		// Doesn't classify as year/country/language — treat as a probable
		// alternate title and stop; only keep the first (innermost-to-last)
		// unclassified group so we don't chain unrelated parentheticals.
		if (alternateTitle === null) {
			alternateTitle = content;
			title = rest.trim();
		}
		break;
	}

	return { title: title.trim(), year, country, language, alternateTitle };
}

/** Plain Levenshtein edit distance — small inputs (movie/show titles), so the O(n*m) table is negligible. */
function levenshteinDistance(a: string, b: string): number {
	if (a === b) return 0;
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;

	let prevRow = Array.from({ length: b.length + 1 }, (_, j) => j);

	for (let i = 1; i <= a.length; i++) {
		const currRow = [i];
		for (let j = 1; j <= b.length; j++) {
			currRow[j] =
				a[i - 1] === b[j - 1]
					? prevRow[j - 1]
					: 1 + Math.min(prevRow[j - 1], prevRow[j], currRow[j - 1]);
		}
		prevRow = currRow;
	}

	return prevRow[b.length];
}

/**
 * Normalized title similarity, 0 (nothing alike) to 1 (identical once
 * normalized). Used to rank TMDB search candidates against an imported
 * title when no exact match exists.
 */
export function titleSimilarity(a: string, b: string): number {
	const na = normalizeTitle(a);
	const nb = normalizeTitle(b);
	if (na === nb) return 1;

	const maxLen = Math.max(na.length, nb.length);
	if (maxLen === 0) return 1;

	return 1 - levenshteinDistance(na, nb) / maxLen;
}
