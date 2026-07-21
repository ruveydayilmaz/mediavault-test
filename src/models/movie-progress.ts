import { MediaVaultId, ISODateString } from "../types/common";

/**
 * Partial-watch progress for a single movie (Milestone 3: Partially
 * Watched Movies). Deliberately separate from `WatchSession` — mirrors
 * the same separation `EpisodeWatch` keeps from global Watch History:
 * a movie's Watch History entry represents a *completed* watch, while
 * this record represents progress toward one. Completing the movie
 * deletes this record and creates a normal `WatchSession` instead; it
 * never coexists with a completed watch for the same viewing.
 */
export interface MovieProgress {
	id: MediaVaultId;
	mediaId: MediaVaultId;
	currentMinute: number;
	totalRuntime: number;
	lastUpdated: ISODateString;
}
