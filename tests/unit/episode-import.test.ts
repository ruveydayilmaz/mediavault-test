import { describe, it, expect } from "vitest";
import {
  importEpisodesForShow,
  diffNewEpisodes,
  tmdbEpisodeToEpisodeInput,
} from "../../src/services/episode-import";

function makeMockStorage() {
  const episodeStore: any[] = [];
  const storage: any = {
    episodes: {
      findByMediaId: async (mediaId: string) =>
        episodeStore.filter((e) => e.mediaId === mediaId),
      create: async (input: any) => {
        const rec = { id: "ep" + episodeStore.length, ...input };
        episodeStore.push(rec);
        return rec;
      },
    },
    media: {
      update: async (_id: string, _patch: any) => null,
    },
  };
  return { storage, episodeStore };
}

const mockTmdb: any = {
  getTV: async () => ({
    seasons: [
      {
        seasonNumber: 1,
        episodeCount: 2,
        name: "Season 1",
        airDate: "2020-01-01",
      },
    ],
  }),
  getEpisodes: async () => [
    {
      tmdbEpisodeId: 1,
      seasonNumber: 1,
      episodeNumber: 1,
      title: "Pilot",
      runtime: 42,
      airDate: "2020-01-01",
      synopsis: "d",
      thumbnailPath: null,
      tmdbRating: 8,
    },
    {
      tmdbEpisodeId: 2,
      seasonNumber: 1,
      episodeNumber: 2,
      title: "Ep 2",
      runtime: 41,
      airDate: "2020-01-08",
      synopsis: "d",
      thumbnailPath: null,
      tmdbRating: 8,
    },
  ],
};

describe("episode-import: idempotency", () => {
  it("imports all episodes on first run", async () => {
    const { storage, episodeStore } = makeMockStorage();
    const result = await importEpisodesForShow(storage, mockTmdb, {
      id: "m1",
      tmdbId: 999,
    } as any);

    expect(result.episodesAdded).toBe(2);
    expect(episodeStore).toHaveLength(2);
  });

  it("re-running the import adds zero new episodes (no duplicates)", async () => {
    const { storage, episodeStore } = makeMockStorage();
    await importEpisodesForShow(storage, mockTmdb, {
      id: "m1",
      tmdbId: 999,
    } as any);

    const second = await importEpisodesForShow(storage, mockTmdb, {
      id: "m1",
      tmdbId: 999,
    } as any);
    expect(second.episodesAdded).toBe(0);
    expect(episodeStore).toHaveLength(2);
  });

  it("diffNewEpisodes only returns episodes not already present by season+episode number", () => {
    const ep1 = tmdbEpisodeToEpisodeInput("m1", {
      tmdbEpisodeId: 1,
      seasonNumber: 1,
      episodeNumber: 1,
      title: "Pilot",
      runtime: 42,
      airDate: "2020-01-01",
      synopsis: "d",
      thumbnailPath: null,
      tmdbRating: 8,
    });
    const existing = [
      {
        id: "e1",
        mediaId: "m1",
        tmdbEpisodeId: 1,
        seasonNumber: 1,
        episodeNumber: 1,
        title: "Pilot",
        runtime: 42,
        airDate: "2020-01-01",
        synopsis: "d",
        thumbnailPath: null,
        tmdbRating: 8,
      },
    ];
    const incoming = [ep1];

    expect(diffNewEpisodes(incoming, existing)).toHaveLength(0);
  });
});
