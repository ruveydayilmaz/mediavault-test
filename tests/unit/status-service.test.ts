import { describe, it, expect } from "vitest";
import {
  calculateMediaStatus,
  recalculateAndPersistStatus,
} from "../../src/services/status-service";
import {
  markEpisodeWatched,
  markSeasonWatched,
} from "../../src/services/episode-status-sync";
import { MediaStatus, MediaType } from "../../src/types/enums";
import type { WatchSession } from "../../src/models/review";
import type { Episode, EpisodeProgress } from "../../src/models/episode";

function makeEpisode(partial: Partial<Episode>): Episode {
  return {
    id: "e1",
    mediaId: "m1",
    tmdbEpisodeId: 1,
    seasonNumber: 1,
    episodeNumber: 1,
    title: "Ep",
    runtime: 30,
    airDate: "2024-01-01",
    synopsis: null,
    thumbnailPath: null,
    tmdbRating: null,
    ...partial,
  };
}

function makeProgress(episodeId: string, watched: boolean): EpisodeProgress {
  return {
    id: "p-" + episodeId,
    mediaId: "m1",
    episodeId,
    seasonNumber: 1,
    episodeNumber: 1,
    watched,
    watchedDate: watched ? "2024-01-02" : null,
    rating: null,
    review: null,
    isFavorite: false,
    comfortNote: null,
    updatedAt: "",
  };
}

const NOW = new Date("2024-06-01T00:00:00Z");

describe("status-service: calculateMediaStatus (pure)", () => {
  describe("movies", () => {
    it("is Plan to Watch with no watch sessions", () => {
      const status = calculateMediaStatus(
        {
          type: MediaType.Movie,
          status: MediaStatus.PlanToWatch,
          tvStatus: null,
        },
        { sessions: [], episodes: [], episodeProgress: [] },
        NOW,
      );
      expect(status).toBe(MediaStatus.PlanToWatch);
    });

    it("is Finished after one watch session", () => {
      const status = calculateMediaStatus(
        {
          type: MediaType.Movie,
          status: MediaStatus.PlanToWatch,
          tvStatus: null,
        },
        {
          sessions: [{ id: "s1" } as WatchSession],
          episodes: [],
          episodeProgress: [],
        },
        NOW,
      );
      expect(status).toBe(MediaStatus.Completed);
    });

    it("stays Finished after a second watch session (rewatch)", () => {
      const status = calculateMediaStatus(
        {
          type: MediaType.Movie,
          status: MediaStatus.Completed,
          tvStatus: null,
        },
        {
          sessions: [
            { id: "s1" } as WatchSession,
            { id: "s2" } as WatchSession,
          ],
          episodes: [],
          episodeProgress: [],
        },
        NOW,
      );
      expect(status).toBe(MediaStatus.Completed);
    });

    it("reverts to Plan to Watch if all watch sessions are removed", () => {
      const status = calculateMediaStatus(
        {
          type: MediaType.Movie,
          status: MediaStatus.Completed,
          tvStatus: null,
        },
        { sessions: [], episodes: [], episodeProgress: [] },
        NOW,
      );
      expect(status).toBe(MediaStatus.PlanToWatch);
    });
  });

  describe("TV shows", () => {
    const episodes = [
      makeEpisode({ id: "e1", episodeNumber: 1, airDate: "2024-01-01" }),
      makeEpisode({ id: "e2", episodeNumber: 2, airDate: "2024-01-08" }),
    ];

    it("is Plan to Watch with no watched episodes", () => {
      const status = calculateMediaStatus(
        {
          type: MediaType.TVShow,
          status: MediaStatus.PlanToWatch,
          tvStatus: "Returning Series",
        },
        { sessions: [], episodes, episodeProgress: [] },
        NOW,
      );
      expect(status).toBe(MediaStatus.PlanToWatch);
    });

    it("is Currently Watching after the first episode", () => {
      const status = calculateMediaStatus(
        {
          type: MediaType.TVShow,
          status: MediaStatus.PlanToWatch,
          tvStatus: "Returning Series",
        },
        { sessions: [], episodes, episodeProgress: [makeProgress("e1", true)] },
        NOW,
      );
      expect(status).toBe(MediaStatus.Watching);
    });

    it("stays Currently Watching partway through the series", () => {
      const manyEpisodes = [
        episodes[0],
        episodes[1],
        makeEpisode({ id: "e3", episodeNumber: 3, airDate: "2024-01-15" }),
      ];
      const status = calculateMediaStatus(
        {
          type: MediaType.TVShow,
          status: MediaStatus.Watching,
          tvStatus: "Returning Series",
        },
        {
          sessions: [],
          episodes: manyEpisodes,
          episodeProgress: [makeProgress("e1", true), makeProgress("e2", true)],
        },
        NOW,
      );
      expect(status).toBe(MediaStatus.Watching);
    });

    it("is Waiting for New Season when all released episodes are watched and TMDB says the show is ongoing", () => {
      const status = calculateMediaStatus(
        {
          type: MediaType.TVShow,
          status: MediaStatus.Watching,
          tvStatus: "Returning Series",
        },
        {
          sessions: [],
          episodes,
          episodeProgress: [makeProgress("e1", true), makeProgress("e2", true)],
        },
        NOW,
      );
      expect(status).toBe(MediaStatus.WaitingForNewSeason);
    });

    it("is Finished when all released episodes are watched and TMDB says the show has ended", () => {
      const status = calculateMediaStatus(
        {
          type: MediaType.TVShow,
          status: MediaStatus.Watching,
          tvStatus: "Ended",
        },
        {
          sessions: [],
          episodes,
          episodeProgress: [makeProgress("e1", true), makeProgress("e2", true)],
        },
        NOW,
      );
      expect(status).toBe(MediaStatus.Completed);
    });

    it("is Finished when all released episodes are watched and TMDB says Canceled", () => {
      const status = calculateMediaStatus(
        {
          type: MediaType.TVShow,
          status: MediaStatus.Watching,
          tvStatus: "Canceled",
        },
        {
          sessions: [],
          episodes,
          episodeProgress: [makeProgress("e1", true), makeProgress("e2", true)],
        },
        NOW,
      );
      expect(status).toBe(MediaStatus.Completed);
    });

    it("treats an already-scheduled future episode as Up To Date, not Waiting for New Season", () => {
      const withUnaired = [
        ...episodes,
        makeEpisode({ id: "e3", episodeNumber: 3, airDate: "2099-01-01" }),
      ];
      const status = calculateMediaStatus(
        {
          type: MediaType.TVShow,
          status: MediaStatus.Watching,
          tvStatus: "Returning Series",
        },
        {
          sessions: [],
          episodes: withUnaired,
          episodeProgress: [makeProgress("e1", true), makeProgress("e2", true)],
        },
        NOW,
      );
      expect(status).toBe(MediaStatus.UpToDate);
    });
  });

  describe("manual overrides", () => {
    it("never overwrites a manually-set Dropped status, even with full watch progress", () => {
      const episodes = [makeEpisode({ id: "e1" })];
      const status = calculateMediaStatus(
        {
          type: MediaType.TVShow,
          status: MediaStatus.Dropped,
          tvStatus: "Ended",
        },
        { sessions: [], episodes, episodeProgress: [makeProgress("e1", true)] },
        NOW,
      );
      expect(status).toBe(MediaStatus.Dropped);
    });

    it("never overwrites a manually-set On Hold status", () => {
      const status = calculateMediaStatus(
        { type: MediaType.Movie, status: MediaStatus.OnHold, tvStatus: null },
        {
          sessions: [{ id: "s1" } as WatchSession],
          episodes: [],
          episodeProgress: [],
        },
        NOW,
      );
      expect(status).toBe(MediaStatus.OnHold);
    });

    it("never overwrites a manually-set Watch Later status, even with watch sessions logged", () => {
      const status = calculateMediaStatus(
        {
          type: MediaType.Movie,
          status: MediaStatus.WatchLater,
          tvStatus: null,
        },
        {
          sessions: [{ id: "s1" } as WatchSession],
          episodes: [],
          episodeProgress: [],
        },
        NOW,
      );
      expect(status).toBe(MediaStatus.WatchLater);
    });
  });
});

function makeMockStorage(initialMedia: any) {
  const mediaStore = [initialMedia];
  const sessionStore: any[] = [];
  const episodeStore: any[] = [];
  const progressStore: any[] = [];

  const storage: any = {
    media: {
      findById: async (id: string) =>
        mediaStore.find((m) => m.id === id) ?? null,
      update: async (id: string, patch: any) => {
        const idx = mediaStore.findIndex((m) => m.id === id);
        mediaStore[idx] = { ...mediaStore[idx], ...patch };
        return mediaStore[idx];
      },
    },
    watchSessions: {
      findByMediaId: async (mediaId: string) =>
        sessionStore.filter((s) => s.mediaId === mediaId),
      findWhere: async (pred: (s: any) => boolean) => sessionStore.filter(pred),
      save: async (s: any) => {
        sessionStore.push(s);
        return s;
      },
    },
    episodes: {
      findByMediaId: async (mediaId: string) =>
        episodeStore.filter((e) => e.mediaId === mediaId),
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
    episodeProgress: {
      findByMediaId: async (mediaId: string) =>
        progressStore.filter((p) => p.mediaId === mediaId),
      findByEpisodeId: async (episodeId: string) =>
        progressStore.find((p) => p.episodeId === episodeId) ?? null,
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
          comfortNote: null,
        };
        progressStore.push(rec);
        return rec;
      },
      markSeasonWatched: async (episodes: any[], watched: boolean) => {
        const results = [];
        for (const ep of episodes) {
          let existing = progressStore.find((p) => p.episodeId === ep.id);
          if (existing) {
            existing.watched = watched;
          } else {
            const rec = {
              id: "pg" + progressStore.length,
              mediaId: ep.mediaId,
              episodeId: ep.id,
              seasonNumber: ep.seasonNumber,
              episodeNumber: ep.episodeNumber,
              watched,
              watchedDate: watched ? "2024-01-02" : null,
              rating: null,
              review: null,
              isFavorite: false,
              comfortNote: null,
            };
            progressStore.push(rec);
          }
          results.push(progressStore.find((p) => p.episodeId === ep.id));
        }
        return results;
      },
    },
  };

  return { storage, mediaStore, episodeStore, progressStore };
}

describe("status-service: recalculateAndPersistStatus + episode-status-sync integration", () => {
  it("marking a single episode watched recalculates and persists the show's status", async () => {
    const { storage, mediaStore, episodeStore } = makeMockStorage({
      id: "m1",
      type: MediaType.TVShow,
      status: MediaStatus.PlanToWatch,
      tvStatus: "Returning Series",
    });
    const ep1 = makeEpisode({ id: "e1", mediaId: "m1", episodeNumber: 1 });
    const ep2 = makeEpisode({ id: "e2", mediaId: "m1", episodeNumber: 2 });
    episodeStore.push(ep1, ep2);

    await markEpisodeWatched(storage, ep1, true);

    expect(mediaStore[0].status).toBe(MediaStatus.Watching);
  });

  it("marking a full season watched recalculates status once for the batch", async () => {
    const { storage, mediaStore, episodeStore } = makeMockStorage({
      id: "m1",
      type: MediaType.TVShow,
      status: MediaStatus.PlanToWatch,
      tvStatus: "Ended",
    });
    const ep1 = makeEpisode({ id: "e1", mediaId: "m1", episodeNumber: 1 });
    const ep2 = makeEpisode({ id: "e2", mediaId: "m1", episodeNumber: 2 });
    episodeStore.push(ep1, ep2);

    await markSeasonWatched(storage, [ep1, ep2], true);

    expect(mediaStore[0].status).toBe(MediaStatus.Completed);
  });

  it("does not write to the repository when the recalculated status is unchanged", async () => {
    const { storage, mediaStore } = makeMockStorage({
      id: "m1",
      type: MediaType.Movie,
      status: MediaStatus.PlanToWatch,
      tvStatus: null,
    });

    const originalUpdate = storage.media.update;
    let updateCalls = 0;
    storage.media.update = async (...args: any[]) => {
      updateCalls++;
      return originalUpdate(...args);
    };

    await recalculateAndPersistStatus(storage, "m1");
    expect(updateCalls).toBe(0);
    expect(mediaStore[0].status).toBe(MediaStatus.PlanToWatch);
  });
});
