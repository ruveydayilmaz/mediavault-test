import { describe, it, expect } from "vitest";
import { runLibraryQuery, DEFAULT_LIBRARY_QUERY, applyProgressTab } from "../../src/services/library-query";
import { MediaType, MediaStatus } from "../../src/types/enums";
import type { MediaItem } from "../../src/models/media";

function makeItem(partial: Partial<MediaItem>): MediaItem {
	return {
		id: Math.random().toString(),
		tmdbId: 1,
		type: MediaType.Movie,
		title: "Untitled",
		originalTitle: null,
		year: null,
		genres: [],
		runtime: null,
		posterPath: null,
		backdropPath: null,
		cast: [],
		crew: [],
		productionCompanies: [],
		language: null,
		country: null,
		synopsis: null,
		status: MediaStatus.PlanToWatch,
		notes: "",
		tags: [],
		averageRating: null,
		watchCount: 0,
		lastWatchedDate: null,
		notePath: null,
		createdAt: "",
		updatedAt: "",
		...partial,
	};
}

describe("library-query", () => {
	const items = [
		makeItem({ title: "Zebra Movie", type: MediaType.Movie, year: 2020, averageRating: 7 }),
		makeItem({ title: "Apple Show", type: MediaType.TVShow, year: 2018, averageRating: 9, status: MediaStatus.Watching }),
		makeItem({ title: "Comfort Flick", type: MediaType.Movie, year: 2015, status: MediaStatus.ComfortMedia, averageRating: 8 }),
		makeItem({ title: "Fave Show", type: MediaType.TVShow, year: 2022, isFavorite: true, averageRating: 10 }),
	];

	it("filters by movies/shows/comfort/favorites", () => {
		expect(runLibraryQuery(items, { ...DEFAULT_LIBRARY_QUERY, filter: "movies" }).items).toHaveLength(2);
		expect(runLibraryQuery(items, { ...DEFAULT_LIBRARY_QUERY, filter: "shows" }).items).toHaveLength(2);
		const comfort = runLibraryQuery(items, { ...DEFAULT_LIBRARY_QUERY, filter: "comfort" }).items;
		expect(comfort).toHaveLength(1);
		expect(comfort[0].title).toBe("Comfort Flick");

		const favorites = runLibraryQuery(items, { ...DEFAULT_LIBRARY_QUERY, filter: "favorites" }).items;
		expect(favorites).toHaveLength(1);
		expect(favorites[0].title).toBe("Fave Show");
	});

	it("sorts by rating descending and by title ascending (explicit)", () => {
		const byRating = runLibraryQuery(items, { ...DEFAULT_LIBRARY_QUERY, sortField: "rating", sortDirection: "desc" }).items;
		expect(byRating[0].title).toBe("Fave Show");

		const byTitle = runLibraryQuery(items, { ...DEFAULT_LIBRARY_QUERY, sortField: "title", sortDirection: "asc" }).items;
		expect(byTitle[0].title).toBe("Apple Show");
	});

	it("searches by title (case-insensitive)", () => {
		const result = runLibraryQuery(items, { ...DEFAULT_LIBRARY_QUERY, searchText: "zebra" }).items;
		expect(result).toHaveLength(1);
		expect(result[0].title).toBe("Zebra Movie");
	});

	it("paginates correctly", () => {
		const result = runLibraryQuery(items, { ...DEFAULT_LIBRARY_QUERY, pageSize: 2, page: 2 });
		expect(result.items).toHaveLength(2);
		expect(result.total).toBe(4);
		expect(result.page).toBe(2);
	});

	it("filters by progress tab (status-based, Milestone 3)", () => {
		const tabbedItems = [
			makeItem({ title: "A", status: MediaStatus.Watching }),
			makeItem({ title: "B", status: MediaStatus.Rewatching }),
			makeItem({ title: "C", status: MediaStatus.UpToDate }),
			makeItem({ title: "D", status: MediaStatus.PlanToWatch }),
			makeItem({ title: "E", status: MediaStatus.WatchLater }),
			makeItem({ title: "F", status: MediaStatus.Completed }),
			makeItem({ title: "G", status: MediaStatus.WaitingForNewSeason }),
			makeItem({ title: "H", status: MediaStatus.Dropped }),
		];

		// "Watching" groups both Watching and Rewatching, same as the prior "watching" LibraryFilter did.
		expect(applyProgressTab(tabbedItems, "watching").map((m) => m.title)).toEqual(["A", "B"]);
		expect(applyProgressTab(tabbedItems, "up_to_date").map((m) => m.title)).toEqual(["C"]);
		expect(applyProgressTab(tabbedItems, "plan_to_watch").map((m) => m.title)).toEqual(["D"]);
		expect(applyProgressTab(tabbedItems, "watch_later").map((m) => m.title)).toEqual(["E"]);
		expect(applyProgressTab(tabbedItems, "finished").map((m) => m.title)).toEqual(["F"]);
		expect(applyProgressTab(tabbedItems, "waiting_for_new_season").map((m) => m.title)).toEqual(["G"]);
		expect(applyProgressTab(tabbedItems, "dropped").map((m) => m.title)).toEqual(["H"]);
		expect(applyProgressTab(tabbedItems, "all")).toHaveLength(8);
	});

	it("combines a progress tab with the type/search/sort filters via runLibraryQuery", () => {
		const combined = [
			makeItem({ title: "Watching Movie", type: MediaType.Movie, status: MediaStatus.Watching }),
			makeItem({ title: "Watching Show", type: MediaType.TVShow, status: MediaStatus.Watching }),
			makeItem({ title: "Dropped Movie", type: MediaType.Movie, status: MediaStatus.Dropped }),
		];
		const result = runLibraryQuery(combined, { ...DEFAULT_LIBRARY_QUERY, filter: "movies", progressTab: "watching" });
		expect(result.items.map((m) => m.title)).toEqual(["Watching Movie"]);
	});
});
