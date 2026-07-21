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

/**
 * Appends a new, independent watch record for a single episode (Milestone
 * 2: Episode Rewatch System). Unlimited rewatches are supported — this
 * never overwrites a prior `EpisodeWatch`, mirroring the never-overwrite
 * invariant that already governs `WatchSession`.
 *
 * Also drives `markEpisodeWatched` so episode progress, Watch Next, and
 * season-completion detection (which may append a single series-level
 * `WatchSession` — the one and only place episode activity is allowed to
 * touch global Watch History) stay in sync, exactly as they do for the
 * checkbox-driven mark-watched flow.
 */
export async function addEpisodeWatch(
	storage: StorageService,
	episode: Episode,
	input: NewEpisodeWatchInput = {}
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

	await markEpisodeWatched(storage, episode, true, watchedAt, { skipWatchRecord: true });

	return watch;
}

export async function updateEpisodeWatch(
	storage: StorageService,
	watchId: MediaVaultId,
	patch: Partial<Pick<EpisodeWatch, "watchedAt" | "rating" | "emotion" | "review" | "notes">>
): Promise<EpisodeWatch | null> {
	return storage.episodeWatches.update(watchId, patch);
}

/** Deletes a single rewatch entry. Never touches episode progress or global Watch History. */
export async function deleteEpisodeWatch(storage: StorageService, watchId: MediaVaultId): Promise<void> {
	await storage.episodeWatches.delete(watchId);
}

/** Oldest-first, for the rewatch timeline and rating-evolution chart. */
export function sortEpisodeWatchesChronological(watches: EpisodeWatch[]): EpisodeWatch[] {
	return [...watches].sort((a, b) => {
		const dateCmp = a.watchedAt.localeCompare(b.watchedAt);
		return dateCmp !== 0 ? dateCmp : a.createdAt.localeCompare(b.createdAt);
	});
}
