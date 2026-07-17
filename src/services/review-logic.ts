import { WatchSession, RatingEvolutionPoint } from "../models/review";

/**
 * The next rewatch number for a new session on this media: 0 for the very
 * first watch, 1 for the first rewatch, etc. Based on count of existing
 * sessions rather than max+1, so a deleted middle session doesn't create
 * gaps that confuse "rewatch number" as a display concept — it's always
 * consistent with "how many times has this been watched so far".
 */
export function nextRewatchNumber(existingSessions: WatchSession[]): number {
	return existingSessions.length;
}

/**
 * Average rating across all sessions with a non-null rating. Returns null
 * if there are no rated sessions yet (distinct from a 0 rating).
 */
export function computeAverageRating(sessions: WatchSession[]): number | null {
	const rated = sessions.filter((s): s is WatchSession & { rating: number } => s.rating !== null);
	if (rated.length === 0) return null;
	const sum = rated.reduce((acc, s) => acc + s.rating, 0);
	return sum / rated.length;
}

/**
 * Chronological (by watchDate, falling back to rewatchNumber for same-day
 * ties) list of rating data points, for the rating-evolution chart and
 * timeline view. Sessions are never mutated here — this is a derived,
 * read-only view.
 */
export function getRatingEvolution(sessions: WatchSession[]): RatingEvolutionPoint[] {
	return [...sessions]
		.sort((a, b) => {
			const dateCmp = a.watchDate.localeCompare(b.watchDate);
			return dateCmp !== 0 ? dateCmp : a.rewatchNumber - b.rewatchNumber;
		})
		.map((s) => ({
			watchSessionId: s.id,
			rewatchNumber: s.rewatchNumber,
			watchDate: s.watchDate,
			rating: s.rating,
		}));
}

/** Sessions in chronological order for the timeline view (oldest first). */
export function sortSessionsChronological(sessions: WatchSession[]): WatchSession[] {
	return [...sessions].sort((a, b) => {
		const dateCmp = a.watchDate.localeCompare(b.watchDate);
		return dateCmp !== 0 ? dateCmp : a.rewatchNumber - b.rewatchNumber;
	});
}

/** The most recent watch session, or null if there are none. */
export function getLatestSession(sessions: WatchSession[]): WatchSession | null {
	const sorted = sortSessionsChronological(sessions);
	return sorted.length > 0 ? sorted[sorted.length - 1] : null;
}

/** The first (original) watch session, or null if there are none. */
export function getFirstSession(sessions: WatchSession[]): WatchSession | null {
	const sorted = sortSessionsChronological(sessions);
	return sorted.length > 0 ? sorted[0] : null;
}
