import type { StorageService } from "./storage";

/**
 * Updates a MediaItem's `lastActivityAt` — the single source of truth for
 * "Recent" library sorting (see `library-query.ts`'s `recentSortKey`).
 *
 * Unlike `lastWatchedDate` (which only reflects completed WatchSessions —
 * i.e. Watch History — and must stay that way per the immutable-history
 * design), this is meant to be touched by every meaningful interaction:
 * marking an episode watched, adding an episode rewatch, marking a season
 * watched, completing a series, and movie watches/rewatches/partial
 * progress updates.
 *
 * Callers across the watch/rewatch/progress funnels should call this
 * rather than writing `lastActivityAt` directly, so the definition of
 * "what counts as activity" lives in exactly one place. Always uses the
 * real current time (not a possibly-backdated watch date), since Recent
 * is meant to reflect *when the user actually interacted with MediaVault*.
 */
export async function touchMediaActivity(storage: StorageService, mediaId: string): Promise<void> {
	await storage.media.update(mediaId, { lastActivityAt: new Date().toISOString() });
}
