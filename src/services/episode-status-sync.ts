import type { StorageService } from "./storage";
import { Episode, EpisodeProgress } from "../models/episode";
import { MediaVaultId } from "../types/common";
import { recalculateAndPersistStatus } from "./status-service";
import { addWatchSession } from "./watch-session-service";

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

/**
 * All of a show's episodes that come strictly before `target` (by season,
 * then episode number) and are not yet marked watched — i.e. exactly the
 * set Smart Episode Completion (Milestone 3) should offer to backfill when
 * the user jumps ahead and marks e.g. S2E7 without having watched S2E1–6
 * or earlier seasons. Returns them in watch order, oldest first, so a
 * caller can pass the result straight to `markSeasonWatched`.
 */
export function findUnwatchedPrecedingEpisodes(
	allEpisodes: Episode[],
	target: Episode,
	progress: EpisodeProgress[]
): Episode[] {
	const watchedEpisodeIds = new Set(progress.filter((p) => p.watched).map((p) => p.episodeId));

	return [...allEpisodes]
		.filter((e) => e.id !== target.id)
		.filter(
			(e) =>
				e.seasonNumber < target.seasonNumber ||
				(e.seasonNumber === target.seasonNumber && e.episodeNumber < target.episodeNumber)
		)
		.filter((e) => !watchedEpisodeIds.has(e.id))
		.sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
}

/**
 * Marks a single episode watched/unwatched, then recalculates the parent
 * show's status. This is the function UI code, imports, and sync should
 * call instead of `storage.episodeProgress.markWatched` directly, so
 * status recalculation can never be forgotten at a call site.
 *
 * Milestone 2 (TV Watch Logging Logic): marking an individual episode
 * watched only updates EpisodeProgress — it does NOT create a WatchSession
 * on its own. A WatchSession is only auto-created when this transition is
 * the one that completes the entire series (every episode across every
 * season now watched); that single session represents "I finished this
 * series," not "I watched this episode." Movies are untouched — this
 * module only ever deals with episodes.
 */
export async function markEpisodeWatched(
	storage: StorageService,
	episode: Episode,
	watched: boolean,
	watchedDate?: string
): Promise<EpisodeProgress> {
	const wasSeriesComplete = await isSeriesFullyWatched(storage, episode.mediaId);

	const progress = await storage.episodeProgress.markWatched(episode, watched, watchedDate);

	if (watched) {
		const isSeriesCompleteNow = await isSeriesFullyWatched(storage, episode.mediaId);
		if (isSeriesCompleteNow && !wasSeriesComplete) {
			await addWatchSession(storage, {
				mediaId: episode.mediaId,
				watchDate: watchedDate ?? today(),
			});
		}
	}

	await recalculateAndPersistStatus(storage, episode.mediaId);
	return progress;
}

/**
 * Batch-marks every episode in a season, then recalculates status once
 * (not once per episode) — cheaper and avoids the status flapping through
 * intermediate "Watching" states mid-batch.
 *
 * Milestone 2 (TV Watch Logging Logic): like `markEpisodeWatched`, this no
 * longer logs a WatchSession per episode. If the batch is the one that
 * pushes the series from incomplete to fully watched (e.g. Smart Episode
 * Completion backfilling the rest of a season, or "mark whole show
 * watched"), exactly one series-level WatchSession is appended for the
 * whole show — never one per episode in the batch.
 */
export async function markSeasonWatched(
	storage: StorageService,
	episodes: Episode[],
	watched: boolean
): Promise<EpisodeProgress[]> {
	const mediaId = episodes.length > 0 ? episodes[0].mediaId : "";
	const wasSeriesComplete = episodes.length > 0 ? await isSeriesFullyWatched(storage, mediaId) : false;

	const results = await storage.episodeProgress.markSeasonWatched(episodes, watched);

	if (watched && episodes.length > 0) {
		const isSeriesCompleteNow = await isSeriesFullyWatched(storage, mediaId);
		if (isSeriesCompleteNow && !wasSeriesComplete) {
			await addWatchSession(storage, {
				mediaId,
				watchDate: today(),
			});
		}
	}

	if (episodes.length > 0) {
		await recalculateAndPersistStatus(storage, mediaId);
	}
	return results;
}

/**
 * True when a show has at least one episode and every episode is currently
 * marked watched. Used to detect the exact transition (incomplete →
 * complete) that should auto-log a series-level WatchSession, so re-saving
 * an already-complete show, or a show with zero imported episodes, never
 * creates one.
 */
async function isSeriesFullyWatched(storage: StorageService, mediaId: MediaVaultId): Promise<boolean> {
	const [allEpisodes, progress] = await Promise.all([
		storage.episodes.findByMediaId(mediaId),
		storage.episodeProgress.findByMediaId(mediaId),
	]);
	if (allEpisodes.length === 0) return false;

	const watchedEpisodeIds = new Set(progress.filter((p) => p.watched).map((p) => p.episodeId));
	return allEpisodes.every((e) => watchedEpisodeIds.has(e.id));
}
