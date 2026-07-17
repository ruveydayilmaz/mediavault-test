import { computeAnalytics, AnalyticsInput } from "./compute";
import { AnalyticsSummary } from "./types";

let cachedVersion: string | null = null;
let cachedResult: AnalyticsSummary | null = null;

/**
 * Memoized analytics computation. computeAnalytics() is a pure O(n) scan
 * over media/sessions/episodes/progress — cheap for hundreds of items, but
 * worth skipping entirely when re-opening the dashboard without anything
 * having changed in a 10,000+ item library.
 *
 * Takes the same input as computeAnalytics() plus a cheap version key
 * (e.g. StorageService.getDataVersion()) rather than doing its own fetch —
 * callers that already need the raw arrays for other rendering (heatmap,
 * first-watch counts, etc.) aren't forced into a second redundant fetch
 * just to get the memoization benefit.
 */
export function computeAnalyticsMemoized(input: AnalyticsInput, versionKey: string): AnalyticsSummary {
	if (cachedResult !== null && cachedVersion === versionKey) {
		return cachedResult;
	}

	const result = computeAnalytics(input);
	cachedVersion = versionKey;
	cachedResult = result;
	return result;
}

/** Exposed for tests / explicit invalidation. */
export function clearAnalyticsCache(): void {
	cachedVersion = null;
	cachedResult = null;
}

