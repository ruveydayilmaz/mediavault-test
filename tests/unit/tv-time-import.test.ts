import { describe, it, expect } from "vitest";
import { runImport } from "../../src/services/importer/tvtime/manager";
import { previewBundle } from "../../src/services/importer/tvtime/preview";
import { commitBundle } from "../../src/services/importer/tvtime/commit";
import { MediaType } from "../../src/types/enums";
import { parseGdprArchive } from "../../src/services/importer/tvtime/gdpr";

const SERIES_JSON = JSON.stringify({
  uuid: "fff2f8ad-6303-4339-bade-e8775751ea1f",
  id: { tvdb: 366460, imdb: null },
  created_at: "2020-09-15T19:29:07Z",
  title: "BNA",
  status: "up_to_date",
  is_favorite: false,
  seasons: [
    {
      number: 1,
      is_specials: false,
      episodes: [
        {
          id: { tvdb: 7489493, imdb: null },
          number: 1,
          name: "Runaway Raccoon",
          special: false,
          is_watched: true,
          watched_at: "2020-09-16 17:10:59",
          rewatch_count: 0,
          watched_count: 1,
        },
        {
          id: { tvdb: 7642599, imdb: null },
          number: 2,
          name: "Rabbit Town",
          special: false,
          is_watched: true,
          watched_at: "2020-09-16 17:11:30",
          rewatch_count: 0,
          watched_count: 1,
        },
      ],
    },
  ],
});

const MOVIE_JSON = JSON.stringify({
  id: { tvdb: 950, imdb: "tt1735898" },
  uuid: "ff46daba-4be9-440c-aabc-eae7bb69bdd5",
  created_at: "2019-10-04T10:28:13Z",
  title: "Snow White and the Huntsman",
  year: 2012,
  watched_at: "2019-10-04T10:28:13Z",
  is_watched: true,
  is_favorite: false,
  rewatch_count: 0,
});

const LIST_JSON = JSON.stringify([
  {
    id: "b6f16b82-0a7a-43a8-99af-a813ed5910ca",
    name: "Costume C-Drama",
    description: "A list of historical C-dramas.",
    is_public: true,
    created_at: "2024-11-04T10:17:38Z",
    items: [
      {
        type: "series",
        tvdb_id: 445966,
        name: "Blossom (2024)",
        custom_order: 0,
      },
      {
        type: "series",
        tvdb_id: 442122,
        name: "Flourished Peony",
        custom_order: 1,
      },
    ],
  },
]);

const FOLLOWED_SHOWS_CSV =
  "nb_episodes_seen,tv_show_name,user_id,tv_show_id,is_followed,is_favorited\n" +
  "38,Neon Genesis Evangelion,29317850,70350,1,0\n" +
  "0,Cardcaptor Sakura,29317850,70668,1,0\n" +
  "61,Avatar: The Last Airbender,29317850,74852,1,1\n";

describe("TV Time importer: format detection", () => {
  it("detects a JSON series export", () => {
    const result = runImport(SERIES_JSON);
    expect(result.detection.format).toBe("json");
    expect(result.detection.category).toBe("json_series");
    expect(result.detection.label).toBe("TV Show Export");
  });

  it("detects a JSON movie export", () => {
    const result = runImport(MOVIE_JSON);
    expect(result.detection.format).toBe("json");
    expect(result.detection.category).toBe("json_movie");
  });

  it("detects a JSON custom list and parses its items into a ListImport", () => {
    const result = runImport(LIST_JSON);
    expect(result.detection.category).toBe("json_list");
    expect(result.unsupported).toBe(false);
    expect(result.bundle.lists).toHaveLength(1);
    expect(result.bundle.lists[0].name).toBe("Costume C-Drama");
    expect(result.bundle.lists[0].items).toHaveLength(2);
    expect(result.bundle.watches).toHaveLength(0);
    expect(result.bundle.favorites).toHaveLength(0);
  });

  it("detects the followed-shows CSV by its exact column set", () => {
    const result = runImport(FOLLOWED_SHOWS_CSV);
    expect(result.detection.format).toBe("csv");
    expect(result.detection.category).toBe("csv_followed_shows");
    expect(result.unsupported).toBe(false);
  });
});

describe("TV Time importer: parsing real sample shapes", () => {
  it("parses every watched episode from the series JSON, with season/episode numbers and watch dates", () => {
    const result = runImport(SERIES_JSON);
    expect(result.bundle.watches).toHaveLength(2);
    expect(result.bundle.watches[0]).toMatchObject({
      kind: "series",
      title: "BNA",
      seasonNumber: 1,
      episodeNumber: 1,
      episodeTitle: "Runaway Raccoon",
    });
    expect(result.bundle.watches[0].ids.tvdbId).toBe(366460);
  });

  it("parses the movie JSON into a single watch with correct external ids", () => {
    const result = runImport(MOVIE_JSON);
    expect(result.bundle.watches).toHaveLength(1);
    expect(result.bundle.watches[0]).toMatchObject({
      kind: "movie",
      title: "Snow White and the Huntsman",
      year: 2012,
    });
    expect(result.bundle.watches[0].ids.imdbId).toBe("tt1735898");
  });

  it("gracefully handles a null watched_at on a movie by falling back to created_at instead of throwing", () => {
    const raw = JSON.parse(MOVIE_JSON);
    raw.watched_at = null;
    const result = runImport(JSON.stringify(raw));
    expect(result.bundle.watches).toHaveLength(1);
    expect(result.bundle.watches[0].watchedAt).toBe(raw.created_at);
  });

  it("gracefully handles both watched_at and created_at missing, without throwing", () => {
    const raw = JSON.parse(MOVIE_JSON);
    raw.watched_at = null;
    delete raw.created_at;
    const result = runImport(JSON.stringify(raw));
    expect(result.bundle.watches).toHaveLength(1);
    expect(result.bundle.watches[0].watchedAt).toBeNull();
  });

  it("imports only is_favorited=1 rows from the followed-shows CSV, and warns about ambiguous episode counts instead of fabricating watches", () => {
    const result = runImport(FOLLOWED_SHOWS_CSV);
    expect(result.bundle.favorites).toHaveLength(1);
    expect(result.bundle.favorites[0].title).toBe("Avatar: The Last Airbender");
    expect(result.bundle.watches).toHaveLength(0);
    expect(result.bundle.warnings.length).toBeGreaterThan(0);
  });
});

describe("TV Time GDPR archive parser", () => {
  it("uses both tracking generations, preserves movie metadata, and avoids duplicate latest-state rows", () => {
    const trackingHeader =
      "user_id,type,uuid,type-uuid-n,series_name,watch_count,created_at,updated_at,series_id,watches,release_date_range_key,follow_date_range_key,entity_type,alpha_range_key,release_date,runtime,movie_name,rewatch_count,episode_id,series_uuid,episode_number,season_number,watch_date,watched_episode_range_key,total_series_runtime,total_movies_runtime,watch_date_range_key,country,unitarian,bulk_type";
    const trackingRow = (values: Record<string, string>) =>
      trackingHeader
        .split(",")
        .map((column) => values[column] ?? "")
        .join(",");
    const parsed = parseGdprArchive(
      new Map([
        [
          "tracking-prod-records-v2.csv",
          [
            "user_id,runtime,ep_id,season_number,created_at,s_no,s_id,episode_id,episode_number,bulk_type,ep_no,series_name,gsi,key,total_series_runtime,total_movies_runtime,movie_watch_count,ep_watch_count,series_follow_count,updated_at,is_followed,is_for_later,is_archived,uuid,most_recent_ep_watched,followed_at,rewatch_count,is_unitary,is_special",
            "1,1440,10,1,2024-01-02 03:04:05,1,123,10,2,season,2,Castle (2009),,,,,,,,,,,,series-uuid,,,,,",
          ].join("\n"),
        ],
        [
          "tracking-prod-records.csv",
          [
            trackingHeader,
            trackingRow({
              type: "watch",
              uuid: "event",
              series_name: "Castle",
              created_at: "2024-01-03",
              series_id: "123",
              entity_type: "episode",
              episode_id: "11",
              series_uuid: "series-uuid",
              episode_number: "3",
              season_number: "1",
              watch_date: "1704240000",
              country: "us",
            }),
            trackingRow({
              type: "watch",
              uuid: "event2",
              created_at: "2024-01-04",
              release_date: "2023-05-06",
              runtime: "7200",
              movie_name: "Halloween",
              watch_date: "1704326400",
              country: "us",
            }),
          ].join("\n"),
        ],
        [
          "show_seen_episode_latest.csv",
          "created_at,updated_at,tv_show_name,user_id,tv_show_id,episode_id\n2024-01-04,2024-01-04,Castle (2009),1,123,10",
        ],
        [
          "rewatched_episode.csv",
          "tv_show_name,episode_season_number,episode_number,user_id,episode_id,cpt,created_at,updated_at\nCastle (2009),1,2,1,10,1,2024-01-05,2024-01-05",
        ],
      ]),
    );

    const v2 = parsed.get("tracking-prod-records-v2.csv")!;
    expect(v2.watches[0]).toMatchObject({
      title: "Castle",
      year: 2009,
      seasonNumber: 1,
      episodeNumber: 2,
      watchedAt: "2024-01-02",
    });
    expect(parsed.get("tracking-prod-records.csv")!.watches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "series",
          title: "Castle",
          episodeNumber: 3,
          watchedAt: "2024-01-03",
        }),
        expect.objectContaining({
          kind: "movie",
          title: "Halloween",
          year: 2023,
          watchedAt: "2024-01-04",
          match: expect.objectContaining({
            runtimeSeconds: 7200,
            country: "us",
          }),
        }),
      ]),
    );
    expect(parsed.get("show_seen_episode_latest.csv")).toBeUndefined();
    expect(parsed.get("rewatched_episode.csv")?.watches).toHaveLength(1);
  });
});

function makeMockStorage() {
  const mediaStore: any[] = [];
  const sessionStore: any[] = [];
  const episodeStore: any[] = [];
  const progressStore: any[] = [];

  const storage: any = {
    media: {
      getAll: async () => mediaStore,
      findById: async (id: string) =>
        mediaStore.find((m) => m.id === id) ?? null,
      findByTvdbId: async (tvdbId: number) =>
        mediaStore.find((m) => m.tvdbId === tvdbId) ?? null,
      findByImdbId: async (imdbId: string) =>
        mediaStore.find((m) => m.imdbId === imdbId) ?? null,
      findByTvTimeUuid: async (uuid: string) =>
        mediaStore.find((m) => m.tvTimeUuid === uuid) ?? null,
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
      findByMediaId: async (mediaId: string) =>
        sessionStore.filter((s) => s.mediaId === mediaId),
      findWhere: async (pred: any) => sessionStore.filter(pred),
      save: async (s: any) => {
        sessionStore.push(s);
        return s;
      },
      update: async (id: string, patch: any) => {
        const idx = sessionStore.findIndex((s) => s.id === id);
        if (idx === -1) return null;
        sessionStore[idx] = { ...sessionStore[idx], ...patch };
        return sessionStore[idx];
      },
    },
    episodes: {
      findByMediaId: async (mediaId: string) =>
        episodeStore.filter((e) => e.mediaId === mediaId),
      create: async (input: any) => {
        const rec = { id: "ep" + episodeStore.length, ...input };
        episodeStore.push(rec);
        return rec;
      },
    },
    episodeProgress: {
      findByMediaId: async (mediaId: string) =>
        progressStore.filter((p) => p.mediaId === mediaId),
      findByEpisodeId: async (episodeId: string) =>
        progressStore.find((p) => p.episodeId === episodeId) ?? null,
      create: async (input: any) => {
        const rec = { id: "pg" + progressStore.length, ...input };
        progressStore.push(rec);
        return rec;
      },
      update: async (id: string, patch: any) => {
        const idx = progressStore.findIndex((p) => p.id === id);
        if (idx === -1) return null;
        progressStore[idx] = { ...progressStore[idx], ...patch };
        return progressStore[idx];
      },
      markWatched: async (
        episode: any,
        watched: boolean,
        watchedDate?: string,
      ) => {
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
          seasonNumber: episode.seasonNumber,
          episodeNumber: episode.episodeNumber,
          watched,
          watchedDate: watchedDate ?? null,
          rating: null,
          review: null,
          isFavorite: false,
          liked: false,
          likedAt: null,
          comfortNote: null,
        };
        progressStore.push(rec);
        return rec;
      },
    },
    movieProgress: {
      findByMediaId: async () => null,
    },
    episodeWatches: {
      create: async (input: any) => ({
        id: "ew" + Math.random(),
        createdAt: "",
        updatedAt: "",
        ...input,
      }),
    },
  };

  return { storage, mediaStore, sessionStore, episodeStore, progressStore };
}

const mockTmdb: any = {
  getMovie: async (id: number) => ({
    tmdbId: id,
    mediaKind: "movie",
    title: "Snow White and the Huntsman",
    originalTitle: "Snow White and the Huntsman",
    year: 2012,
    runtime: 127,
    genres: ["Fantasy"],
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
    title: "BNA",
    originalTitle: "BNA",
    year: 2020,
    runtime: 24,
    genres: ["Animation"],
    posterPath: null,
    backdropPath: null,
    overview: "",
    language: "ja",
    country: "JP",
    productionCompanies: [],
    cast: [],
    crew: [],
    seasons: [
      {
        seasonNumber: 1,
        episodeCount: 12,
        name: "Season 1",
        airDate: "2020-09-14",
      },
    ],
  }),
  getEpisodes: async () => [
    {
      tmdbEpisodeId: 1,
      seasonNumber: 1,
      episodeNumber: 1,
      title: "Runaway Raccoon",
      runtime: 24,
      airDate: "2020-09-14",
      synopsis: null,
      thumbnailPath: null,
      tmdbRating: null,
    },
    {
      tmdbEpisodeId: 2,
      seasonNumber: 1,
      episodeNumber: 2,
      title: "Rabbit Town",
      runtime: 24,
      airDate: "2020-09-21",
      synopsis: null,
      thumbnailPath: null,
      tmdbRating: null,
    },
  ],
  searchMovies: async () => ({
    items: [
      {
        tmdbId: 55555,
        mediaKind: "movie",
        title: "Snow White and the Huntsman",
        year: 2012,
        posterPath: null,
        backdropPath: null,
        overview: "",
      },
    ],
    total: 1,
    page: 1,
    pageSize: 1,
  }),
  searchShows: async () => ({
    items: [
      {
        tmdbId: 66666,
        mediaKind: "tv",
        title: "BNA",
        year: 2020,
        posterPath: null,
        backdropPath: null,
        overview: "",
      },
    ],
    total: 1,
    page: 1,
    pageSize: 1,
  }),
};

describe("TV Time importer: full commit pipeline", () => {
  it("imports the movie JSON end-to-end: creates the media item and a watch session", async () => {
    const { storage, mediaStore, sessionStore } = makeMockStorage();
    const result = runImport(MOVIE_JSON);

    const report = await commitBundle(storage, mockTmdb, result.bundle);

    expect(report.moviesImported).toBe(1);
    expect(mediaStore).toHaveLength(1);
    expect(mediaStore[0].imdbId).toBe("tt1735898");
    expect(sessionStore).toHaveLength(1);
  });

  it("imports the series JSON end-to-end: creates the show, imports episode metadata, and marks watched episodes", async () => {
    const { storage, mediaStore, episodeStore, progressStore } =
      makeMockStorage();
    const result = runImport(SERIES_JSON);

    const report = await commitBundle(storage, mockTmdb, result.bundle);

    expect(report.showsImported).toBe(1);
    expect(mediaStore[0].tvdbId).toBe(366460);
    expect(episodeStore.length).toBeGreaterThanOrEqual(2);
    expect(report.episodesUpdated).toBe(2);
    expect(progressStore.filter((p) => p.watched)).toHaveLength(2);
  });

  it("matches an existing media item by TVDB id instead of creating a duplicate on re-import", async () => {
    const { storage, mediaStore, sessionStore } = makeMockStorage();
    const first = await commitBundle(
      storage,
      mockTmdb,
      runImport(MOVIE_JSON).bundle,
    );
    expect(first.moviesImported).toBe(1);

    const second = await commitBundle(
      storage,
      mockTmdb,
      runImport(MOVIE_JSON).bundle,
    );
    expect(second.moviesImported).toBe(0);
    expect(second.duplicatesMerged).toBeGreaterThan(0);
    expect(mediaStore).toHaveLength(1);
    expect(sessionStore).toHaveLength(2);
  });

  it("never overwrites an existing rating when importing a rating for an already-rated watch", async () => {
    const { storage, mediaStore, sessionStore } = makeMockStorage();
    mediaStore.push({
      id: "m1",
      tmdbId: 950,
      type: MediaType.Movie,
      title: "Snow White and the Huntsman",
      year: 2012,
      tvdbId: null,
      imdbId: null,
      tvTimeUuid: null,
    });
    sessionStore.push({
      id: "s1",
      mediaId: "m1",
      watchDate: "2019-10-04",
      rating: 8,
      review: "",
      externalSource: null,
      externalRef: null,
    });

    const bundle: any = {
      watches: [],
      reviews: [],
      likes: [],
      ratings: [
        {
          kind: "movie",
          ids: {},
          title: "Snow White and the Huntsman",
          year: 2012,
          rating: 10,
          ratedAt: null,
        },
      ],
      favorites: [],
      warnings: [],
      lists: [],
    };

    const report = await commitBundle(storage, mockTmdb, bundle);
    expect(sessionStore[0].rating).toBe(8);
    expect(report.skipped).toBeGreaterThan(0);
  });

  it("produces a preview summary distinguishing existing vs new titles without writing anything", async () => {
    const { storage, mediaStore } = makeMockStorage();
    mediaStore.push({
      id: "m1",
      tmdbId: 950,
      imdbId: "tt1735898",
      type: MediaType.Movie,
      title: "Snow White and the Huntsman",
      year: 2012,
      tvdbId: null,
      tvTimeUuid: null,
    });

    const result = runImport(MOVIE_JSON);
    const preview = await previewBundle(storage, result.bundle);

    expect(preview.existingTitles).toBe(1);
    expect(preview.newTitles).toBe(0);
    expect(mediaStore).toHaveLength(1);
  });

  it("reports progress across all stages, reaching the total by the end", async () => {
    const { storage } = makeMockStorage();
    const bundle: any = {
      watches: [
        {
          kind: "movie",
          ids: {},
          title: "Snow White and the Huntsman",
          year: 2012,
          watchedAt: null,
          rewatchCount: 0,
        },
      ],
      reviews: [],
      likes: [],
      ratings: [
        {
          kind: "movie",
          ids: {},
          title: "Snow White and the Huntsman",
          year: 2012,
          rating: 9,
          ratedAt: null,
        },
      ],
      favorites: [],
      warnings: [],
      lists: [],
    };

    const progressCalls: { done: number; total: number; stage: string }[] = [];
    await commitBundle(storage, mockTmdb, bundle, (done, total, stage) => {
      progressCalls.push({ done, total, stage });
    });

    expect(progressCalls.length).toBe(2);
    expect(progressCalls[0].total).toBe(2);
    expect(progressCalls[progressCalls.length - 1].done).toBe(2);
    expect(progressCalls.map((c) => c.stage)).toEqual([
      "Watch history",
      "Ratings",
    ]);
  });
});
