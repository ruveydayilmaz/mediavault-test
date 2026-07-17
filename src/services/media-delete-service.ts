import type { App } from "obsidian";
import type { StorageService } from "./storage";
import { MediaItem } from "../models/media";
import { MediaType } from "../types/enums";
import { MediaVaultId } from "../types/common";

/** A count-by-kind summary of what a deletion actually removed — used to drive the confirmation dialog and any post-delete Notice. */
export interface MediaDeletionSummary {
	mediaTitle: string;
	watchSessions: number;
	episodes: number;
	episodeProgress: number;
	comfortProfileRemoved: boolean;
	listsAffected: number;
	noteDeleted: boolean;
	notifications: number;
}

/**
 * Permanently deletes a movie or TV series and every record that
 * references it: watch history (reviews/ratings live on WatchSession),
 * episodes/episode progress (TV only), comfort profile, notifications,
 * the generated markdown note (if any), and its references from every
 * custom list (the list itself is preserved — only the reference is
 * dropped). Favorites need no separate cleanup since `isFavorite` lives on
 * the MediaItem record itself and is removed along with it.
 *
 * Returns null if the media item no longer exists (e.g. already deleted
 * by a concurrent action); otherwise a summary of what was removed, for
 * the caller's confirmation dialog / Notice.
 */
export async function deleteMedia(
	app: App,
	storage: StorageService,
	mediaId: MediaVaultId
): Promise<MediaDeletionSummary | null> {
	const media = await storage.media.findById(mediaId);
	if (!media) return null;

	const watchSessions = await storage.watchSessions.deleteByMediaId(mediaId);

	let episodes = 0;
	let episodeProgress = 0;
	if (media.type === MediaType.TVShow) {
		episodes = await storage.episodes.deleteByMediaId(mediaId);
		episodeProgress = await storage.episodeProgress.deleteByMediaId(mediaId);
	}

	const comfortProfileRemoved = await storage.comfortProfiles.deleteByMediaId(mediaId);
	const notifications = await storage.notifications.deleteByMediaId(mediaId);
	const listsAffected = await storage.customLists.removeMediaEverywhere(mediaId);
	const noteDeleted = await deleteMediaNote(app, media);

	// The media record itself, last — everything above still needed its id to find related records.
	await storage.media.delete(mediaId);

	return {
		mediaTitle: media.title,
		watchSessions,
		episodes,
		episodeProgress,
		comfortProfileRemoved,
		listsAffected,
		noteDeleted,
		notifications,
	};
}

/** Deletes the generated markdown note for a media item, if one exists on disk. Safe to call even if notePath is stale/missing. */
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

/** Human-readable bullet list of what a deletion will remove, for the confirmation dialog. TV-only lines are omitted for movies. */
export function describeDeletionScope(media: MediaItem): string[] {
	const lines = ["Watch history", "Reviews", "Ratings"];
	if (media.type === MediaType.TVShow) {
		lines.push("Episode progress");
	}
	lines.push("Favorites status");
	if (media.notePath) lines.push("Generated note");
	lines.push("References in any custom lists");
	return lines;
}
