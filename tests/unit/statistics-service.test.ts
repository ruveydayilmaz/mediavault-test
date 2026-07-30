import { describe, it, expect } from "vitest";
import {
  computeStatistics,
  formatWatchTime,
  StatisticsService,
} from "../../src/services/statistics-service";
import { MediaType, MediaStatus } from "../../src/types/enums";

function makeMedia(partial: any): any {
  return {
    id: partial.id,
    tmdbId: 1,
    type: partial.type ?? MediaType.Movie,
    title: partial.title ?? "T",
    originalTitle: null,
    year: 2020,
    genres: [],
    runtime: partial.runtime ?? 100,
    posterPath: null,
    backdropPath: null,
    cast: [],
    crew: [],
    productionCompanies: [],
    language: null,
    country: null,
    synopsis: null,
    status: MediaStatus.Completed,
    notes: "",
    tags: [],
    averageRating: null,
    watchCount: 0,
    notePath: null,
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

describe("statistics-service: computeStatistics", () => {
  const movie1 = makeMedia({ id: "m1", type: MediaType.Movie, runtime: 120 });
  const movie2 = makeMedia({ id: "m2", type: MediaType.Movie, runtime: 90 });
  const show1 = makeMedia({ id: "s1", type: MediaType.TVShow, runtime: 30 });

  const sessions: any[] = [
    { id: "w1", mediaId: "m1" },
    { id: "w2", mediaId: "m1" },
    { id: "w3", mediaId: "m2" },
  ];

  const episodes: any[] = [
    { id: "e1", mediaId: "s1", runtime: 25 },
    { id: "e2", mediaId: "s1", runtime: 25 },
    { id: "e3", mediaId: "s1", runtime: 25 },
  ];

  const episodeProgress: any[] = [
    { episodeId: "e1", watched: true },
    { episodeId: "e2", watched: true },
    { episodeId: "e3", watched: false },
  ];

  it("counts distinct movies watched, not watch events", () => {
    const stats = computeStatistics({
      media: [movie1, movie2, show1],
      sessions,
      episodes,
      episodeProgress,
    });
    expect(stats.movieCount).toBe(2);
  });

  it("sums movie runtime per watch event, so rewatches count again", () => {
    const stats = computeStatistics({
      media: [movie1, movie2, show1],
      sessions,
      episodes,
      episodeProgress,
    });
    expect(stats.movieRuntimeMinutes).toBe(120 + 120 + 90);
  });

  it("counts only watched episodes", () => {
    const stats = computeStatistics({
      media: [movie1, movie2, show1],
      sessions,
      episodes,
      episodeProgress,
    });
    expect(stats.episodeCount).toBe(2);
  });

  it("sums episode runtime only for watched episodes", () => {
    const stats = computeStatistics({
      media: [movie1, movie2, show1],
      sessions,
      episodes,
      episodeProgress,
    });
    expect(stats.episodeRuntimeMinutes).toBe(50);
  });

  it("returns all zeros for an empty library, never NaN", () => {
    const stats = computeStatistics({
      media: [],
      sessions: [],
      episodes: [],
      episodeProgress: [],
    });
    expect(stats).toEqual({
      movieCount: 0,
      movieRuntimeMinutes: 0,
      episodeCount: 0,
      episodeRuntimeMinutes: 0,
    });
  });
});

describe("statistics-service: formatWatchTime", () => {
  it("formats zero as 0m", () => {
    expect(formatWatchTime(0)).toBe("0m");
  });

  it("formats minutes under an hour", () => {
    expect(formatWatchTime(45)).toBe("45m");
  });

  it("formats hours and minutes", () => {
    expect(formatWatchTime(125)).toBe("2h 5m");
  });

  it("matches the spec's exact '31d 4h' example", () => {
    expect(formatWatchTime(60 * 24 * 31 + 60 * 4)).toBe("31d 4h");
  });
});

describe("statistics-service: StatisticsService (async wrapper)", () => {
  it("computes fresh from storage on every call rather than a cached counter", async () => {
    let mediaStore: any[] = [];
    let sessionStore: any[] = [];
    const mockStorage: any = {
      media: { getAll: async () => mediaStore },
      watchSessions: { getAll: async () => sessionStore },
      episodes: { getAll: async () => [] },
      episodeProgress: { getAll: async () => [] },
    };

    const service = new StatisticsService(mockStorage);
    expect(await service.getMovieCount()).toBe(0);

    mediaStore = [makeMedia({ id: "m1", type: MediaType.Movie, runtime: 100 })];
    sessionStore = [{ id: "w1", mediaId: "m1" }];

    expect(await service.getMovieCount()).toBe(1);
    expect(await service.getMovieRuntime()).toBe(100);
  });
});
