import { describe, it, expect } from "vitest";
import { pullFromTrakt, pushToTrakt } from "../../src/services/trakt-sync";
import { MediaType } from "../../src/types/enums";

function makeMockStorage() {
	const mediaStore: any[] = [];
	const sessionStore: any[] = [];
	const episodeStore: any[] = [];
	const progressStore: any[] = [];

	const storage: any = {
		settings: {
			get: () => ({ traktLastSyncedAt: null }),
			update: async () => {},
		},
		media: {
			getAll: async () => mediaStore,
			findWhere: async (pred: any) => mediaStore.filter(pred),
			findById: async (id: string) => mediaStore.find((m) => m.id === id) ?? null,
			findByTmdbId: async (tmdbId: number, type: string) =>
				mediaStore.find((m) => m.tmdbId === tmdbId && m.type === type) ?? null,
			save: async (m: any) => {
				mediaStore.push(m);
				return m;
			},
			update: async (id: string, patch: any) => {
				const idx = mediaStore.findIndex((m) => m.id === id);
				if (idx === -1) return null;
				mediaStore[idx] = { ...mediaStore[idx], ...patch };
				return mediaStore[idx];
			},
		},
		watchSessions: {
			getAll: async () => sessionStore,
			findWhere: async (pred: any) => sessionStore.filter(pred),
			findByMediaId: async (mediaId: string) => sessionStore.filter((s) => s.mediaId === mediaId),
			save: async (s: any) => {
				sessionStore.push(s);
				return s;
			},
			update: async (id: string, patch: any) => {
				const idx = sessionStore.findIndex((s) => s.id === id);
				sessionStore[idx] = { ...sessionStore[idx], ...patch };
				return sessionStore[idx];
			},
		},
		episodes: {
			findByMediaId: async (mediaId: string) => episodeStore.filter((e) => e.mediaId === mediaId),
			create: async (input: any) => {
				const rec = { id: "ep" + episodeStore.length, ...input };
				episodeStore.push(rec);
				return rec;
			},
		},
		episodeProgress: {
			findByMediaId: async (mediaId: string) => progressStore.filter((p) => p.mediaId === mediaId),
			findByEpisodeId: async (episodeId: string) => progressStore.find((p) => p.episodeId === episodeId) ?? null,
			markWatched: async (episode: any, watched: boolean, watchedDate?: string) => {
				let existing = progressStore.find((p) => p.episodeId === episode.id);
				if (existing) {
					existing.watched = watched;
					existing.watchedDate = watchedDate ?? null;
					return existing;
				}
				const rec = {
					id: "pg" + progressStore.length,
					mediaId: episode.mediaId,
					episodeId: episode.id,
					watched,
					watchedDate: watchedDate ?? null,
					rating: null,
				};
				progressStore.push(rec);
				return rec;
			},
		},
	};

	return { storage, mediaStore, sessionStore, episodeStore, progressStore };
}

const mockTmdb: any = {
	getMovie: async (id: number) => ({
		tmdbId: id,
		mediaKind: "movie",
		title: "Interstellar",
		originalTitle: "Interstellar",
		year: 2014,
		runtime: 169,
		genres: [],
		posterPath: null,
		backdropPath: null,
		overview: "",
		language: "en",
		country: "US",
		productionCompanies: [],
		cast: [],
		crew: [],
	}),
	getTV: async (id: number) => ({
		tmdbId: id,
		mediaKind: "tv",
		title: "The Bear",
		originalTitle: "The Bear",
		year: 2022,
		runtime: 30,
		genres: [],
		posterPath: null,
		backdropPath: null,
		overview: "",
		language: "en",
		country: "US",
		productionCompanies: [],
		cast: [],
		crew: [],
		seasons: [{ seasonNumber: 1, episodeCount: 1, name: "S1", airDate: null }],
	}),
	getEpisodes: async () => [
		{ tmdbEpisodeId: 1, seasonNumber: 1, episodeNumber: 1, title: "Ep1", runtime: 30, airDate: null, synopsis: null, thumbnailPath: null, tmdbRating: null },
	],
};

function makeMockTrakt() {
	return {
		getHistory: async (type: string) =>
			type === "movies"
				? [{ id: 111, watchedAt: "2024-01-01T00:00:00Z", type: "movie", movie: { title: "Interstellar", year: 2014, ids: { trakt: 1, tmdb: 157336, imdb: null } } }]
				: [{ id: 222, watchedAt: "2024-02-02T00:00:00Z", type: "episode", show: { title: "The Bear", year: 2022, ids: { trakt: 2, tmdb: 999, imdb: null } }, episode: { season: 1, number: 1, title: "Ep1" } }],
		getRatings: async () => [{ ratedAt: "2024-01-01T00:00:00Z", rating: 9, type: "movie", movie: { title: "Interstellar", year: 2014, ids: { trakt: 1, tmdb: 157336, imdb: null } } }],
		addMovieToHistory: async () => {},
		addMovieRating: async () => {},
	} as any;
}

describe("trakt-sync: pull/push dedup invariants", () => {
	it("pulling history adds a movie session and marks the episode watched, with the rating carried through", async () => {
		const { storage, sessionStore } = makeMockStorage();
		const trakt = makeMockTrakt();

		const result = await pullFromTrakt(storage, mockTmdb, trakt);

		expect(result.moviesAdded).toBe(1);
		expect(result.episodesMarked).toBe(1);
		// One session for the movie, plus one series-level session because this
		// pull completes the show's only episode (Milestone 2: TV Watch Logging
		// Logic — a WatchSession is only auto-created when a whole series
		// becomes fully watched, not per episode).
		expect(sessionStore).toHaveLength(2);
		const movieSession = sessionStore.find((s: any) => s.externalSource === "trakt");
		expect(movieSession.rating).toBe(9);
		expect(movieSession.externalRef).toBe("111");
		const seriesSession = sessionStore.find((s: any) => s.mediaId !== movieSession.mediaId);
		expect(seriesSession).toBeDefined();
		expect(seriesSession.episodeId).toBeNull();
	});

	it("re-pulling the same history does not create a duplicate session", async () => {
		const { storage, sessionStore } = makeMockStorage();
		const trakt = makeMockTrakt();

		await pullFromTrakt(storage, mockTmdb, trakt);
		const second = await pullFromTrakt(storage, mockTmdb, trakt);

		expect(second.moviesSkippedExisting).toBe(1);
		// Still just the one movie session + one episode session — re-marking an
		// already-watched episode is a no-op for logging purposes.
		expect(sessionStore).toHaveLength(2);
	});

	it("pushing a local-only watch tags it so it is never pushed twice", async () => {
		const { storage, mediaStore, sessionStore } = makeMockStorage();
		const trakt = makeMockTrakt();

		mediaStore.push({ id: "m-local", tmdbId: 42, type: MediaType.Movie, title: "Local Only Movie" });
		sessionStore.push({ id: "s-local", mediaId: "m-local", watchDate: "2024-03-01", rating: 7, externalSource: null, externalRef: null });

		const first = await pushToTrakt(storage, trakt);
		expect(first.pushed).toBe(1);
		expect(sessionStore[0].externalSource).toBe("trakt");

		const second = await pushToTrakt(storage, trakt);
		expect(second.pushed).toBe(0);
	});
});
