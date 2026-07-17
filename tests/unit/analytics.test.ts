import { describe, it, expect } from "vitest";
import { computeAnalytics } from "../../src/services/analytics/compute";
import { MediaType, MediaStatus } from "../../src/types/enums";

function makeMedia(overrides: any): any {
	return {
		id: overrides.id,
		tmdbId: 1,
		type: overrides.type ?? MediaType.Movie,
		title: overrides.title ?? "T",
		originalTitle: null,
		year: 2020,
		genres: overrides.genres ?? [],
		runtime: overrides.runtime ?? 100,
		posterPath: null,
		backdropPath: null,
		cast: overrides.cast ?? [],
		crew: overrides.crew ?? [],
		productionCompanies: overrides.productionCompanies ?? [],
		language: null,
		country: null,
		synopsis: null,
		status: overrides.status ?? MediaStatus.Completed,
		notes: "",
		tags: [],
		averageRating: null,
		watchCount: 0,
		notePath: null,
		createdAt: "",
		updatedAt: "",
	};
}

describe("analytics engine", () => {
	it("computes runtime, ratings, top-N breakdowns, rewatch count, completion rate, and trends", () => {
		const movie1 = makeMedia({
			id: "m1",
			runtime: 120,
			genres: ["Sci-Fi", "Drama"],
			cast: [{ tmdbPersonId: 1, name: "Actor A", character: "X", profilePath: null, order: 0 }],
			crew: [{ tmdbPersonId: 2, name: "Director A", job: "Director", department: "Directing", profilePath: null }],
			productionCompanies: [{ tmdbCompanyId: 1, name: "Studio A", logoPath: null, originCountry: null }],
			status: MediaStatus.Completed,
		});
		const movie2 = makeMedia({
			id: "m2",
			runtime: 90,
			genres: ["Sci-Fi"],
			cast: [{ tmdbPersonId: 1, name: "Actor A", character: "Y", profilePath: null, order: 0 }],
			status: MediaStatus.PlanToWatch,
		});
		const show1 = makeMedia({ id: "m3", type: MediaType.TVShow, runtime: 30, genres: ["Comedy"], status: MediaStatus.Watching });

		const sessions: any[] = [
			{ mediaId: "m1", rating: 8, watchDate: "2024-01-10", rewatchNumber: 0 },
			{ mediaId: "m1", rating: 10, watchDate: "2024-03-05", rewatchNumber: 1 },
			{ mediaId: "m2", rating: 6, watchDate: "2024-01-20", rewatchNumber: 0 },
		];

		const episodes = [
			{ id: "e1", mediaId: "m3", tmdbEpisodeId: 1, seasonNumber: 1, episodeNumber: 1, title: "Ep1", runtime: 25, airDate: null, synopsis: null, thumbnailPath: null, tmdbRating: null },
		];
		const episodeProgress = [
			{ id: "p1", mediaId: "m3", episodeId: "e1", seasonNumber: 1, episodeNumber: 1, watched: true, watchedDate: "2024-02-14", rating: 9, review: null, isFavorite: false, comfortNote: null, updatedAt: "" },
		];

		const result = computeAnalytics({ media: [movie1, movie2, show1], sessions, episodes, episodeProgress });

		// Runtime counts per watch EVENT (rewatches count again): m1 watched twice (240) + m2 (90) + episode (25) = 355
		expect(result.totalRuntimeMinutes).toBe(355);
		expect(result.moviesWatchedCount).toBe(2);
		expect(result.episodesWatchedCount).toBe(1);
		expect(result.averageRating).toBe(8.25); // (8+10+6+9)/4
		expect(result.topGenres[0]).toMatchObject({ label: "Sci-Fi", count: 2 });
		expect(result.topActors[0]).toMatchObject({ label: "Actor A", count: 2 });
		expect(result.topDirectors[0].label).toBe("Director A");
		expect(result.topStudios[0].label).toBe("Studio A");
		expect(result.rewatchCount).toBe(1);
		expect(result.completionRate).toBe(33.33);

		const jan = result.monthlyWatchTrend.find((t) => t.period === "2024-01");
		const feb = result.monthlyWatchTrend.find((t) => t.period === "2024-02");
		const mar = result.monthlyWatchTrend.find((t) => t.period === "2024-03");
		expect(jan?.count).toBe(2);
		expect(feb?.count).toBe(1);
		expect(mar?.count).toBe(1);

		const y2024 = result.yearlyWatchTrend.find((t) => t.period === "2024");
		expect(y2024?.count).toBe(4);
	});

	it("handles empty input without NaN or crashes", () => {
		const empty = computeAnalytics({ media: [], sessions: [], episodes: [], episodeProgress: [] });
		expect(empty.averageRating).toBeNull();
		expect(empty.completionRate).toBe(0);
		expect(empty.totalRuntimeMinutes).toBe(0);
	});
});
