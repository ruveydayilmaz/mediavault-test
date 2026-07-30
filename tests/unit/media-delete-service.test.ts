import { describe, it, expect } from "vitest";
import {
  deleteMedia,
  describeDeletionScope,
} from "../../src/services/media-delete-service";

function makeCollection<T extends { id: string }>() {
  const items: T[] = [];
  return {
    items,
    findById: async (id: string) => items.find((i) => i.id === id) ?? null,
    findWhere: async (pred: (i: T) => boolean) => items.filter(pred),
    delete: async (id: string) => {
      const idx = items.findIndex((i) => i.id === id);
      if (idx === -1) return false;
      items.splice(idx, 1);
      return true;
    },
    update: async (id: string, patch: Partial<T>) => {
      const idx = items.findIndex((i) => i.id === id);
      if (idx === -1) return null;
      items[idx] = { ...items[idx], ...patch };
      return items[idx];
    },
  };
}

function makeMockStorage() {
  const media = makeCollection<any>();
  const watchSessions = makeCollection<any>();
  const episodes = makeCollection<any>();
  const episodeProgress = makeCollection<any>();
  const episodeWatches = makeCollection<any>();
  const movieProgress = makeCollection<any>();
  const comfortProfiles = makeCollection<any>();
  const notifications = makeCollection<any>();
  const customLists = makeCollection<any>();

  const storage: any = {
    media,
    watchSessions: {
      ...watchSessions,
      deleteByMediaId: async (mediaId: string) => {
        const matches = watchSessions.items.filter(
          (s) => s.mediaId === mediaId,
        );
        for (const s of matches) await watchSessions.delete(s.id);
        return matches.length;
      },
    },
    episodes: {
      ...episodes,
      findByMediaId: async (mediaId: string) =>
        episodes.items.filter((e) => e.mediaId === mediaId),
      deleteByMediaId: async (mediaId: string) => {
        const matches = episodes.items.filter((e) => e.mediaId === mediaId);
        for (const e of matches) await episodes.delete(e.id);
        return matches.length;
      },
    },
    episodeProgress: {
      ...episodeProgress,
      findByMediaId: async (mediaId: string) =>
        episodeProgress.items.filter((p) => p.mediaId === mediaId),
      deleteByMediaId: async (mediaId: string) => {
        const matches = episodeProgress.items.filter(
          (p) => p.mediaId === mediaId,
        );
        for (const p of matches) await episodeProgress.delete(p.id);
        return matches.length;
      },
    },
    episodeWatches: {
      ...episodeWatches,
      findByMediaId: async (mediaId: string) =>
        episodeWatches.items.filter((w) => w.mediaId === mediaId),
      deleteByMediaId: async (mediaId: string) => {
        const matches = episodeWatches.items.filter(
          (w) => w.mediaId === mediaId,
        );
        for (const w of matches) await episodeWatches.delete(w.id);
        return matches.length;
      },
    },
    movieProgress: {
      ...movieProgress,
      findByMediaId: async (mediaId: string) =>
        movieProgress.items.find((p) => p.mediaId === mediaId) ?? null,
      deleteByMediaId: async (mediaId: string) => {
        const existing = movieProgress.items.find((p) => p.mediaId === mediaId);
        if (!existing) return 0;
        await movieProgress.delete(existing.id);
        return 1;
      },
    },
    comfortProfiles: {
      ...comfortProfiles,
      findByMediaId: async (mediaId: string) =>
        comfortProfiles.items.find((c) => c.mediaId === mediaId) ?? null,
      deleteByMediaId: async (mediaId: string) => {
        const existing = comfortProfiles.items.find(
          (c) => c.mediaId === mediaId,
        );
        if (!existing) return false;
        return comfortProfiles.delete(existing.id);
      },
    },
    notifications: {
      ...notifications,
      deleteByMediaId: async (mediaId: string) => {
        const matches = notifications.items.filter(
          (n) => n.mediaId === mediaId,
        );
        for (const n of matches) await notifications.delete(n.id);
        return matches.length;
      },
    },
    customLists: {
      ...customLists,
      getAll: async () => [...customLists.items],
      removeMediaEverywhere: async (mediaId: string) => {
        const affected = customLists.items.filter((l) =>
          l.mediaIds.includes(mediaId),
        );
        for (const l of affected) {
          await customLists.update(l.id, {
            mediaIds: l.mediaIds.filter((m: string) => m !== mediaId),
          });
        }
        return affected.length;
      },
    },
  };

  return {
    storage,
    media,
    watchSessions,
    episodes,
    episodeProgress,
    episodeWatches,
    movieProgress,
    comfortProfiles,
    notifications,
    customLists,
  };
}

function makeMockApp(files: Record<string, boolean> = {}) {
  const trashed: string[] = [];
  const app: any = {
    vault: {
      getAbstractFileByPath: (path: string) => (files[path] ? { path } : null),
    },
    fileManager: {
      trashFile: async (file: { path: string }) => {
        trashed.push(file.path);
      },
    },
  };
  return { app, trashed };
}

describe("deleteMedia (Universal Delete System)", () => {
  it("returns null and deletes nothing when the media item doesn't exist", async () => {
    const { storage } = makeMockStorage();
    const { app } = makeMockApp();
    const result = await deleteMedia(app, storage, "missing");
    expect(result).toBeNull();
  });

  it("deletes a movie's media record, watch sessions, comfort profile, notifications, note, and list references — leaving other media untouched", async () => {
    const {
      storage,
      media,
      watchSessions,
      comfortProfiles,
      notifications,
      customLists,
    } = makeMockStorage();

    media.items.push(
      {
        id: "m1",
        title: "Movie A",
        type: "movie",
        notePath: "MediaVault/Movies/Movie A.md",
      },
      { id: "m2", title: "Movie B", type: "movie", notePath: null },
    );
    watchSessions.items.push(
      { id: "ws1", mediaId: "m1" },
      { id: "ws2", mediaId: "m2" },
    );
    comfortProfiles.items.push({ id: "c1", mediaId: "m1" });
    notifications.items.push(
      { id: "n1", mediaId: "m1" },
      { id: "n2", mediaId: "m2" },
    );
    customLists.items.push({
      id: "l1",
      title: "Faves",
      mediaIds: ["m1", "m2"],
    });

    const { app, trashed } = makeMockApp({
      "MediaVault/Movies/Movie A.md": true,
    });

    const summary = await deleteMedia(app, storage, "m1");

    expect(summary).toMatchObject({
      mediaTitle: "Movie A",
      watchSessions: 1,
      episodes: 0,
      episodeProgress: 0,
      comfortProfileRemoved: true,
      listsAffected: 1,
      noteDeleted: true,
      notifications: 1,
    });

    expect(await media.findById("m1")).toBeNull();
    expect(await media.findById("m2")).not.toBeNull();
    expect(watchSessions.items.map((s) => s.id)).toEqual(["ws2"]);
    expect(comfortProfiles.items).toHaveLength(0);
    expect(notifications.items.map((n) => n.id)).toEqual(["n2"]);
    expect(customLists.items[0].mediaIds).toEqual(["m2"]);
    expect(trashed).toEqual(["MediaVault/Movies/Movie A.md"]);
  });

  it("also deletes episodes and episode progress for a TV series, and skips note deletion when there is none", async () => {
    const { storage, media, episodes, episodeProgress } = makeMockStorage();

    media.items.push({ id: "s1", title: "Show A", type: "tv", notePath: null });
    episodes.items.push(
      { id: "e1", mediaId: "s1" },
      { id: "e2", mediaId: "s1" },
    );
    episodeProgress.items.push({ id: "p1", mediaId: "s1" });

    const { app } = makeMockApp();
    const summary = await deleteMedia(app, storage, "s1");

    expect(summary?.episodes).toBe(2);
    expect(summary?.episodeProgress).toBe(1);
    expect(summary?.noteDeleted).toBe(false);
    expect(episodes.items).toHaveLength(0);
    expect(episodeProgress.items).toHaveLength(0);
  });
});

describe("describeDeletionScope", () => {
  it("includes episode progress and TV-only lines for a show but not a movie", () => {
    const movieScope = describeDeletionScope({
      type: "movie",
      notePath: null,
    } as any);
    const showScope = describeDeletionScope({
      type: "tv",
      notePath: "x.md",
    } as any);

    expect(movieScope).not.toContain("Episode progress");
    expect(showScope).toContain("Episode progress");
    expect(showScope).toContain("Generated note");
    expect(movieScope).not.toContain("Generated note");
  });
});
