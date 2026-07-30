import { describe, it, expect } from "vitest";
import {
  addWatchSession,
  updateWatchSession,
  deleteWatchSession,
} from "../../src/services/watch-session-service";
import {
  getRatingEvolution,
  getFirstSession,
  getLatestSession,
} from "../../src/services/review-logic";
import type { WatchSession } from "../../src/models/review";

function makeMockStorage() {
  const mediaStore: any[] = [
    {
      id: "m1",
      type: "movie",
      status: "plan_to_watch",
      tvStatus: null,
      averageRating: null,
      watchCount: 0,
    },
  ];
  const sessionStore: WatchSession[] = [];

  const storage: any = {
    watchSessions: {
      findWhere: async (pred: (s: WatchSession) => boolean) =>
        sessionStore.filter(pred),
      findByMediaId: async (mediaId: string) =>
        sessionStore.filter((s) => s.mediaId === mediaId),
      findById: async (id: string) =>
        sessionStore.find((s) => s.id === id) ?? null,
      save: async (s: WatchSession) => {
        sessionStore.push(s);
        return s;
      },
      update: async (id: string, patch: Partial<WatchSession>) => {
        const idx = sessionStore.findIndex((s) => s.id === id);
        if (idx === -1) return null;
        sessionStore[idx] = { ...sessionStore[idx], ...patch };
        return sessionStore[idx];
      },
      delete: async (id: string) => {
        const idx = sessionStore.findIndex((s) => s.id === id);
        if (idx === -1) return false;
        sessionStore.splice(idx, 1);
        return true;
      },
    },
    media: {
      findById: async (id: string) =>
        mediaStore.find((m) => m.id === id) ?? null,
      update: async (id: string, patch: any) => {
        const idx = mediaStore.findIndex((m) => m.id === id);
        mediaStore[idx] = { ...mediaStore[idx], ...patch };
        return mediaStore[idx];
      },
    },
    episodes: {
      findByMediaId: async () => [],
    },
    episodeProgress: {
      findByMediaId: async () => [],
    },
    movieProgress: {
      findByMediaId: async () => null,
    },
  };

  return { storage, mediaStore, sessionStore };
}

describe("watch-session-service: never-overwrite invariant", () => {
  it("creates a new session per watch, never mutating prior ones", async () => {
    const { storage, sessionStore } = makeMockStorage();

    const w1 = await addWatchSession(storage, {
      mediaId: "m1",
      watchDate: "2024-01-01",
      rating: 8,
      review: "Loved visuals",
    });
    expect(w1.rewatchNumber).toBe(0);

    const w2 = await addWatchSession(storage, {
      mediaId: "m1",
      watchDate: "2024-06-01",
      rating: 10,
      review: "Emotional masterpiece",
    });
    expect(w2.rewatchNumber).toBe(1);
    expect(sessionStore).toHaveLength(2);
    expect(sessionStore[0].review).toBe("Loved visuals");

    const w3 = await addWatchSession(storage, {
      mediaId: "m1",
      watchDate: "2024-09-01",
      rating: 9,
      review: "Noticed new themes",
    });
    expect(w3.rewatchNumber).toBe(2);
    expect(sessionStore).toHaveLength(3);
  });

  it("recalculates media aggregates (average rating, watch count) after each new watch", async () => {
    const { storage, mediaStore } = makeMockStorage();

    await addWatchSession(storage, {
      mediaId: "m1",
      watchDate: "2024-01-01",
      rating: 8,
    });
    expect(mediaStore[0].averageRating).toBe(8);
    expect(mediaStore[0].watchCount).toBe(1);

    await addWatchSession(storage, {
      mediaId: "m1",
      watchDate: "2024-06-01",
      rating: 10,
    });
    expect(mediaStore[0].averageRating).toBe(9);
    expect(mediaStore[0].watchCount).toBe(2);
  });

  it("edits an existing session in place without creating a new one or leaking into siblings", async () => {
    const { storage, sessionStore } = makeMockStorage();

    const w1 = await addWatchSession(storage, {
      mediaId: "m1",
      watchDate: "2024-01-01",
      rating: 8,
    });
    await addWatchSession(storage, {
      mediaId: "m1",
      watchDate: "2024-06-01",
      rating: 10,
      review: "Emotional masterpiece",
    });

    await updateWatchSession(storage, w1.id, { rating: 9 });

    expect(sessionStore).toHaveLength(2);
    expect(sessionStore[0].rating).toBe(9);
    expect(sessionStore[1].review).toBe("Emotional masterpiece");
  });

  it("deletes a session and recalculates aggregates, without affecting remaining sessions", async () => {
    const { storage, sessionStore } = makeMockStorage();

    const w1 = await addWatchSession(storage, {
      mediaId: "m1",
      watchDate: "2024-01-01",
      rating: 8,
    });
    await addWatchSession(storage, {
      mediaId: "m1",
      watchDate: "2024-06-01",
      rating: 10,
    });
    const w3 = await addWatchSession(storage, {
      mediaId: "m1",
      watchDate: "2024-09-01",
      rating: 9,
    });

    const deleted = await deleteWatchSession(storage, w3.id);
    expect(deleted).toBe(true);
    expect(sessionStore).toHaveLength(2);
    expect(sessionStore.find((s) => s.id === w1.id)).toBeDefined();
  });

  it("orders chronologically and correctly identifies first/latest sessions", async () => {
    const { storage, sessionStore } = makeMockStorage();

    await addWatchSession(storage, {
      mediaId: "m1",
      watchDate: "2024-01-01",
      rating: 8,
    });
    await addWatchSession(storage, {
      mediaId: "m1",
      watchDate: "2024-06-01",
      rating: 10,
    });
    await addWatchSession(storage, {
      mediaId: "m1",
      watchDate: "2024-09-01",
      rating: 9,
    });

    const evolution = getRatingEvolution(sessionStore);
    expect(evolution.map((e) => e.rewatchNumber)).toEqual([0, 1, 2]);

    expect(getFirstSession(sessionStore)?.rewatchNumber).toBe(0);
    expect(getLatestSession(sessionStore)?.rewatchNumber).toBe(2);
  });
});
