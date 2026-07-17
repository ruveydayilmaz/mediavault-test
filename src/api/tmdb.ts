import { TMDBHttpClient } from "./tmdb-http-client";
import { TTLCache } from "./tmdb-cache";
import {
	normalizeSearchResult,
	normalizeMovieDetails,
	normalizeTVDetails,
	normalizeEpisode,
} from "./tmdb-normalize";
import {
	TMDBRawSearchResponse,
	TMDBRawMovieDetails,
	TMDBRawTVDetails,
	TMDBRawSeasonDetails,
	TMDBRawGenre,
	TMDBRawImage,
	TMDBRawImagesResponse,
	TMDBImageOptions,
	TMDBSearchResult,
	TMDBNormalizedDetails,
	TMDBNormalizedEpisode,
	TMDBRawCastMember,
	TMDBRawCrewMember,
} from "../types/tmdb";
import { PagedResult } from "../types/common";

export interface TMDBServiceConfig {
	getApiKey: () => string;
	/** Cache duration in minutes; 0 disables caching. */
	getCacheDurationMinutes: () => number;
	/** ISO 639-1 language code, e.g. "en-US". Defaults to "en-US". */
	getLanguage?: () => string;
	/** ISO 3166-1 region code for release dates/availability. Optional. */
	getRegion?: () => string;
}

/**
 * High-level TMDB API surface used by the rest of the plugin. Wraps
 * TMDBHttpClient (retries/rate-limits) and TTLCache (avoids refetching the
 * same query repeatedly), and normalizes all raw TMDB responses into
 * MediaVault's own shapes so nothing else in the codebase touches TMDB's
 * snake_case fields directly.
 */
export class TMDBService {
	private http: TMDBHttpClient;
	private cache: TTLCache<unknown>;
	private config: TMDBServiceConfig;

	constructor(config: TMDBServiceConfig) {
		this.config = config;
		this.http = new TMDBHttpClient(config.getApiKey);
		this.cache = new TTLCache(() => config.getCacheDurationMinutes() * 60 * 1000);
	}

	private get language(): string {
		return this.config.getLanguage?.() ?? "en-US";
	}

	private async cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
		const hit = this.cache.get(key) as T | undefined;
		if (hit !== undefined) return hit;
		const value = await fetcher();
		this.cache.set(key, value);
		return value;
	}

	/** Clears the entire response cache — useful after changing the API key or on demand. */
	clearCache(): void {
		this.cache.clear();
	}

	// ---- Search ----

	async searchMovies(query: string, page = 1): Promise<PagedResult<TMDBSearchResult>> {
		const key = `search:movie:${query}:${page}:${this.language}`;
		return this.cached(key, async () => {
			const raw = await this.http.get<TMDBRawSearchResponse>("/search/movie", {
				params: { query, page, language: this.language, include_adult: "false" },
			});
			return {
				items: raw.results.map((r) => normalizeSearchResult(r, "movie")),
				total: raw.total_results,
				page: raw.page,
				pageSize: raw.results.length,
			};
		});
	}

	async searchShows(query: string, page = 1): Promise<PagedResult<TMDBSearchResult>> {
		const key = `search:tv:${query}:${page}:${this.language}`;
		return this.cached(key, async () => {
			const raw = await this.http.get<TMDBRawSearchResponse>("/search/tv", {
				params: { query, page, language: this.language, include_adult: "false" },
			});
			return {
				items: raw.results.map((r) => normalizeSearchResult(r, "tv")),
				total: raw.total_results,
				page: raw.page,
				pageSize: raw.results.length,
			};
		});
	}

	/** Combined movie + TV search, useful for a single "add media" search box. */
	async searchMulti(query: string, page = 1): Promise<PagedResult<TMDBSearchResult>> {
		const key = `search:multi:${query}:${page}:${this.language}`;
		return this.cached(key, async () => {
			const raw = await this.http.get<TMDBRawSearchResponse>("/search/multi", {
				params: { query, page, language: this.language, include_adult: "false" },
			});
			const items = raw.results
				.filter((r) => r.media_type === "movie" || r.media_type === "tv")
				.map((r) => normalizeSearchResult(r, r.media_type as "movie" | "tv"));
			return {
				items,
				total: raw.total_results,
				page: raw.page,
				pageSize: items.length,
			};
		});
	}

	// ---- Details ----

	async getMovie(tmdbId: number): Promise<TMDBNormalizedDetails> {
		const key = `movie:${tmdbId}:${this.language}`;
		return this.cached(key, async () => {
			const raw = await this.http.get<TMDBRawMovieDetails>(`/movie/${tmdbId}`, {
				params: { language: this.language, append_to_response: "credits" },
			});
			return normalizeMovieDetails(raw);
		});
	}

	async getTV(tmdbId: number): Promise<TMDBNormalizedDetails> {
		const key = `tv:${tmdbId}:${this.language}`;
		return this.cached(key, async () => {
			const raw = await this.http.get<TMDBRawTVDetails>(`/tv/${tmdbId}`, {
				params: { language: this.language, append_to_response: "credits" },
			});
			return normalizeTVDetails(raw);
		});
	}

	/**
	 * Credits are already included via append_to_response in getMovie/getTV,
	 * but exposed standalone too for callers that only need cast/crew
	 * (e.g. refreshing cast without refetching everything).
	 */
	async getCredits(tmdbId: number, kind: "movie" | "tv"): Promise<TMDBNormalizedDetails["cast"]> {
		const details = kind === "movie" ? await this.getMovie(tmdbId) : await this.getTV(tmdbId);
		return details.cast;
	}

	// ---- Episodes ----

	async getEpisodes(tmdbShowId: number, seasonNumber: number): Promise<TMDBNormalizedEpisode[]> {
		const key = `episodes:${tmdbShowId}:${seasonNumber}:${this.language}`;
		return this.cached(key, async () => {
			const raw = await this.http.get<TMDBRawSeasonDetails>(
				`/tv/${tmdbShowId}/season/${seasonNumber}`,
				{ params: { language: this.language } }
			);
			return (raw.episodes ?? []).map(normalizeEpisode);
		});
	}

	/**
	 * Guest cast + crew for a single episode (Milestone 1: Episode Details
	 * Experience). Separate endpoint from `getEpisodes` — TMDB only returns
	 * per-episode credits via `/tv/{id}/season/{s}/episode/{e}/credits`, not
	 * on the season list — so this is fetched lazily, only when an Episode
	 * Details page is actually opened, and cached like everything else.
	 */
	async getEpisodeCredits(
		tmdbShowId: number,
		seasonNumber: number,
		episodeNumber: number
	): Promise<{ guestCast: { name: string; character: string }[]; crew: { name: string; job: string }[] }> {
		const key = `episode-credits:${tmdbShowId}:${seasonNumber}:${episodeNumber}:${this.language}`;
		return this.cached(key, async () => {
			const raw = await this.http.get<{
				guest_stars?: TMDBRawCastMember[];
				crew?: TMDBRawCrewMember[];
			}>(`/tv/${tmdbShowId}/season/${seasonNumber}/episode/${episodeNumber}/credits`, {
				params: { language: this.language },
			});
			return {
				guestCast: (raw.guest_stars ?? []).map((c) => ({ name: c.name, character: c.character })),
				crew: (raw.crew ?? [])
					.filter((c) => c.job === "Director" || c.job === "Writer")
					.map((c) => ({ name: c.name, job: c.job })),
			};
		});
	}

	// ---- Recommendations / similar ----

	async getRecommendations(tmdbId: number, kind: "movie" | "tv", page = 1): Promise<PagedResult<TMDBSearchResult>> {
		const key = `recs:${kind}:${tmdbId}:${page}:${this.language}`;
		return this.cached(key, async () => {
			const raw = await this.http.get<TMDBRawSearchResponse>(
				`/${kind}/${tmdbId}/recommendations`,
				{ params: { page, language: this.language } }
			);
			return {
				items: raw.results.map((r) => normalizeSearchResult(r, kind)),
				total: raw.total_results,
				page: raw.page,
				pageSize: raw.results.length,
			};
		});
	}

	async getSimilar(tmdbId: number, kind: "movie" | "tv", page = 1): Promise<PagedResult<TMDBSearchResult>> {
		const key = `similar:${kind}:${tmdbId}:${page}:${this.language}`;
		return this.cached(key, async () => {
			const raw = await this.http.get<TMDBRawSearchResponse>(`/${kind}/${tmdbId}/similar`, {
				params: { page, language: this.language },
			});
			return {
				items: raw.results.map((r) => normalizeSearchResult(r, kind)),
				total: raw.total_results,
				page: raw.page,
				pageSize: raw.results.length,
			};
		});
	}

	// ---- Discovery (roadmap Milestone 7 — Explore) ----

	/** TMDB's trending feed — genuinely trending right now, distinct from the all-time "popular" ranking. */
	async getTrending(kind: "movie" | "tv", window: "day" | "week" = "week", page = 1): Promise<PagedResult<TMDBSearchResult>> {
		const key = `trending:${kind}:${window}:${page}:${this.language}`;
		return this.cached(key, async () => {
			const raw = await this.http.get<TMDBRawSearchResponse>(`/trending/${kind}/${window}`, {
				params: { page, language: this.language },
			});
			return {
				items: raw.results.map((r) => normalizeSearchResult(r, kind)),
				total: raw.total_results,
				page: raw.page,
				pageSize: raw.results.length,
			};
		});
	}

	/** Overall popularity ranking (TMDB's /popular), as opposed to the trending-algorithm feed above. */
	async getPopular(kind: "movie" | "tv", page = 1): Promise<PagedResult<TMDBSearchResult>> {
		const key = `popular:${kind}:${page}:${this.language}`;
		return this.cached(key, async () => {
			const raw = await this.http.get<TMDBRawSearchResponse>(`/${kind}/popular`, {
				params: { page, language: this.language },
			});
			return {
				items: raw.results.map((r) => normalizeSearchResult(r, kind)),
				total: raw.total_results,
				page: raw.page,
				pageSize: raw.results.length,
			};
		});
	}

	async getGenres(kind: "movie" | "tv"): Promise<{ id: number; name: string }[]> {
		const key = `genres:${kind}:${this.language}`;
		return this.cached(key, async () => {
			const raw = await this.http.get<{ genres: TMDBRawGenre[] }>(`/genre/${kind}/list`, {
				params: { language: this.language },
			});
			return raw.genres;
		});
	}

	/**
	 * Every available poster and backdrop image TMDB has for a title, for
	 * the Edit Poster / Edit Banner pickers (Milestone 3). `include_image_language`
	 * pulls in language-neutral images plus the configured language so
	 * posters with localized text aren't dropped, and sorted by TMDB's own
	 * vote_average so the most commonly-preferred images surface first.
	 */
	async getImages(tmdbId: number, kind: "movie" | "tv"): Promise<TMDBImageOptions> {
		const key = `images:${kind}:${tmdbId}`;
		return this.cached(key, async () => {
			const raw = await this.http.get<TMDBRawImagesResponse>(`/${kind}/${tmdbId}/images`, {
				params: { include_image_language: `${this.language.split("-")[0]},null` },
			});
			const byVoteDesc = (a: TMDBRawImage, b: TMDBRawImage) => (b.vote_average ?? 0) - (a.vote_average ?? 0);
			return {
				posters: [...raw.posters].sort(byVoteDesc).map((p) => ({ filePath: p.file_path, width: p.width, height: p.height })),
				backdrops: [...raw.backdrops].sort(byVoteDesc).map((b) => ({ filePath: b.file_path, width: b.width, height: b.height })),
			};
		});
	}

	/**
	 * TMDB's /discover endpoint — powers Browse's advanced search (genre,
	 * runtime, year, rating, language). `region`/streaming-provider
	 * filtering is left for a future pass since it needs a provider-id
	 * lookup TMDB doesn't return alongside genres.
	 */
	async discover(kind: "movie" | "tv", filters: DiscoverFilters, page = 1): Promise<PagedResult<TMDBSearchResult>> {
		const params: Record<string, string | number> = { page, language: this.language };
		if (filters.genreId !== undefined) params.with_genres = filters.genreId;
		if (filters.yearMin !== undefined || filters.yearMax !== undefined) {
			// TMDB has no native year-range param; primary_release_year/first_air_date_year are exact-year only,
			// so a range is approximated with the gte/lte date params instead.
			const dateField = kind === "movie" ? "primary_release_date" : "first_air_date";
			if (filters.yearMin !== undefined) params[`${dateField}.gte`] = `${filters.yearMin}-01-01`;
			if (filters.yearMax !== undefined) params[`${dateField}.lte`] = `${filters.yearMax}-12-31`;
		}
		if (filters.runtimeMin !== undefined) params["with_runtime.gte"] = filters.runtimeMin;
		if (filters.runtimeMax !== undefined) params["with_runtime.lte"] = filters.runtimeMax;
		if (filters.ratingMin !== undefined) params["vote_average.gte"] = filters.ratingMin;
		if (filters.language) params.with_original_language = filters.language;
		params.sort_by = filters.sortBy ?? "popularity.desc";

		const key = `discover:${kind}:${JSON.stringify(params)}`;
		return this.cached(key, async () => {
			const raw = await this.http.get<TMDBRawSearchResponse>(`/discover/${kind}`, { params });
			return {
				items: raw.results.map((r) => normalizeSearchResult(r, kind)),
				total: raw.total_results,
				page: raw.page,
				pageSize: raw.results.length,
			};
		});
	}
}

export interface DiscoverFilters {
	genreId?: number;
	yearMin?: number;
	yearMax?: number;
	runtimeMin?: number;
	runtimeMax?: number;
	ratingMin?: number;
	language?: string;
	sortBy?: string;
}
