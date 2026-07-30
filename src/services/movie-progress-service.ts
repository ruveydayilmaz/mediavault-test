import type { StorageService } from "./storage";
import { MediaItem } from "../models/media";
import { MediaStatus } from "../types/enums";
import { MovieProgress } from "../models/movie-progress";
import { addWatchSession } from "./watch-session-service";
import { touchMediaActivity } from "./activity-service";

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

/**
 * Creates or updates the single partial-progress record for a movie
 * (Milestone 3: Partially Watched Movies), then marks the movie Dropped
 * directly (roadmap Milestone 2: Dropped Movies) — mirroring
 * drop-series-service's direct write for TV, since "partially watched and
 * stopped" is exactly what Dropped means and, like TV, is a manual-override
 * status `calculateMediaStatus` will never overwrite on its own. Survives
 * restarts because it's persisted like everything else, via
 * `saveData`/`loadData`.
 */
export async function setMovieProgress(
	storage: StorageService,
	media: MediaItem,
	currentMinute: number
): Promise<MovieProgress> {
	const totalRuntime = media.runtime ?? 0;
	const clamped = Math.max(0, totalRuntime > 0 ? Math.min(currentMinute, totalRuntime) : currentMinute);

	const existing = await storage.movieProgress.findByMediaId(media.id);
	const result = existing
		? await storage.movieProgress.update(existing.id, {
				currentMinute: clamped,
				totalRuntime,
				lastUpdated: today(),
		})
		: await storage.movieProgress.create({
				mediaId: media.id,
				currentMinute: clamped,
				totalRuntime,
				lastUpdated: today(),
		});

	await storage.media.update(media.id, { status: MediaStatus.Dropped });
	await touchMediaActivity(storage, media.id);
	return result as MovieProgress;
}

/** Discards partial progress without logging a watch (e.g. the user gave up on it, or is resetting). Status is left alone — use resumeMovie to also clear the Dropped override. */
export async function clearMovieProgress(storage: StorageService, mediaId: string): Promise<void> {
	await storage.movieProgress.deleteByMediaId(mediaId);
}

/**
 * Resumes a dropped movie (roadmap Milestone 2: Dropped Movies), mirroring
 * resume-series-service for TV: progress (the `movieProgress` record) was
 * never touched by dropping, so it's already exactly as it was — this only
 * needs to lift the manual override back to Watching.
 */
export async function resumeMovie(storage: StorageService, mediaId: string): Promise<void> {
	await storage.media.update(mediaId, { status: MediaStatus.Watching });
}

/**
 * Marks a partially-watched movie as finished: clears the Dropped override
 * first (same reason `resumeSeries` writes Watching before recalculating —
 * `calculateMediaStatus` treats Dropped as a manual override and would
 * otherwise preserve it even after a new session is added), removes the
 * partial progress, then creates a normal completed-watch `WatchSession`
 * (which drives Statistics, Recent sorting, and Rating Evolution exactly
 * like any other movie watch, and whose own recalculation then derives
 * Completed from the new session count).
 */
export async function completeMovieFromProgress(storage: StorageService, mediaId: string): Promise<void> {
	await storage.media.update(mediaId, { status: MediaStatus.Watching });
	await storage.movieProgress.deleteByMediaId(mediaId);
	await addWatchSession(storage, { mediaId, watchDate: today() });
}
