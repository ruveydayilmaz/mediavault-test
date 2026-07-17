import type { TMDBService } from "../../api/tmdb";
import { TMDBSearchResult } from "../../types/tmdb";

/** The minimal info needed to search/rank TMDB candidates — kept independent of any specific importer's internal types. */
export interface TitleLookup {
	kind: "movie" | "tv";
	title: string;
	year: number | null;
}

function titlesRoughlyMatch(a: string, b: string): boolean {
	const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
	return norm(a) === norm(b);
}

/**
 * Searches TMDB for the best candidate(s) for a title lookup. Returns up
 * to 5 candidates, ranked with exact-title(+year) matches first. Does not
 * create anything — used both by preview (read-only) and commit (to
 * resolve which tmdbId to attach a new MediaItem to).
 */
export async function findTMDBCandidates(
	tmdb: TMDBService,
	lookup: TitleLookup
): Promise<TMDBSearchResult[]> {
	const searchFn = lookup.kind === "movie" ? tmdb.searchMovies.bind(tmdb) : tmdb.searchShows.bind(tmdb);
	const result = await searchFn(lookup.title);

	const ranked = [...result.items].sort((a, b) => {
		const aExact = titlesRoughlyMatch(a.title, lookup.title) ? 1 : 0;
		const bExact = titlesRoughlyMatch(b.title, lookup.title) ? 1 : 0;
		if (aExact !== bExact) return bExact - aExact;

		if (lookup.year !== null) {
			const aYearDiff = a.year !== null ? Math.abs(a.year - lookup.year) : 999;
			const bYearDiff = b.year !== null ? Math.abs(b.year - lookup.year) : 999;
			return aYearDiff - bYearDiff;
		}
		return 0;
	});

	return ranked.slice(0, 5);
}

/**
 * Classifies match confidence from ranked candidates: "matched" if the top
 * candidate is a clear exact-title winner (or the only result), "ambiguous"
 * if several plausible candidates exist with no clear winner, "unmatched"
 * if TMDB returned nothing.
 */
export function classifyMatch(lookup: TitleLookup, candidates: TMDBSearchResult[]): "matched" | "ambiguous" | "unmatched" {
	if (candidates.length === 0) return "unmatched";
	if (candidates.length === 1) return "matched";

	const exactMatches = candidates.filter((c) => titlesRoughlyMatch(c.title, lookup.title));
	if (exactMatches.length === 1) return "matched";
	if (exactMatches.length > 1 && lookup.year !== null) {
		const yearMatches = exactMatches.filter((c) => c.year === lookup.year);
		if (yearMatches.length === 1) return "matched";
	}
	return "ambiguous";
}
