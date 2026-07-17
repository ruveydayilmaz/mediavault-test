import { TraktHttpClient, TraktClientConfig } from "./trakt-http-client";
import { TTLCache } from "./tmdb-cache";

export type TraktMediaKind = "movies" | "episodes" | "shows";

export interface TraktIds {
	trakt: number;
	tmdb: number | null;
	imdb: string | null;
}

export interface TraktComment {
	id: number;
	comment: string;
	createdAt: string;
	spoiler: boolean;
	review: boolean;
	likes: number;
	userName: string;
}

export interface TraktHistoryItem {
	id: number; // Trakt's history entry id — used as our externalRef for dedupe
	watchedAt: string; // ISO
	type: "movie" | "episode";
	movie?: { title: string; year: number | null; ids: TraktIds };
	show?: { title: string; year: number | null; ids: TraktIds };
	episode?: { season: number; number: number; title: string };
}

export interface TraktRatingItem {
	ratedAt: string;
	rating: number; // 1-10 on Trakt's scale
	type: "movie" | "episode" | "show";
	movie?: { title: string; year: number | null; ids: TraktIds };
	show?: { title: string; year: number | null; ids: TraktIds };
	episode?: { season: number; number: number; title: string };
}

function normalizeIds(raw: { trakt: number; tmdb?: number; imdb?: string } | undefined): TraktIds {
	return {
		trakt: raw?.trakt ?? 0,
		tmdb: raw?.tmdb ?? null,
		imdb: raw?.imdb ?? null,
	};
}

/**
 * High-level Trakt API surface: reading watch history/ratings (for pulling
 * into MediaVault) and writing new history/ratings entries (for pushing
 * MediaVault-originated watches back up) — the "bi-directional" part of
 * this milestone.
 */
export class TraktService {
	private http: TraktHttpClient;
	/** Comments/response cache (Milestone 4: Comments Integration) — 30 min TTL, in-memory only, same rationale as TMDBService's TTLCache. */
	private cache = new TTLCache<unknown>(() => 30 * 60 * 1000);

	constructor(config: TraktClientConfig) {
		this.http = new TraktHttpClient(config);
	}

	private async cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
		const hit = this.cache.get(key) as T | undefined;
		if (hit !== undefined) return hit;
		const value = await fetcher();
		this.cache.set(key, value);
		return value;
	}

	async getHistory(type: "movies" | "episodes", page = 1, limit = 100): Promise<TraktHistoryItem[]> {
		const raw = await this.http.request<any[]>(`/sync/history/${type}?page=${page}&limit=${limit}`);
		return raw.map((r) => ({
			id: r.id,
			watchedAt: r.watched_at,
			type: r.type,
			movie: r.movie
				? { title: r.movie.title, year: r.movie.year ?? null, ids: normalizeIds(r.movie.ids) }
				: undefined,
			show: r.show ? { title: r.show.title, year: r.show.year ?? null, ids: normalizeIds(r.show.ids) } : undefined,
			episode: r.episode
				? { season: r.episode.season, number: r.episode.number, title: r.episode.title }
				: undefined,
		}));
	}

	async getRatings(type: "movies" | "episodes" | "shows"): Promise<TraktRatingItem[]> {
		const raw = await this.http.request<any[]>(`/sync/ratings/${type}`);
		return raw.map((r) => ({
			ratedAt: r.rated_at,
			rating: r.rating,
			type: r.type,
			movie: r.movie
				? { title: r.movie.title, year: r.movie.year ?? null, ids: normalizeIds(r.movie.ids) }
				: undefined,
			show: r.show ? { title: r.show.title, year: r.show.year ?? null, ids: normalizeIds(r.show.ids) } : undefined,
			episode: r.episode
				? { season: r.episode.season, number: r.episode.number, title: r.episode.title }
				: undefined,
		}));
	}

	/** Pushes a movie watch (with an optional watched-at date) to Trakt's history. */
	async addMovieToHistory(tmdbId: number, watchedAt: string): Promise<void> {
		await this.http.request("/sync/history", {
			method: "POST",
			body: { movies: [{ ids: { tmdb: tmdbId }, watched_at: watchedAt }] },
		});
	}

	/** Pushes an episode watch to Trakt's history. */
	async addEpisodeToHistory(showTmdbId: number, season: number, episode: number, watchedAt: string): Promise<void> {
		await this.http.request("/sync/history", {
			method: "POST",
			body: {
				shows: [
					{
						ids: { tmdb: showTmdbId },
						seasons: [{ number: season, episodes: [{ number: episode, watched_at: watchedAt }] }],
					},
				],
			},
		});
	}

	/** Pushes a movie rating to Trakt. */
	async addMovieRating(tmdbId: number, rating: number, ratedAt: string): Promise<void> {
		await this.http.request("/sync/ratings", {
			method: "POST",
			body: { movies: [{ ids: { tmdb: tmdbId }, rating: Math.round(rating), rated_at: ratedAt }] },
		});
	}

	/**
	 * Trakt's comment endpoints need a Trakt id (or slug) — they don't
	 * accept a raw TMDB id — so every comment lookup resolves through
	 * Trakt's `/search/tmdb/:id` first. Resolution results are cached
	 * alongside the comments themselves, so a show's id is only looked up
	 * once per cache window even when its comments are re-fetched (e.g.
	 * switching between several episodes of the same show).
	 */
	private async resolveTraktId(tmdbId: number, kind: "movie" | "show"): Promise<number | null> {
		return this.cached(`resolve:${kind}:${tmdbId}`, async () => {
			const raw = await this.http.request<any[]>(`/search/tmdb/${tmdbId}?type=${kind}`, {
				authenticated: false,
			});
			const match = raw[0];
			const ids = kind === "movie" ? match?.movie?.ids : match?.show?.ids;
			return ids?.trakt ?? null;
		});
	}

	private normalizeComments(raw: any[]): TraktComment[] {
		return raw.map((c) => ({
			id: c.id,
			comment: c.comment,
			createdAt: c.created_at,
			spoiler: !!c.spoiler,
			review: !!c.review,
			likes: c.likes ?? 0,
			userName: c.user?.username ?? "trakt user",
		}));
	}

	/** Comments for a movie, looked up by TMDB id. Doesn't require the user's Trakt account to be connected — comments are public data. */
	async getMovieComments(tmdbId: number): Promise<TraktComment[]> {
		return this.cached(`comments:movie:${tmdbId}`, async () => {
			const traktId = await this.resolveTraktId(tmdbId, "movie");
			if (traktId === null) return [];
			const raw = await this.http.request<any[]>(`/movies/${traktId}/comments/newest?extended=full`, {
				authenticated: false,
			});
			return this.normalizeComments(raw);
		});
	}

	/** Comments for a whole show, looked up by TMDB id. */
	async getShowComments(tmdbId: number): Promise<TraktComment[]> {
		return this.cached(`comments:show:${tmdbId}`, async () => {
			const traktId = await this.resolveTraktId(tmdbId, "show");
			if (traktId === null) return [];
			const raw = await this.http.request<any[]>(`/shows/${traktId}/comments/newest?extended=full`, {
				authenticated: false,
			});
			return this.normalizeComments(raw);
		});
	}

	/** Comments for a single episode, looked up by the parent show's TMDB id plus season/episode number. */
	async getEpisodeComments(showTmdbId: number, season: number, episode: number): Promise<TraktComment[]> {
		return this.cached(`comments:episode:${showTmdbId}:${season}:${episode}`, async () => {
			const traktId = await this.resolveTraktId(showTmdbId, "show");
			if (traktId === null) return [];
			const raw = await this.http.request<any[]>(
				`/shows/${traktId}/seasons/${season}/episodes/${episode}/comments/newest?extended=full`,
				{ authenticated: false }
			);
			return this.normalizeComments(raw);
		});
	}
}
