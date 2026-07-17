import { describe, it, expect } from "vitest";
import { buildRecommendations, getTopRatedMedia } from "../../src/services/recommendation/engine";
import { MediaType, MediaStatus } from "../../src/types/enums";
import { DEFAULT_COMFORT_FLAGS } from "../../src/models/comfort";

function makeMedia(partial: any): any {
	return {
		id: partial.id,
		tmdbId: partial.tmdbId ?? 1,
		type: partial.type ?? MediaType.Movie,
		title: partial.title,
		originalTitle: null,
		year: partial.year ?? 2020,
		genres: partial.genres ?? [],
		runtime: 100,
		posterPath: null,
		backdropPath: null,
		cast: partial.cast ?? [],
		crew: partial.crew ?? [],
		productionCompanies: [],
		language: null,
		country: null,
		synopsis: null,
		status: partial.status ?? MediaStatus.Completed,
		notes: "",
		tags: [],
		averageRating: partial.averageRating ?? null,
		watchCount: partial.watchCount ?? 0,
		notePath: null,
		createdAt: "",
		updatedAt: "",
	};
}

function makeProfile(mediaId: string, overrides: any = {}): any {
	return {
		id: "p" + mediaId,
		mediaId,
		comfortScore: 5,
		energyLevel: 5,
		attentionLevel: 5,
		emotionalHeaviness: 5,
		plotComplexity: 5,
		rewatchability: 5,
		flags: { ...DEFAULT_COMFORT_FLAGS },
		seasonalTags: [],
		triggerWarnings: [],
		updatedAt: "",
		...overrides,
	};
}

describe("recommendation engine", () => {
	it("getTopRatedMedia sorts by rating descending and respects the limit", () => {
		const m1 = makeMedia({ id: "m1", title: "A", averageRating: 9 });
		const m2 = makeMedia({ id: "m2", title: "B", averageRating: 6 });
		const m3 = makeMedia({ id: "m3", title: "C", averageRating: null });

		const top = getTopRatedMedia([m2, m1, m3], 2);
		expect(top).toHaveLength(2);
		expect(top[0].id).toBe("m1");
	});

	it("produces similar-to-favorites, comfort-rewatch, and energy/attention picks without cross-contamination", async () => {
		const favMovie = makeMedia({
			id: "fav1",
			tmdbId: 100,
			title: "Favorite Movie",
			averageRating: 10,
			genres: ["Sci-Fi"],
			cast: [{ tmdbPersonId: 1, name: "Star Actor", character: "X", profilePath: null, order: 0 }],
		});
		const comfortWatched = makeMedia({ id: "cw1", title: "Cozy Rewatch", watchCount: 3 });
		const highEnergyUnwatched = makeMedia({ id: "he1", title: "Action Pick", watchCount: 0 });
		const lowAttentionUnwatched = makeMedia({ id: "la1", title: "Easy Watch", watchCount: 0 });

		const mediaStore = [favMovie, comfortWatched, highEnergyUnwatched, lowAttentionUnwatched];
		const profileStore = [
			makeProfile("cw1", { comfortScore: 9, rewatchability: 9 }),
			makeProfile("he1", { energyLevel: 9 }),
			makeProfile("la1", { attentionLevel: 1 }),
		];
		const sessionStore = [{ mediaId: "fav1", rating: 10, watchDate: "2024-01-01" }];

		const storage: any = {
			media: { getAll: async () => mediaStore },
			watchSessions: { getAll: async () => sessionStore },
			comfortProfiles: { getAll: async () => profileStore },
		};

		const tmdb: any = {
			getSimilar: async (id: number) => ({
				items:
					id === 100
						? [{ tmdbId: 200, mediaKind: "movie", title: "Similar Sci-Fi", year: 2021, posterPath: null, backdropPath: null, overview: "" }]
						: [],
				total: 1,
				page: 1,
				pageSize: 1,
			}),
			getRecommendations: async () => ({ items: [], total: 0, page: 1, pageSize: 0 }),
			getMovie: async (id: number) => ({
				tmdbId: id,
				mediaKind: "movie",
				title: "Similar Sci-Fi",
				originalTitle: "Similar Sci-Fi",
				year: 2021,
				runtime: 100,
				genres: ["Sci-Fi"],
				posterPath: null,
				backdropPath: null,
				overview: "",
				language: "en",
				country: "US",
				productionCompanies: [],
				cast: [{ tmdbPersonId: 1, name: "Star Actor", character: "Y", profilePath: null, order: 0 }],
				crew: [],
			}),
		};

		const recs = await buildRecommendations(storage, tmdb);

		expect(recs.similarToFavorites).toHaveLength(1);
		expect(recs.similarToFavorites[0].title).toBe("Similar Sci-Fi");
		expect(recs.similarToFavorites[0].reasons.length).toBeGreaterThan(0);
		expect(recs.similarToFavorites[0].score).toBeGreaterThan(0);

		expect(recs.comfortRewatch).toHaveLength(1);
		expect(recs.comfortRewatch[0].mediaId).toBe("cw1");
		expect(recs.highEnergy).toHaveLength(1);
		expect(recs.highEnergy[0].mediaId).toBe("he1");
		expect(recs.lowAttention).toHaveLength(1);
		expect(recs.lowAttention[0].mediaId).toBe("la1");

		// no leakage between the watched-only and unwatched-only pools
		expect(recs.comfortRewatch.some((r) => r.mediaId === "he1" || r.mediaId === "la1")).toBe(false);
		expect(recs.highEnergy.some((r) => r.mediaId === "cw1")).toBe(false);
		expect(recs.lowAttention.some((r) => r.mediaId === "cw1")).toBe(false);
	});

	it("returns no TMDB-backed recommendations when the library has no rated favorites yet", async () => {
		const storage: any = {
			media: { getAll: async () => [] },
			watchSessions: { getAll: async () => [] },
			comfortProfiles: { getAll: async () => [] },
		};
		const tmdb: any = {};

		const recs = await buildRecommendations(storage, tmdb);
		expect(recs.similarToFavorites).toHaveLength(0);
		expect(recs.hiddenGems).toHaveLength(0);
	});
});
