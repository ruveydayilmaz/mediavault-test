import { describe, it, expect } from "vitest";
import { EpisodeProgressRepository } from "../../src/services/storage/episode-repository";

function makeMockAdapter() {
	const episodeProgress: any[] = [];
	const adapter: any = {
		getData: () => ({ episodeProgress }),
		requestSave: async () => {},
	};
	return { adapter, episodeProgress };
}

describe("BaseRepository (via EpisodeProgressRepository): indexed CRUD", () => {
	it("finds records by id in O(1)-index fashion and reflects updates/deletes", async () => {
		const { adapter } = makeMockAdapter();
		const repo = new EpisodeProgressRepository(adapter);

		const created = await repo.create({
			mediaId: "m1",
			episodeId: "e1",
			seasonNumber: 1,
			episodeNumber: 1,
			watched: false,
			watchedDate: null,
			rating: null,
			review: null,
			isFavorite: false,
			comfortNote: null,
		});

		expect(await repo.findById(created.id)).toEqual(created);

		await repo.update(created.id, { watched: true });
		const updated = await repo.findById(created.id);
		expect(updated?.watched).toBe(true);

		const deleted = await repo.delete(created.id);
		expect(deleted).toBe(true);
		expect(await repo.findById(created.id)).toBeNull();
	});

	it("groups records by mediaId via the index instead of a linear scan, staying correct after mutations", async () => {
		const { adapter } = makeMockAdapter();
		const repo = new EpisodeProgressRepository(adapter);

		const p1 = await repo.create({
			mediaId: "media-a", episodeId: "e1", seasonNumber: 1, episodeNumber: 1,
			watched: true, watchedDate: null, rating: null, review: null, isFavorite: false, comfortNote: null,
		});
		await repo.create({
			mediaId: "media-a", episodeId: "e2", seasonNumber: 1, episodeNumber: 2,
			watched: false, watchedDate: null, rating: null, review: null, isFavorite: false, comfortNote: null,
		});
		await repo.create({
			mediaId: "media-b", episodeId: "e3", seasonNumber: 1, episodeNumber: 1,
			watched: true, watchedDate: null, rating: null, review: null, isFavorite: false, comfortNote: null,
		});

		expect(await repo.findByMediaId("media-a")).toHaveLength(2);
		expect(await repo.findByMediaId("media-b")).toHaveLength(1);

		// index must invalidate correctly after a mutation, not return stale grouped results
		await repo.delete(p1.id);
		expect(await repo.findByMediaId("media-a")).toHaveLength(1);
	});

	it("stays correct at larger scale (index doesn't silently drop or duplicate entries)", async () => {
		const { adapter } = makeMockAdapter();
		const repo = new EpisodeProgressRepository(adapter);

		for (let i = 0; i < 2000; i++) {
			await repo.create({
				mediaId: `media-${i % 200}`, episodeId: `e${i}`, seasonNumber: 1, episodeNumber: i,
				watched: true, watchedDate: null, rating: null, review: null, isFavorite: false, comfortNote: null,
			});
		}

		expect(await repo.count()).toBe(2000);
		expect(await repo.findByMediaId("media-0")).toHaveLength(10); // 2000/200
	});
});
