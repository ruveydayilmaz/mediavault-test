import { describe, it, expect } from "vitest";
import {
  buildMediaItemFromTMDB,
  addMediaFromTMDB,
} from "../../src/services/media-import";
import { MediaStatus } from "../../src/types/enums";
import type { TMDBNormalizedDetails } from "../../src/types/tmdb";

const details: TMDBNormalizedDetails = {
  tmdbId: 157336,
  mediaKind: "movie",
  title: "Interstellar",
  originalTitle: "Interstellar",
  year: 2014,
  runtime: 169,
  genres: ["Sci-Fi"],
  posterPath: "/abc.jpg",
  backdropPath: "/def.jpg",
  overview: "desc",
  language: "en",
  country: "US",
  productionCompanies: [],
  cast: [],
  crew: [],
};

function makeMockStorageAndTmdb() {
  const savedItems: any[] = [];
  const storage: any = {
    media: {
      findByTmdbId: async (tmdbId: number, type: string) =>
        savedItems.find((m) => m.tmdbId === tmdbId && m.type === type) ?? null,
      save: async (m: any) => {
        savedItems.push(m);
        return m;
      },
    },
  };
  const tmdb: any = {
    getMovie: async () => details,
    getTV: async () => {
      throw new Error("should not be called for a movie");
    },
  };
  return { storage, tmdb, savedItems };
}

describe("media-import", () => {
  it("builds a MediaItem from normalized TMDB details with sensible defaults", () => {
    const item = buildMediaItemFromTMDB(details);
    expect(item.title).toBe("Interstellar");
    expect(item.status).toBe(MediaStatus.PlanToWatch);
    expect(item.watchCount).toBe(0);
    expect(item.tags).toEqual([]);
  });

  it("does not create a duplicate MediaItem when the same tmdbId+type is added twice", async () => {
    const { storage, tmdb, savedItems } = makeMockStorageAndTmdb();

    const first = await addMediaFromTMDB(storage, tmdb, 157336, "movie");
    expect(first.alreadyExisted).toBe(false);

    const second = await addMediaFromTMDB(storage, tmdb, 157336, "movie");
    expect(second.alreadyExisted).toBe(true);
    expect(second.mediaItem.id).toBe(first.mediaItem.id);

    expect(savedItems).toHaveLength(1);
  });
});
