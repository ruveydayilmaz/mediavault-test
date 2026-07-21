import type { TMDBService } from "../../api/tmdb";
import { TMDBSearchResult } from "../../types/tmdb";
import { normalizeTitle, stripSubtitle, titleSimilarity } from "./normalize";

/** The minimal info needed to search/rank TMDB candidates — kept independent of any specific importer's internal types. */
export interface TitleLookup {
	kind: "movie" | "tv";
	title: string;
	year: number | null;
	originalTitle?: string | null;
	releaseDate?: string | null;
	runtimeSeconds?: number | null;
	country?: string | null;
	/** ISO 639-1 language code hint (e.g. from a "(Korean)" parenthetical) — a secondary tiebreaker alongside country. */
	language?: string | null;
}

export type MatchTier = "exact" | "year" | "fuzzy" | "unmatched";

export interface MatchResult {
	candidate: TMDBSearchResult | null;
	tier: MatchTier;
	/** 0-1 confidence score behind the tier assignment — kept for logging/debugging, not shown verbatim to the user. */
	score: number;
	/** Every candidate considered and passed over, best-first — surfaced in the unmatched/ambiguous report so a person can see what almost matched. */
	rejected: TMDBSearchResult[];
	/** Every query string actually sent to TMDB, in order — logged for debugging match failures. */
	queriesTried: string[];
}

const STAR_TIERS: Record<MatchTier, string> = {
	exact: "★★★★★",
	year: "★★★★☆",
	fuzzy: "★★★☆☆",
	unmatched: "☆☆☆☆☆",
};

export function tierStars(tier: MatchTier): string {
	return STAR_TIERS[tier];
}

function scoreCandidate(lookup: TitleLookup, candidate: TMDBSearchResult, comparisonTitles: string[]): number {
	let titleSim = 0;
	for (const t of comparisonTitles) {
		titleSim = Math.max(
			titleSim,
			titleSimilarity(t, candidate.title),
			candidate.originalTitle ? titleSimilarity(t, candidate.originalTitle) : 0
		);
	}

	let yearScore = 0.5; // neutral — lookup has no year to compare against
	if (lookup.year !== null) {
		if (candidate.year === null) {
			yearScore = 0.4;
		} else {
			const diff = Math.abs(lookup.year - candidate.year);
			yearScore = diff === 0 ? 1 : diff === 1 ? 0.7 : diff <= 3 ? 0.3 : 0;
		}
	}

	// Country/language hints (extracted from parenthesized suffixes like
	// "(KR)" or "(Korean)") are a strong disambiguator for titles that are
	// otherwise identical across regions/remakes (e.g. "Chimera" the 1990s
	// US movie vs. a same-named Korean series) — but neutral (no signal
	// either way) when nothing was extracted, so titles without any
	// parenthetical hint score exactly as before.
	let regionScore = 0.5;
	let regionWeight = 0;
	if (lookup.country) {
		regionWeight = 0.15;
		regionScore = candidate.country ? (candidate.country.toUpperCase() === lookup.country.toUpperCase() ? 1 : 0.15) : 0.5;
	} else if (lookup.language) {
		regionWeight = 0.1;
		regionScore = candidate.language ? (candidate.language.toLowerCase() === lookup.language.toLowerCase() ? 1 : 0.2) : 0.5;
	}

	const titleWeight = 0.75 - regionWeight * 0.5;
	const yearWeight = 0.25 - regionWeight * 0.5;
	return titleSim * titleWeight + yearScore * yearWeight + regionScore * regionWeight;
}

/**
 * Runs every matching strategy in turn — exact title, normalized title,
 * subtitle-stripped title — pooling every candidate TMDB returns across all
 * of them before ranking. This is the key difference from a single search:
 * a title that returns nothing (or the wrong thing) on TMDB's literal
 * tokenization often matches cleanly once punctuation is normalized, or
 * once a "Movie: Subtitle" title is tried as just "Movie".
 */
async function gatherCandidates(
	tmdb: TMDBService,
	lookup: TitleLookup
): Promise<{ candidates: TMDBSearchResult[]; queriesTried: string[]; comparisonTitles: string[] }> {
	const searchFn = lookup.kind === "movie" ? tmdb.searchMovies.bind(tmdb) : tmdb.searchShows.bind(tmdb);
	const tried = new Set<string>();
	const queriesTried: string[] = [];
	const pool = new Map<number, TMDBSearchResult>();

	async function tryQuery(query: string, year: number | null): Promise<void> {
		const trimmed = query.trim();
		const dedupeKey = `${trimmed.toLowerCase()}::${year ?? ""}`;
		if (!trimmed || tried.has(dedupeKey)) return;
		tried.add(dedupeKey);
		queriesTried.push(year !== null ? `${trimmed} (${year})` : trimmed);

		try {
			const result = await searchFn(trimmed, 1, year);
			for (const item of result.items) pool.set(item.tmdbId, item);
		} catch {
			// This query variant failed (network hiccup, rate limit) — other
			// variants below still get a chance; the whole title is only
			// unmatched if every strategy comes up empty.
		}
	}

	const normalized = normalizeTitle(lookup.title);
	const stripped = stripSubtitle(lookup.title);
	const originalTitle = lookup.originalTitle?.trim() ?? "";
	const comparisonTitles = [lookup.title, normalized, ...(stripped ? [stripped] : []), ...(originalTitle ? [originalTitle] : [])];

	/** True once the pool has exactly one candidate whose title cleanly matches and whose year (if we have one to compare) agrees — no ambiguity left to resolve, so further query variants would just cost requests for no benefit. */
	function alreadyConfident(): boolean {
		if (pool.size !== 1) return false;
		const [only] = pool.values();
		const norm = normalizeTitle(only.title);
		const normOriginal = only.originalTitle ? normalizeTitle(only.originalTitle) : null;
		const titleOk = comparisonTitles.some((t) => normalizeTitle(t) === norm || normalizeTitle(t) === normOriginal);
		const yearOk = lookup.year === null || only.year === null || only.year === lookup.year;
		return titleOk && yearOk;
	}

	// 1. Exact title, year-scoped (TMDB's own year filter is far more
	//    precise than any client-side re-ranking).
	if (lookup.year !== null) await tryQuery(lookup.title, lookup.year);
	// 2. Exact title, unscoped — catches cases where the imported year is
	//    itself wrong (a common TV Time export quirk) or TMDB's year field
	//    disagrees (region cut, re-release, etc.). Skipped once stage 1
	//    alone already produced an unambiguous exact hit.
	if (!alreadyConfident()) await tryQuery(lookup.title, null);
	// 3. Normalized title (smart quotes / punctuation stripped), both scoped and unscoped.
	if (!alreadyConfident() && normalized !== lookup.title.trim().toLowerCase()) {
		if (lookup.year !== null) await tryQuery(normalized, lookup.year);
		if (!alreadyConfident()) await tryQuery(normalized, null);
	}
	// 4. Subtitle stripped ("Movie: Subtitle" -> "Movie") — only really
	//    fires once the exact and normalized queries above have failed to
	//    find anything usable, but cheap to always include in the pool.
	if (stripped && !alreadyConfident()) {
		if (lookup.year !== null) await tryQuery(stripped, lookup.year);
		if (!alreadyConfident()) await tryQuery(stripped, null);
	}
	// Original/localized title is often the only bridge for anime, translated
	// titles, and regional movie releases in TV Time's GDPR export.
	if (originalTitle && !alreadyConfident()) {
		if (lookup.year !== null) await tryQuery(originalTitle, lookup.year);
		if (!alreadyConfident()) await tryQuery(originalTitle, null);
	}

	return { candidates: [...pool.values()], queriesTried, comparisonTitles };
}

/**
 * Ranks every candidate gathered across all query variants, and assigns a
 * confidence tier. Only returns "unmatched" once every strategy has failed
 * to produce anything scoring above the fuzzy-match floor.
 */
export async function findBestMatch(tmdb: TMDBService, lookup: TitleLookup): Promise<MatchResult> {
	const { candidates, queriesTried, comparisonTitles } = await gatherCandidates(tmdb, lookup);

	if (candidates.length === 0) {
		return { candidate: null, tier: "unmatched", score: 0, rejected: [], queriesTried };
	}

	const ranked = candidates
		.map((c) => ({ candidate: c, score: scoreCandidate(lookup, c, comparisonTitles) }))
		.sort((a, b) => b.score - a.score);

	const [best, ...rest] = ranked;
	const rejected = rest.map((r) => r.candidate);

	const normComparisons = comparisonTitles.map(normalizeTitle);
	const normCandidateTitles = [normalizeTitle(best.candidate.title), ...(best.candidate.originalTitle ? [normalizeTitle(best.candidate.originalTitle)] : [])];
	const exactTitle = normCandidateTitles.some((ct) => normComparisons.includes(ct));
	const yearMatches = lookup.year === null || best.candidate.year === null || best.candidate.year === lookup.year;

	let tier: MatchTier;
	if (exactTitle && yearMatches) {
		tier = "exact";
	} else if (exactTitle || best.score >= 0.75) {
		tier = "year";
	} else if (best.score >= 0.55) {
		tier = "fuzzy";
	} else {
		return { candidate: null, tier: "unmatched", score: best.score, rejected: ranked.map((r) => r.candidate), queriesTried };
	}

	return { candidate: best.candidate, tier, score: best.score, rejected, queriesTried };
}
