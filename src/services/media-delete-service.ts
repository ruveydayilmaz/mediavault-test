import type { App } from "obsidian";
import type { StorageService } from "./storage";
import { MediaItem } from "../models/media";
import { MediaType } from "../types/enums";
import { MediaVaultId } from "../types/common";

export interface MediaDeletionSummary {
  mediaTitle: string;
  watchSessions: number;
  episodes: number;
  episodeProgress: number;
  episodeWatches: number;
  comfortProfileRemoved: boolean;
  listsAffected: number;
  noteDeleted: boolean;
  notifications: number;
}

export async function deleteMedia(
  app: App,
  storage: StorageService,
  mediaId: MediaVaultId,
): Promise<MediaDeletionSummary | null> {
  const media = await storage.media.findById(mediaId);
  if (!media) return null;

  const watchSessions = await storage.watchSessions.deleteByMediaId(mediaId);

  let episodes = 0;
  let episodeProgress = 0;
  let episodeWatches = 0;
  if (media.type === MediaType.TVShow) {
    episodes = await storage.episodes.deleteByMediaId(mediaId);
    episodeProgress = await storage.episodeProgress.deleteByMediaId(mediaId);
    episodeWatches = await storage.episodeWatches.deleteByMediaId(mediaId);
  }

  const comfortProfileRemoved =
    await storage.comfortProfiles.deleteByMediaId(mediaId);
  const notifications = await storage.notifications.deleteByMediaId(mediaId);
  const listsAffected =
    await storage.customLists.removeMediaEverywhere(mediaId);
  const noteDeleted = await deleteMediaNote(app, media);
  if (media.type === MediaType.Movie) {
    await storage.movieProgress.deleteByMediaId(mediaId);
  }

  await storage.media.delete(mediaId);

  return {
    mediaTitle: media.title,
    watchSessions,
    episodes,
    episodeProgress,
    episodeWatches,
    comfortProfileRemoved,
    listsAffected,
    noteDeleted,
    notifications,
  };
}

async function deleteMediaNote(app: App, media: MediaItem): Promise<boolean> {
  if (!media.notePath) return false;
  const file = app.vault.getAbstractFileByPath(media.notePath);
  if (!file) return false;
  try {
    await app.fileManager.trashFile(file);
    return true;
  } catch (err) {
    console.warn(`MediaVault: failed to delete note for "${media.title}"`, err);
    return false;
  }
}

export function describeDeletionScope(media: MediaItem): string[] {
  const lines = ["Watch history", "Reviews", "Ratings"];
  if (media.type === MediaType.TVShow) {
    lines.push("Episode progress");
    lines.push("Episode watch history");
  }
  if (media.type === MediaType.Movie) {
    lines.push("Partial watch progress");
  }
  lines.push("Favorites status");
  if (media.notePath) lines.push("Generated note");
  lines.push("References in any custom lists");
  return lines;
}
