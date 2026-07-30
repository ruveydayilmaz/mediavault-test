import type { StorageService } from "./storage";
import { Episode, EpisodeWatch } from "../models/episode";
import { MediaVaultId } from "../types/common";
import { markEpisodeWatched } from "./episode-status-sync";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface NewEpisodeWatchInput {
  watchedAt?: string;
  rating?: number | null;
  emotion?: string | null;
  review?: string | null;
  notes?: string | null;
}

export async function addEpisodeWatch(
  storage: StorageService,
  episode: Episode,
  input: NewEpisodeWatchInput = {},
): Promise<EpisodeWatch> {
  const watchedAt = input.watchedAt ?? today();

  const watch = await storage.episodeWatches.create({
    mediaId: episode.mediaId,
    episodeId: episode.id,
    watchedAt,
    rating: input.rating ?? null,
    emotion: input.emotion ?? null,
    review: input.review ?? null,
    notes: input.notes ?? null,
  });

  await markEpisodeWatched(storage, episode, true, watchedAt, {
    skipWatchRecord: true,
  });

  return watch;
}

export async function updateEpisodeWatch(
  storage: StorageService,
  watchId: MediaVaultId,
  patch: Partial<
    Pick<EpisodeWatch, "watchedAt" | "rating" | "emotion" | "review" | "notes">
  >,
): Promise<EpisodeWatch | null> {
  return storage.episodeWatches.update(watchId, patch);
}

export async function deleteEpisodeWatch(
  storage: StorageService,
  watchId: MediaVaultId,
): Promise<void> {
  await storage.episodeWatches.delete(watchId);
}

export function sortEpisodeWatchesChronological(
  watches: EpisodeWatch[],
): EpisodeWatch[] {
  return [...watches].sort((a, b) => {
    const dateCmp = a.watchedAt.localeCompare(b.watchedAt);
    return dateCmp !== 0 ? dateCmp : a.createdAt.localeCompare(b.createdAt);
  });
}
